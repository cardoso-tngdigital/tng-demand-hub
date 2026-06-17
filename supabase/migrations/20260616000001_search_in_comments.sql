-- =============================================================================
-- TNG Demand Hub — Busca server-side em comentários (Sprint 14)
-- =============================================================================
-- O Cmd+K do app busca local em título/descrição/tags (dados já em memória
-- via realtime), mas comentários ficam só no banco. Esta função expõe um
-- ponto único pra buscar texto dentro de `comments.content` e devolve os
-- demand_ids que matcharam — o cliente mescla com o resultado local.
--
-- ILIKE com curinga é suficiente pro volume atual (centenas de comentários).
-- Se a base crescer pra milhares, migrar pra tsvector + GIN index.
-- =============================================================================

create or replace function public.search_comment_demand_ids(q text)
returns table (
  demand_id uuid,
  excerpt text
)
language sql
security invoker
set search_path = public
stable
as $$
  with normalized as (
    select lower(trim(coalesce(q, ''))) as q_str
  )
  select distinct on (c.demand_id)
    c.demand_id,
    -- Trecho com ~30 chars antes do match e 90 depois, pro user identificar
    -- contexto sem expandir o resultado todo.
    substring(
      c.content,
      greatest(1, position(normalized.q_str in lower(c.content)) - 30),
      120
    ) as excerpt
  from public.comments c, normalized
  where normalized.q_str <> ''
    and lower(c.content) like '%' || normalized.q_str || '%'
    and public.is_active_member()
  order by c.demand_id, c.created_at desc;
$$;

revoke all on function public.search_comment_demand_ids(text) from public;
grant execute on function public.search_comment_demand_ids(text) to authenticated;
