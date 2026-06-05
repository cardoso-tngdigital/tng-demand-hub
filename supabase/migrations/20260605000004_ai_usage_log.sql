-- =============================================================================
-- TNG Demand Hub — Tabela de uso da IA (Sprint 4)
-- =============================================================================
-- Rastreia cada chamada ao Gemini para controle de custo e auditoria.
-- =============================================================================

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  demand_id uuid references public.demands (id) on delete set null,
  operation text not null check (operation in ('extract', 'route', 'transcribe')),
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_micro integer not null default 0,
  latency_ms integer,
  status text not null check (status in ('success', 'error', 'timeout', 'invalid_response')),
  error_message text,
  created_at timestamptz not null default now()
);

comment on table public.ai_usage_log is 'Registro de cada chamada às APIs de IA para controle de custo e auditoria.';

create index ai_usage_user_idx on public.ai_usage_log (user_id, created_at desc);
create index ai_usage_created_idx on public.ai_usage_log (created_at desc);

alter table public.ai_usage_log enable row level security;

create policy "ai_usage_select_member"
  on public.ai_usage_log for select
  to authenticated
  using (public.is_active_member());

-- Apenas service_role pode inserir (a Edge Function usa essa role)
create policy "ai_usage_insert_service"
  on public.ai_usage_log for insert
  to service_role
  with check (true);
