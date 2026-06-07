-- =============================================================================
-- Histórico de alterações por demanda
-- =============================================================================
-- Tabela append-only que registra eventos relevantes na vida de uma demanda:
--   - created            : demanda criada
--   - field_changed      : algum campo escalar mudou (status, priority, etc.)
--   - comment_added      : novo comentário
--   - comment_deleted    : comentário removido (admin)
--   - attachment_added   : novo anexo
--
-- Visibilidade: somente admins (RLS). Inserts vêm de triggers SECURITY
-- DEFINER, então RLS de insert não precisa abrir pra todo mundo.
--
-- Resolução de "quem fez": auth.uid() na transação. Para INSERTs feitos
-- pela Edge Function (service_role), gravamos created_by/uploaded_by da
-- linha como ator.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela
-- -----------------------------------------------------------------------------

create type public.demand_history_event as enum (
  'created',
  'field_changed',
  'comment_added',
  'comment_deleted',
  'attachment_added'
);

create table public.demand_history (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references public.demands (id) on delete cascade,
  event_type public.demand_history_event not null,
  field text,             -- preenchido só quando event_type='field_changed'
  old_value text,         -- pode ser null (campo era null / evento sem antes)
  new_value text,         -- idem
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.demand_history is
  'Trilha de auditoria por demanda. Somente admins têm SELECT (ver policy).';

create index demand_history_demand_idx
  on public.demand_history (demand_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS — só admins leem; inserts via SECURITY DEFINER dos triggers abaixo
-- -----------------------------------------------------------------------------

alter table public.demand_history enable row level security;

create policy "demand_history_select_admin"
  on public.demand_history for select
  to authenticated
  using (public.is_admin());

-- Não criamos policy de INSERT pra authenticated: todos os inserts vêm de
-- triggers SECURITY DEFINER (que bypassam RLS). Isso garante que nenhum
-- cliente pode forjar entradas no histórico.

-- -----------------------------------------------------------------------------
-- Helper: registra mudança de campo
-- -----------------------------------------------------------------------------

create or replace function public.log_demand_field_change(
  p_demand_id uuid,
  p_field text,
  p_old text,
  p_new text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_old is null and p_new is null then return; end if;
  if p_old is not distinct from p_new then return; end if;
  insert into public.demand_history (
    demand_id, event_type, field, old_value, new_value, actor_id
  ) values (
    p_demand_id, 'field_changed', p_field, p_old, p_new, p_actor
  );
end $$;

-- -----------------------------------------------------------------------------
-- Trigger: demands INSERT/UPDATE
-- -----------------------------------------------------------------------------
-- INSERT → registra evento 'created' (sem detalhes de campo).
-- UPDATE → registra uma linha por campo escalar alterado.

create or replace function public.demand_history_track()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
begin
  -- Quem fez a mudança: auth.uid() da transação. Pode ser null para Edge
  -- Functions service_role; nesse caso usamos created_by.
  actor := coalesce(auth.uid(), case
    when tg_op = 'INSERT' then new.created_by
    else new.created_by
  end);

  if tg_op = 'INSERT' then
    insert into public.demand_history (
      demand_id, event_type, actor_id
    ) values (
      new.id, 'created', actor
    );
    return new;
  end if;

  -- UPDATE: compara cada campo escalar relevante e loga as diferenças.
  perform log_demand_field_change(new.id, 'title',
    old.title, new.title, actor);
  perform log_demand_field_change(new.id, 'description',
    old.description, new.description, actor);
  perform log_demand_field_change(new.id, 'status',
    old.status::text, new.status::text, actor);
  perform log_demand_field_change(new.id, 'priority',
    old.priority::text, new.priority::text, actor);
  perform log_demand_field_change(new.id, 'due_date',
    old.due_date::text, new.due_date::text, actor);
  perform log_demand_field_change(new.id, 'client_id',
    old.client_id::text, new.client_id::text, actor);
  perform log_demand_field_change(new.id, 'assignee_id',
    old.assignee_id::text, new.assignee_id::text, actor);
  perform log_demand_field_change(new.id, 'infrastructure',
    old.infrastructure::text, new.infrastructure::text, actor);
  perform log_demand_field_change(new.id, 'tags',
    array_to_string(old.tags, ', '),
    array_to_string(new.tags, ', '),
    actor);
  return new;
end $$;

drop trigger if exists trg_demand_history_track on public.demands;
create trigger trg_demand_history_track
  after insert or update on public.demands
  for each row execute function public.demand_history_track();

-- -----------------------------------------------------------------------------
-- Trigger: comments INSERT/DELETE
-- -----------------------------------------------------------------------------

create or replace function public.demand_history_track_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.demand_history (
      demand_id, event_type, actor_id
    ) values (
      new.demand_id, 'comment_added', new.author_id
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.demand_history (
      demand_id, event_type, actor_id
    ) values (
      old.demand_id, 'comment_deleted', auth.uid()
    );
    return old;
  end if;
  return null;
end $$;

drop trigger if exists trg_demand_history_track_comments on public.comments;
create trigger trg_demand_history_track_comments
  after insert or delete on public.comments
  for each row execute function public.demand_history_track_comments();

-- -----------------------------------------------------------------------------
-- Trigger: attachments INSERT
-- -----------------------------------------------------------------------------

create or replace function public.demand_history_track_attachments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.demand_history (
    demand_id, event_type, new_value, actor_id
  ) values (
    new.demand_id, 'attachment_added', new.file_name, new.uploaded_by
  );
  return new;
end $$;

drop trigger if exists trg_demand_history_track_attachments on public.attachments;
create trigger trg_demand_history_track_attachments
  after insert on public.attachments
  for each row execute function public.demand_history_track_attachments();
