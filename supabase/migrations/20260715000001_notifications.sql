-- =============================================================================
-- Centro de notificações IN-APP (criação server-side)
-- =============================================================================
-- Até aqui as notificações eram decididas 100% no CLIENTE: cada app recebia o
-- evento de realtime e o notificationDecider.ts decidia se disparava o banner
-- nativo. Isso tinha um furo estrutural: se o app do destinatário estava
-- FECHADO quando o evento aconteceu, nenhuma notificação era registrada — ao
-- reabrir, ele não tinha como saber o que perdeu.
--
-- Esta migration move a CRIAÇÃO das notificações pro SERVIDOR (triggers no
-- Postgres). Cada evento relevante grava uma linha PERSISTENTE por destinatário
-- na tabela `notifications`, independente de quem está online. O app então:
--   - assina a tabela via realtime (filtrado por user_id) -> dispara o banner
--     nativo do SO e atualiza o contador/popup do sino;
--   - ao reabrir, lê as não lidas e mostra o popup.
--
-- Modelo: UMA linha por DESTINATÁRIO (não um evento global). Assim "admin vê
-- tudo" cai naturalmente (o admin recebe uma linha de cada evento) e o estado
-- "lida" é só o booleano `read` da própria linha. RLS deixa cada um ver/mexer
-- só nas suas.
--
-- "Lida" = a NOTIFICAÇÃO foi vista (clicada no popup do app OU no banner do SO).
-- NÃO tem a ver com abrir a demanda por navegação normal (lista/kanban/busca) —
-- isso é responsabilidade do cliente, não do banco.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela
-- -----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  demand_id  uuid references public.demands (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  type       text not null check (type in ('assigned','status','comment','mention','due','attachment')),
  title      text not null default '',
  body       text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.notifications is 'Notificações in-app, uma linha por destinatário. Criadas server-side por triggers.';
comment on column public.notifications.actor_id is 'Quem disparou o evento (null p/ eventos do sistema, ex.: prazo).';
comment on column public.notifications.read is 'true quando o destinatário interagiu com a NOTIFICAÇÃO (popup ou banner do SO).';

create index notifications_user_idx        on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read = false;
create index notifications_demand_idx      on public.notifications (demand_id);

alter table public.notifications enable row level security;

-- Cada um só vê/mexe nas suas. Sem policy de INSERT: apenas os triggers
-- SECURITY DEFINER inserem (o cliente NUNCA forja notificação).
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete_own on public.notifications
  for delete using (user_id = auth.uid());

-- Realtime: o cliente assina INSERT (novas) e UPDATE (marcar lida sincroniza
-- o contador entre sessões/dispositivos).
alter publication supabase_realtime add table public.notifications;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Rótulo pt-BR do status (mesmos usados na UI).
create or replace function public._status_label(s text)
returns text language sql immutable as $$
  select case s
    when 'todo'     then 'A fazer'
    when 'doing'    then 'Em andamento'
    when 'done'     then 'Concluída'
    when 'archived' then 'Arquivada'
    else s
  end;
$$;

-- Preferências de notificação: respeita os toggles existentes em
-- profiles.notifications. Chave ausente => permitido (default true). Tipos sem
-- toggle dedicado (status, attachment) sempre passam.
create or replace function public._notif_pref_allows(prefs jsonb, p_type text)
returns boolean language sql immutable as $$
  select case p_type
    when 'assigned' then coalesce((prefs->>'assigned')::boolean, true)
    when 'comment'  then coalesce((prefs->>'comments')::boolean, true)
    when 'mention'  then coalesce((prefs->>'mentions')::boolean, true)
    when 'due'      then coalesce((prefs->>'due_soon')::boolean, true)
    else true
  end;
$$;

-- Insere uma notificação para o "watchers" de uma demanda: responsável +
-- criador + todos os admins ativos, MENOS o autor da ação (auth.uid()),
-- deduplicado e respeitando as prefs de cada um.
create or replace function public._notify_demand_watchers(
  p_demand_id uuid, p_type text, p_title text, p_body text, p_actor uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_assignee uuid;
  v_creator  uuid;
begin
  select assignee_id, created_by into v_assignee, v_creator
  from public.demands where id = p_demand_id;

  insert into public.notifications (user_id, demand_id, actor_id, type, title, body)
  select distinct r.uid, p_demand_id, p_actor, p_type, p_title, p_body
  from (
    select v_assignee as uid where v_assignee is not null
    union
    select v_creator      where v_creator  is not null
    union
    select p.id from public.profiles p where p.role = 'admin' and p.active = true
  ) r
  join public.profiles pr on pr.id = r.uid
  where pr.active = true
    and r.uid <> coalesce(p_actor, '00000000-0000-0000-0000-000000000000'::uuid)
    and public._notif_pref_allows(pr.notifications, p_type);
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger: demands (atribuição + QUALQUER mudança de status)
-- -----------------------------------------------------------------------------
create or replace function public._notif_on_demand_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_title text := coalesce(nullif(new.title, ''), 'Demanda sem título');
begin
  -- Atribuição: quando o responsável muda para alguém.
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform public._notify_demand_watchers(
      new.id, 'assigned', 'Nova atribuição',
      v_title || ' — responsável: ' ||
        coalesce((select full_name from public.profiles where id = new.assignee_id), 'alguém'),
      v_actor);
  end if;

  -- Qualquer mudança de status (não só "concluída").
  if new.status is distinct from old.status then
    perform public._notify_demand_watchers(
      new.id, 'status', 'Status atualizado',
      v_title || ' — ' || public._status_label(old.status) || ' → ' || public._status_label(new.status),
      v_actor);
  end if;

  return null;
end;
$$;

create trigger notif_demand_update
  after update on public.demands
  for each row execute function public._notif_on_demand_update();

-- Demanda criada JÁ com responsável (comum na captura: a IA/usuário atribui na
-- hora). Notifica a atribuição — o autor (criador) é excluído pelo watchers, então
-- se ele se auto-atribuir não recebe nada.
create or replace function public._notif_on_demand_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_title text := coalesce(nullif(new.title, ''), 'Demanda sem título');
begin
  if new.assignee_id is not null then
    perform public._notify_demand_watchers(
      new.id, 'assigned', 'Nova atribuição',
      v_title || ' — responsável: ' ||
        coalesce((select full_name from public.profiles where id = new.assignee_id), 'alguém'),
      v_actor);
  end if;
  return null;
end;
$$;

create trigger notif_demand_insert
  after insert on public.demands
  for each row execute function public._notif_on_demand_insert();

-- -----------------------------------------------------------------------------
-- Trigger: comments (menção tem prioridade sobre comentário)
-- -----------------------------------------------------------------------------
create or replace function public._notif_on_comment_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor    uuid := auth.uid();
  v_title    text;
  v_author   text;
  v_assignee uuid;
  v_creator  uuid;
begin
  select coalesce(nullif(d.title, ''), 'Demanda sem título'), d.assignee_id, d.created_by
    into v_title, v_assignee, v_creator
  from public.demands d where d.id = new.demand_id;

  v_author := coalesce((select full_name from public.profiles where id = new.author_id), 'alguém');

  -- 1) Menções: cada mencionado (ativo, != autor) recebe 'mention'.
  insert into public.notifications (user_id, demand_id, actor_id, type, title, body)
  select distinct m, new.demand_id, v_actor, 'mention', 'Você foi mencionado', v_title || ' — ' || v_author
  from unnest(new.mentions) as m
  join public.profiles pr on pr.id = m
  where pr.active = true
    and m <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid)
    and public._notif_pref_allows(pr.notifications, 'mention');

  -- 2) Comentário: watchers que NÃO foram mencionados e != autor.
  insert into public.notifications (user_id, demand_id, actor_id, type, title, body)
  select distinct r.uid, new.demand_id, v_actor, 'comment', 'Novo comentário', v_title || ' — ' || v_author
  from (
    select v_assignee as uid where v_assignee is not null
    union select v_creator      where v_creator  is not null
    union select p.id from public.profiles p where p.role = 'admin' and p.active = true
  ) r
  join public.profiles pr on pr.id = r.uid
  where pr.active = true
    and r.uid <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid)
    and r.uid <> all(new.mentions)
    and public._notif_pref_allows(pr.notifications, 'comment');

  return null;
