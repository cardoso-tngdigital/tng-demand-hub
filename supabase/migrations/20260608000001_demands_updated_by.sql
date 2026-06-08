-- =============================================================================
-- Coluna updated_by em demands
-- =============================================================================
-- Rastreia quem fez a última alteração na demanda. Usado pelas notificações
-- pra mostrar "Fulano alterou X" sem precisar joinar com demand_history.
--
-- Convenções:
--   - INSERT: fica null (o created_by já registra o autor inicial).
--   - UPDATE: o trigger seta auth.uid() — o user da request HTTP.
--   - UPDATE feito via service_role (Edge Functions, jobs): auth.uid() é null,
--     mantemos o valor anterior pra não sobrescrever com null.
-- =============================================================================

alter table public.demands
  add column if not exists updated_by uuid references public.profiles(id);

create or replace function public.set_demand_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_demand_updated_by_trigger on public.demands;
create trigger set_demand_updated_by_trigger
  before update on public.demands
  for each row execute function public.set_demand_updated_by();
