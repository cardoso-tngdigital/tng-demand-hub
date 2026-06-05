-- =============================================================================
-- TNG Demand Hub — Comentários por demanda (Sprint 7)
-- =============================================================================
-- Discussões dentro de demandas. Membros ativos leem; cada autor escreve em
-- seu próprio nome; autor pode editar/apagar seu comentário, admins removem
-- de outros para moderação.
-- =============================================================================

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references public.demands (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (length(trim(content)) > 0),
  mentions uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.comments is 'Comentários (markdown simples) por demanda.';

create index comments_demand_idx  on public.comments (demand_id, created_at);
create index comments_author_idx  on public.comments (author_id);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.comments enable row level security;

create policy "comments_select_member"
  on public.comments for select
  to authenticated
  using (public.is_active_member());

create policy "comments_insert_author"
  on public.comments for insert
  to authenticated
  with check (author_id = auth.uid() and public.is_active_member());

create policy "comments_update_own"
  on public.comments for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "comments_delete_own_or_admin"
  on public.comments for delete
  to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.comments;
