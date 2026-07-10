-- =============================================================================
-- 20260702000001_blog_ai_usage.sql
-- Cria `blog.ai_usage` — rastreio de consumo do Gemini pelo Blog.
-- =============================================================================
-- Separado do painel "Uso da IA" do app principal (que rastreia triagem e
-- auto-classificação de demandas). Blog tem uso próprio, com relacionamento
-- opcional a site e job.
-- =============================================================================

create table if not exists blog.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  site_id uuid references blog.sites(id) on delete set null,
  job_id text,
  modelo text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer generated always as (input_tokens + output_tokens) stored,
  custo_estimado numeric(10, 6),
  created_at timestamptz not null default now()
);

create index if not exists blog_ai_usage_created_idx
  on blog.ai_usage (created_at desc);
create index if not exists blog_ai_usage_user_created_idx
  on blog.ai_usage (user_id, created_at desc);

alter table blog.ai_usage enable row level security;

-- Membros autenticados leem tudo (equipe compartilha o painel de uso).
drop policy if exists blog_ai_usage_select_authenticated on blog.ai_usage;
create policy blog_ai_usage_select_authenticated
  on blog.ai_usage
  for select
  to authenticated
  using (true);

-- INSERT: qualquer authenticated pode inserir o próprio uso.
-- (O sidecar usa service_role no scheduler; nesse caso RLS não aplica.)
drop policy if exists blog_ai_usage_insert_own on blog.ai_usage;
create policy blog_ai_usage_insert_own
  on blog.ai_usage
  for insert
  to authenticated
  with check (user_id = auth.uid() or user_id is null);

grant select, insert on blog.ai_usage to authenticated;

-- Realtime opcional pra o painel atualizar sozinho quando outro membro gera.
alter publication supabase_realtime add table blog.ai_usage;
