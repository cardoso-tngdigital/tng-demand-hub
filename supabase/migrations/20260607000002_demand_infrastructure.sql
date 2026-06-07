-- =============================================================================
-- Infraestrutura da demanda (wordpress vs site_ia)
-- =============================================================================
-- A TNG opera dois tipos de stack pros clientes:
--   - wordpress  (sites tradicionais em WP)
--   - site_ia    (sites gerados/operados com IA)
-- Saber o tipo na lista permite priorização visual e separação operacional
-- (o time de WP e o time de IA são diferentes em alguns clientes).
--
-- null = "ainda não classificada". A IA tenta inferir do contexto da
-- captura; o user pode mudar no drawer.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'demand_infrastructure') then
    create type public.demand_infrastructure as enum ('wordpress', 'site_ia');
  end if;
end $$;

alter table public.demands
  add column if not exists infrastructure public.demand_infrastructure;

comment on column public.demands.infrastructure is
  'Stack do site da demanda. NULL quando não classificada.';

create index if not exists demands_infrastructure_idx
  on public.demands (infrastructure)
  where infrastructure is not null;
