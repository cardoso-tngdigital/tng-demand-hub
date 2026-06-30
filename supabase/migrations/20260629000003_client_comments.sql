-- Sprint 20: comentários por cliente (paralelo ao `comments` que é por
-- demanda). O drawer do cliente passa a ter uma thread própria pra
-- registrar observações coletivas (status do projeto, follow-ups,
-- decisões) que não pertencem a uma demanda específica.
--
-- Schema espelha `public.comments` (Sprint 7) com `client_id` no lugar
-- de `demand_id`. RLS: membros ativos leem e escrevem (em nome próprio);
-- só admin remove (mesma regra de `comments` desde Sprint 11).

create table public.client_comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_comments_client_idx
  on public.client_comments (client_id, created_at desc);

alter table public.client_comments enable row level security;

create policy "client_comments_select_members"
  on public.client_comments for select
  to authenticated
  using (public.is_active_member());

create policy "client_comments_insert_author"
  on public.client_comments for insert
  to authenticated
  with check (public.is_active_member() and author_id = auth.uid());

create policy "client_comments_delete_admin"
  on public.client_comments for delete
  to authenticated
  using (public.is_admin());

-- Realtime: o ClientCommentsThread se inscreve por client_id pra refletir
-- inserts de outros membros sem refetch.
alter publication supabase_realtime add table public.client_comments;

comment on table public.client_comments is
  'Comentários atrelados a um cliente (não a uma demanda específica).';
