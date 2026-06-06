-- =============================================================================
-- TNG Demand Hub — Regras de auto-classificação (Sprint 8 fase 4)
-- =============================================================================
-- Regras de "se X então Y" aplicadas pelo client após a extração da IA e
-- antes da tela de revisão. Apenas admins gerenciam; todos os membros leem
-- (a aplicação roda no client).
-- =============================================================================

create table public.classification_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  match_field text not null check (match_field in ('description', 'client', 'tag')),
  match_operator text not null check (match_operator in ('contains', 'equals')),
  match_value text not null,
  set_field text not null check (set_field in ('assignee_id', 'priority', 'tag')),
  set_value text not null,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.classification_rules is 'Regras "se X então Y" aplicadas no client após a IA e antes da confirmação.';

create index classification_rules_active_idx on public.classification_rules (active);

create trigger classification_rules_set_updated_at
  before update on public.classification_rules
  for each row execute function public.set_updated_at();

alter table public.classification_rules enable row level security;

create policy "rules_select_member"
  on public.classification_rules for select
  to authenticated
  using (public.is_active_member());

create policy "rules_insert_admin"
  on public.classification_rules for insert
  to authenticated
  with check (public.is_admin() and created_by = auth.uid());

create policy "rules_update_admin"
  on public.classification_rules for update
  to authenticated
  using (public.is_admin());

create policy "rules_delete_admin"
  on public.classification_rules for delete
  to authenticated
  using (public.is_admin());
