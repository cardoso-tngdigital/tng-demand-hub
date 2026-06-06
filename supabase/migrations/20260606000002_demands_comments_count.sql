-- =============================================================================
-- comments_count denormalizada em demands
-- =============================================================================
-- Motivação: lista e Kanban mostram badge "💬 N" nos cards. Contar via
-- subselect a cada render seria caro; mantemos o contador atualizado via
-- trigger barata em insert/delete.
--
-- Notas:
-- - Não é exposta como source-of-truth: se ficar fora de sincronia (raro,
--   exigiria insert/delete fora de transação atômica), o backfill abaixo
--   pode ser re-rodado.
-- - greatest(.., 0) impede ficar negativo se o trigger for habilitado
--   depois de deletes não contabilizados.
-- =============================================================================

alter table public.demands
  add column if not exists comments_count integer not null default 0;

create or replace function public.bump_demand_comments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.demands
      set comments_count = comments_count + 1
      where id = new.demand_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.demands
      set comments_count = greatest(comments_count - 1, 0)
      where id = old.demand_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_comments_count on public.comments;
create trigger trg_comments_count
  after insert or delete on public.comments
  for each row execute function public.bump_demand_comments_count();

-- Backfill — leva os contadores ao valor real.
update public.demands d
  set comments_count = coalesce(c.cnt, 0)
  from (
    select demand_id, count(*) as cnt
      from public.comments
      group by demand_id
  ) c
  where c.demand_id = d.id;
