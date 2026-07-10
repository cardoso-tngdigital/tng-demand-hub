-- =============================================================================
-- 20260704000001_blog_notificacoes.sql
-- Cria `blog.notificacoes` — eventos do Blog persistidos pra visualização
-- posterior no painel (drawer).
-- =============================================================================
-- Motivação: o scheduler roda em background e pode rodar mesmo com o app
-- fechado (via cron do host). Se um agendamento falhar quando ninguém está
-- olhando, a informação precisa ficar em algum lugar até alguém abrir.
-- Toast é feature de UX imediata; a persistência é o que garante que nada
-- se perde.
-- =============================================================================

create table if not exists blog.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  -- Escopo opcional: site relacionado (pra filtragem futura por site) e job
  -- (pipeline "agora") ou agendamento que originou o evento.
  site_id uuid references blog.sites(id) on delete set null,
  job_id text,
  agendamento_id uuid references blog.agendamentos(id) on delete set null,
  -- Nível visual do toast/badge.
  tipo text not null check (tipo in ('info', 'success', 'warning', 'error')),
  titulo text not null,
  mensagem text not null,
  -- Contexto adicional livre — pode conter keyword, stack de erro, links, etc.
  contexto jsonb,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists blog_notificacoes_user_created_idx
  on blog.notificacoes (user_id, created_at desc);

create index if not exists blog_notificacoes_user_nao_lidas_idx
  on blog.notificacoes (user_id, lida)
  where lida = false;

alter table blog.notificacoes enable row level security;

-- Cada usuário só vê as próprias notificações. Simplifica escopo — nada de
-- expor erros de um cliente pra outro membro da equipe.
drop policy if exists blog_notificacoes_select_own on blog.notificacoes;
create policy blog_notificacoes_select_own
  on blog.notificacoes
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT: authenticated pode inserir as próprias. O scheduler roda com
-- service_role, que ignora RLS — necessário porque agendamento pode
-- pertencer a qualquer usuário.
drop policy if exists blog_notificacoes_insert_own on blog.notificacoes;
create policy blog_notificacoes_insert_own
  on blog.notificacoes
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- UPDATE: só o dono pode marcar como lida.
drop policy if exists blog_notificacoes_update_own on blog.notificacoes;
create policy blog_notificacoes_update_own
  on blog.notificacoes
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- DELETE: dono pode apagar (limpeza manual).
drop policy if exists blog_notificacoes_delete_own on blog.notificacoes;
create policy blog_notificacoes_delete_own
  on blog.notificacoes
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on blog.notificacoes to authenticated;

-- Realtime pro toast/badge atualizar sem precisar recarregar (implementação
-- futura no painel).
alter publication supabase_realtime add table blog.notificacoes;
