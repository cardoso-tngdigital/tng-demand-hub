-- =============================================================================
-- 20260710000001_attachments_reorder.sql
-- Reordenação manual de anexos (drag-and-drop) — 2026-07-10.
-- =============================================================================
-- Demandas com muitos anexos precisam de uma ordem que faça sentido pro
-- operador, não só a ordem de upload. Adiciona `sort_order` e permite que
-- membros ativos reordenem (UPDATE), via um RPC atômico.
-- =============================================================================

-- Coluna de ordenação. NULL = ainda não posicionado manualmente (cai pro
-- created_at na listagem). Após um reorder, todos os anexos da demanda
-- recebem 0,1,2,… explícitos.
alter table public.attachments
  add column if not exists sort_order integer;

-- Índice pra ordenar rápido por demanda.
create index if not exists attachments_demand_order_idx
  on public.attachments (demand_id, sort_order nulls last, created_at);

-- ---------------------------------------------------------------------------
-- RLS — permitir UPDATE (reorder) a membros ativos.
-- Antes não havia policy de UPDATE (reorder era negado por RLS).
-- ---------------------------------------------------------------------------
drop policy if exists "attachments_update_member" on public.attachments;
create policy "attachments_update_member"
  on public.attachments for update
  to authenticated
  using (public.is_active_member())
  with check (public.is_active_member());

-- ---------------------------------------------------------------------------
-- RPC atômico: aplica a nova ordem de uma vez.
-- `security invoker` (padrão) → roda sob a RLS do chamador (a policy acima).
-- ---------------------------------------------------------------------------
create or replace function public.reorder_attachments(
  p_demand_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
as $$
begin
  update public.attachments a
  set sort_order = idx.ord
  from (
    select id, (ordinality - 1)::int as ord
    from unnest(p_ordered_ids) with ordinality as t(id, ordinality)
  ) idx
  where a.id = idx.id
    and a.demand_id = p_demand_id;
end;
$$;

grant execute on function public.reorder_attachments(uuid, uuid[]) to authenticated;
