-- =============================================================================
-- TNG Demand Hub — Schema Inicial (Sprint 1)
-- =============================================================================
-- Cria a infraestrutura mínima para autenticação e perfis de usuário.
-- Tabelas de domínio (clients, demands, attachments, comments, activity_log,
-- classification_rules, ai_usage_log) entram em migrações posteriores.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela: profiles
-- Estende auth.users do Supabase com metadados do app (papel, área, tema, etc.)
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  area text,
  hotkey text default 'CommandOrControl+Shift+D',
  theme text not null default 'dark' check (theme in ('light', 'dark', 'system')),
  notifications jsonb not null default '{"assigned": true, "due_soon": true, "comments": true}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil estendido dos usuários do TNG Demand Hub.';

-- -----------------------------------------------------------------------------
-- Trigger: ao criar usuário em auth.users, cria perfil automaticamente
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Trigger: atualizar updated_at automaticamente
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Membros ativos veem todos os perfis (sistema interno colaborativo)
create policy "profiles_select_active"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

-- Usuário pode atualizar o próprio perfil
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Apenas admin pode alterar role/active de outros perfis
create policy "profiles_admin_update_all"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.active = true
    )
  );

-- Apenas admin pode deletar perfis
create policy "profiles_admin_delete"
  on public.profiles for delete
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.active = true
    )
  );
