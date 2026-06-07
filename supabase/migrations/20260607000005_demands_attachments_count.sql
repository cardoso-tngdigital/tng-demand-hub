-- =============================================================================
-- attachments_count denormalizada em demands
-- =============================================================================
-- Mesmo padrão da comments_count (Sprint 10) — badge no card precisa do
-- número sem subselect a cada render. Trigger mantém em sincronia.
--
-- Não decrementamos no DELETE porque o on delete cascade da FK
-- demands.attachments → demands já remove o registro junto da demanda;
-- o trigger não dispararia útil nesse caso. Mantemos por simetria.
-- =============================================================================

alter table public.demands
  add column if not exists attachments_count integer not null default 0;

create or replace function public.bump_demand_attachments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.demands
      set attachments_count = attachments_count + 1
      where id = new.demand_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.demands
      set attachments_count = greatest(attachments_count - 1, 0)
      where id = old.demand_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_attachments_count on public.attachments;
create trigger trg_attachments_count
  after insert or delete on public.attachments
  for each row execute function public.bump_demand_attachments_count();

-- Backfill — leva os contadores ao valor real.
update public.demands d
  set attachments_count = coalesce(c.cnt, 0)
  from (
    select demand_id, count(*) as cnt
      from public.attachments
      group by demand_id
  ) c
  where c.demand_id = d.id;
