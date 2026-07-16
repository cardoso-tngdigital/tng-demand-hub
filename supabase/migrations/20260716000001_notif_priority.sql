-- =============================================================================
-- Notificação de mudança de PRIORIDADE
-- =============================================================================
-- Faltava: o gatilho de demands só notificava atribuição e status. Aqui
-- adicionamos 'priority' como tipo de notificação e o trecho no trigger de
-- UPDATE que dispara quando a prioridade muda. Mesmos destinatários dos demais
-- (responsável + criador + admins, menos quem fez a ação).
-- =============================================================================

-- 1) Libera o novo tipo no CHECK.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('assigned','status','comment','mention','due','attachment','priority'));

-- 2) Rótulo pt-BR da prioridade (mesmos labels da UI).
create or replace function public._priority_label(p text)
returns text language sql immutable as $$
  select case p
    when 'baixa'   then 'Baixa'
    when 'media'   then 'Média'
    when 'alta'    then 'Alta'
    when 'urgente' then 'Urgente'
    else p
  end;
$$;

-- 3) Trigger de UPDATE de demands passa a cobrir prioridade também.
--    (regra do 'priority' cai no `else true` de _notif_pref_allows — sempre
--    notifica, sem toggle dedicado, igual a 'status'.)
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

  -- Mudança de prioridade.
  if new.priority is distinct from old.priority then
    perform public._notify_demand_watchers(
      new.id, 'priority', 'Prioridade alterada',
      v_title || ' — ' || public._priority_label(old.priority) || ' → ' || public._priority_label(new.priority),
      v_actor);
  end if;

  return null;
end;
$$;
