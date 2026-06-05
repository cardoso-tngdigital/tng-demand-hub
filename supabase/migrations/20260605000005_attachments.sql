-- =============================================================================
-- TNG Demand Hub — Anexos multimodais (Sprint 5)
-- =============================================================================
-- Cria a tabela `attachments` (metadados) e o bucket privado `attachments`
-- no Storage. Cada arquivo físico vive em
--   {bucket: attachments}/{demand_id}/{attachment_id}.{ext}
-- e o download acontece via URL assinada gerada sob demanda.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela: attachments
-- -----------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references public.demands (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.attachments is 'Anexos vinculados a demandas. Arquivo físico fica no bucket Storage `attachments`.';
comment on column public.attachments.file_path is 'Caminho relativo dentro do bucket attachments (formato: demand_id/attachment_id.ext).';
comment on column public.attachments.file_type is 'MIME type registrado no upload (ex.: image/png, audio/ogg, application/pdf).';

create index attachments_demand_idx   on public.attachments (demand_id, created_at desc);
create index attachments_uploader_idx on public.attachments (uploaded_by);

-- -----------------------------------------------------------------------------
-- Row Level Security — attachments
-- -----------------------------------------------------------------------------

alter table public.attachments enable row level security;

create policy "attachments_select_member"
  on public.attachments for select
  to authenticated
  using (public.is_active_member());

create policy "attachments_insert_member"
  on public.attachments for insert
  to authenticated
  with check (uploaded_by = auth.uid() and public.is_active_member());

create policy "attachments_delete_own_or_admin"
  on public.attachments for delete
  to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.attachments;

-- -----------------------------------------------------------------------------
-- Storage bucket: attachments (privado)
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Storage policies — escopadas ao bucket `attachments`
-- -----------------------------------------------------------------------------
-- O bucket é privado: todo acesso é mediado pelas policies abaixo + signed URLs
-- emitidas pelo cliente Supabase autenticado.

create policy "attachments_storage_select_member"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'attachments' and public.is_active_member());

create policy "attachments_storage_insert_member"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and owner = auth.uid()
    and public.is_active_member()
  );

create policy "attachments_storage_delete_own_or_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and (owner = auth.uid() or public.is_admin())
  );
