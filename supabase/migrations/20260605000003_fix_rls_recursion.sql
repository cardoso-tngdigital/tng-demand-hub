-- =============================================================================
-- TNG Demand Hub — Correção de recursão infinita em RLS (Hotfix Sprint 3)
-- =============================================================================
-- As policies anteriores consultavam public.profiles dentro de outras policies,
-- causando recursão infinita (erro 42P17). Esta migração:
--   1) Cria funções SECURITY DEFINER que bypassam RLS para checagens de papel.
--   2) Recria todas as policies usando essas funções.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER quebra a recursão)
-- -----------------------------------------------------------------------------

create or replace function public.is_active_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

-- -----------------------------------------------------------------------------
-- Drop das policies antigas (que causavam recursão)
-- -----------------------------------------------------------------------------

drop policy if exists "profiles_select_active"     on public.profiles;
drop policy if exists "profiles_admin_update_all"  on public.profiles;
drop policy if exists "profiles_admin_delete"      on public.profiles;

drop policy if exists "clients_select_active_members" on public.clients;
drop policy if exists "clients_insert_active_members" on public.clients;
drop policy if exists "clients_update_active_members" on public.clients;
drop policy if exists "clients_admin_delete"          on public.clients;

drop policy if exists "demands_select_active_members" on public.demands;
drop policy if exists "demands_insert_active_members" on public.demands;
drop policy if exists "demands_update_active_members" on public.demands;
drop policy if exists "demands_delete_own_or_admin"   on public.demands;

drop policy if exists "activity_log_select_active_members" on public.activity_log;
drop policy if exists "activity_log_insert_system"         on public.activity_log;

-- -----------------------------------------------------------------------------
-- Profiles — qualquer autenticado vê (sistema interno colaborativo)
-- -----------------------------------------------------------------------------

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_admin_update"
  on public.profiles for update
  to authenticated
  using (public.is_admin());

create policy "profiles_admin_delete"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------

create policy "clients_select_member"
  on public.clients for select
  to authenticated
  using (public.is_active_member());

create policy "clients_insert_member"
  on public.clients for insert
  to authenticated
  with check (public.is_active_member());

create policy "clients_update_member"
  on public.clients for update
  to authenticated
  using (public.is_active_member());

create policy "clients_admin_delete"
  on public.clients for delete
  to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Demands
-- -----------------------------------------------------------------------------

create policy "demands_select_member"
  on public.demands for select
  to authenticated
  using (public.is_active_member());

create policy "demands_insert_member"
  on public.demands for insert
  to authenticated
  with check (created_by = auth.uid() and public.is_active_member());

create policy "demands_update_member"
  on public.demands for update
  to authenticated
  using (public.is_active_member());

create policy "demands_delete_own_or_admin"
  on public.demands for delete
  to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- Activity log
-- -----------------------------------------------------------------------------

create policy "activity_log_select_member"
  on public.activity_log for select
  to authenticated
  using (public.is_active_member());

create policy "activity_log_insert_member"
  on public.activity_log for insert
  to authenticated
  with check (actor_id = auth.uid() and public.is_active_member());
