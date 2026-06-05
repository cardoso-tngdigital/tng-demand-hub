-- =============================================================================
-- TNG Demand Hub — Schema de Domínio (Sprint 3)
-- =============================================================================
-- Cria as tabelas principais: clients, demands e activity_log.
-- Attachments e classification_rules entram em migrações posteriores.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela: clients
-- -----------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  alias text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is 'Clientes ativos da TNG Digital. Usado como contexto pela IA.';

create index clients_status_idx on public.clients (status);
create index clients_name_idx on public.clients (lower(name));

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabela: demands
-- -----------------------------------------------------------------------------

create table public.demands (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  description text not null,
  client_id uuid references public.clients (id) on delete set null,
  assignee_id uuid references public.profiles (id) on delete set null,
  created_by uuid not null references public.profiles (id) on delete set null,
  priority text not null default 'media' check (priority in ('baixa', 'media', 'alta', 'urgente')),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done', 'archived')),
  due_date date,
  tags text[] not null default '{}'::text[],
  ai_confidence jsonb,
  ai_raw_response jsonb,
  ai_cost_micro integer,
  captured_via text not null default 'manual' check (captured_via in ('hotkey', 'tray', 'manual')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.demands is 'Demandas registradas no TNG Demand Hub.';

create index demands_status_idx on public.demands (status);
create index demands_assignee_idx on public.demands (assignee_id);
create index demands_client_idx on public.demands (client_id);
create index demands_due_date_idx on public.demands (due_date);
create index demands_created_at_idx on public.demands (created_at desc);

create trigger demands_set_updated_at
  before update on public.demands
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Tabela: activity_log
-- -----------------------------------------------------------------------------

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references public.demands (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  field text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activity_log is 'Histórico de alterações em demandas (auditoria).';

create index activity_log_demand_idx on public.activity_log (demand_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Row Level Security — clients
-- -----------------------------------------------------------------------------

alter table public.clients enable row level security;

create policy "clients_select_active_members"
  on public.clients for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

create policy "clients_insert_active_members"
  on public.clients for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

create policy "clients_update_active_members"
  on public.clients for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

create policy "clients_admin_delete"
  on public.clients for delete
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.active = true
    )
  );

-- -----------------------------------------------------------------------------
-- Row Level Security — demands
-- -----------------------------------------------------------------------------

alter table public.demands enable row level security;

create policy "demands_select_active_members"
  on public.demands for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

create policy "demands_insert_active_members"
  on public.demands for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

create policy "demands_update_active_members"
  on public.demands for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

create policy "demands_delete_own_or_admin"
  on public.demands for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.active = true
    )
  );

-- -----------------------------------------------------------------------------
-- Row Level Security — activity_log
-- -----------------------------------------------------------------------------

alter table public.activity_log enable row level security;

create policy "activity_log_select_active_members"
  on public.activity_log for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

create policy "activity_log_insert_system"
  on public.activity_log for insert
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
    )
  );

-- -----------------------------------------------------------------------------
-- Realtime — habilitar publicação para sincronização entre clientes
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.demands;
alter publication supabase_realtime add table public.activity_log;

-- -----------------------------------------------------------------------------
-- Seed inicial — clientes placeholder
-- (Pode ser apagado/editado pelo admin depois)
-- -----------------------------------------------------------------------------

insert into public.clients (name, alias, status, notes) values
  ('TNG Digital (Interno)', 'TNG', 'active', 'Demandas internas da TNG Digital'),
  ('Cliente Demo', 'Demo', 'active', 'Cliente de exemplo para testes — pode ser removido após cadastrar os clientes reais');
