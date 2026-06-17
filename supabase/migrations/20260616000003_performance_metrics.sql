-- =============================================================================
-- TNG Demand Hub — Métricas de desempenho por membro (Sprint 14)
-- =============================================================================
-- RPC consultada pelo Painel de Desempenho (admin). Agrega dados de
-- `demands` e `demand_history` por assignee num intervalo de datas.
--
-- Métricas devolvidas:
--   - completed_count: demandas com status='done' e completed_at no período
--   - open_count: demandas em aberto agora (todo + doing)
--   - overdue_count: em aberto com due_date < hoje
--   - avg_total_seconds: tempo médio entre criação e conclusão
--   - avg_response_seconds: tempo médio entre criação e 1ª transição p/ doing
--                          (quanto demora pra começar a trabalhar)
--   - avg_execution_seconds: tempo médio entre 1ª transição doing e 1ª done
--                            (quanto demora pra executar depois que começou)
--
-- Restrita a admin via guarda `is_admin()`. Member sem acesso recebe 0 rows.
-- =============================================================================

create or replace function public.member_performance_metrics(
  start_date date,
  end_date date
)
returns table (
  member_id uuid,
  member_name text,
  completed_count int,
  open_count int,
  overdue_count int,
  avg_total_seconds double precision,
  avg_response_seconds double precision,
  avg_execution_seconds double precision
)
language sql
security invoker
set search_path = public
stable
as $$
  with completed as (
    -- Demandas concluídas no intervalo, com o assignee no momento atual.
    -- (Reassignments antes do done atribuem à pessoa que estava na hora do
    -- fechamento — comportamento natural pra "quem entregou".)
    select d.id, d.assignee_id, d.created_at, d.completed_at
    from demands d
    where d.status = 'done'
      and d.completed_at is not null
      and d.completed_at >= start_date::timestamptz
      and d.completed_at < (end_date::date + 1)::timestamptz
      and d.assignee_id is not null
  ),
  first_doing as (
    select demand_id, min(created_at) as at
    from demand_history
    where event_type = 'field_changed'
      and field = 'status'
      and new_value = 'doing'
    group by demand_id
  ),
  first_done as (
    select demand_id, min(created_at) as at
    from demand_history
    where event_type = 'field_changed'
      and field = 'status'
      and new_value = 'done'
    group by demand_id
  ),
  per_member_completed as (
    select
      c.assignee_id,
      count(*)::int as completed_count,
      avg(extract(epoch from (c.completed_at - c.created_at)))
        as avg_total_seconds,
      avg(extract(epoch from (fd.at - c.created_at)))
        filter (where fd.at is not null) as avg_response_seconds,
      avg(extract(epoch from (fdone.at - fd.at)))
        filter (where fdone.at is not null and fd.at is not null)
        as avg_execution_seconds
    from completed c
    left join first_doing fd on fd.demand_id = c.id
    left join first_done fdone on fdone.demand_id = c.id
    group by c.assignee_id
  ),
  per_member_open as (
    select
      assignee_id,
      count(*) filter (where status in ('todo','doing'))::int
        as open_count,
      count(*) filter (
        where status in ('todo','doing') and due_date < current_date
      )::int as overdue_count
    from demands
    where assignee_id is not null
    group by assignee_id
  )
  select
    p.id as member_id,
    p.full_name as member_name,
    coalesce(c.completed_count, 0) as completed_count,
    coalesce(o.open_count, 0) as open_count,
    coalesce(o.overdue_count, 0) as overdue_count,
    c.avg_total_seconds,
    c.avg_response_seconds,
    c.avg_execution_seconds
  from profiles p
  left join per_member_completed c on c.assignee_id = p.id
  left join per_member_open o on o.assignee_id = p.id
  where p.active = true
    and public.is_admin()
  order by p.full_name;
$$;

revoke all on function public.member_performance_metrics(date, date) from public;
grant execute on function public.member_performance_metrics(date, date) to authenticated;