end;
$$;

create trigger notif_comment_insert
  after insert on public.comments
  for each row execute function public._notif_on_comment_insert();

-- -----------------------------------------------------------------------------
-- Trigger: attachments (só pós-criação; 1 por lote; p/ responsável + admins)
-- -----------------------------------------------------------------------------
create or replace function public._notif_on_attachment_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor          uuid := auth.uid();
  v_title          text;
  v_demand_created timestamptz;
  v_assignee       uuid;
begin
  select coalesce(nullif(d.title, ''), 'Demanda sem título'), d.created_at, d.assignee_id
    into v_title, v_demand_created, v_assignee
  from public.demands d where d.id = new.demand_id;

  -- Suprime os anexos da CAPTURA INICIAL (inseridos logo após criar a demanda).
  -- Só notifica anexos adicionados DEPOIS. Janela de 2 min cobre o burst da
  -- captura (que insere em segundos) sem pegar adições deliberadas posteriores.
  if new.created_at < v_demand_created + interval '2 minutes' then
    return null;
  end if;

  -- Agrupa por LOTE: se já existe notificação de anexo pra esta demanda nos
  -- últimos 10 min, não cria outra (10 imagens de uma vez => 1 notificação;
  -- no outro dia +5 => novo lote => nova notificação).
  if exists (
    select 1 from public.notifications
    where demand_id = new.demand_id and type = 'attachment'
      and created_at > now() - interval '10 minutes'
  ) then
    return null;
  end if;

  -- Destinatário: responsável da demanda + admins ativos, menos quem anexou.
  insert into public.notifications (user_id, demand_id, actor_id, type, title, body)
  select distinct r.uid, new.demand_id, v_actor, 'attachment', 'Anexo adicionado', v_title
  from (
    select v_assignee as uid where v_assignee is not null
    union select p.id from public.profiles p where p.role = 'admin' and p.active = true
  ) r
  join public.profiles pr on pr.id = r.uid
  where pr.active = true
    and r.uid <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid);

  return null;
end;
$$;

create trigger notif_attachment_insert
  after insert on public.attachments
  for each row execute function public._notif_on_attachment_insert();

-- -----------------------------------------------------------------------------
-- Bridge: demand_due_notifications -> notifications
-- -----------------------------------------------------------------------------
-- O pipeline de prazo (pg_cron + compute_due_notifications) já grava em
-- demand_due_notifications 1 linha por (demanda,user,bucket), JÁ filtrando pela
-- pref due_soon. Aqui só espelhamos pra notifications pra aparecer no centro.
create or replace function public._notif_on_due_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  select coalesce(nullif(title, ''), 'Demanda sem título') into v_title
  from public.demands where id = new.demand_id;

  insert into public.notifications (user_id, demand_id, actor_id, type, title, body)
  values (
    new.user_id, new.demand_id, null, 'due', 'Prazo se aproximando',
    v_title || ' — ' || case new.bucket
      when '24h' then 'vence em 24h'
      when '3d'  then 'vence em 3 dias'
      else 'vence em 5 dias'
    end
  );
  return null;
end;
$$;

create trigger notif_due_insert
  after insert on public.demand_due_notifications
  for each row execute function public._notif_on_due_insert();
