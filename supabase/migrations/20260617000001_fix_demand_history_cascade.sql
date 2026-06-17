-- =============================================================================
-- Fix: FK violation ao excluir demanda com comentários
-- =============================================================================
-- Sintoma: ao DELETE em public.demands, o CASCADE em public.comments dispara o
-- trigger AFTER DELETE `demand_history_track_comments`, que tenta inserir uma
-- row em demand_history com demand_id da demand sendo apagada. Como a row pai
-- já está em processo de remoção dentro da mesma transação, a FK
-- demand_history_demand_id_fkey viola e o DELETE inteiro falha.
--
-- Solução: no caminho de DELETE do trigger, pular o log quando a demand não
-- existe mais (cenário típico de CASCADE). O histórico inteiro será apagado
-- junto via CASCADE de qualquer forma, então registrar `comment_deleted` aqui
-- não tem valor.
-- =============================================================================

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
    -- Guard contra CASCADE: se a demand inteira já foi apagada, a FK
    -- demand_history.demand_id viola dentro da mesma TX. Pula o log nesse caso.
    if not exists (select 1 from public.demands where id = old.demand_id) then
      return old;
    end if;
    insert into public.demand_history (
      demand_id, event_type, actor_id
    ) values (
      old.demand_id, 'comment_deleted', auth.uid()
    );
    return old;
  end if;
  return null;
end $$;
