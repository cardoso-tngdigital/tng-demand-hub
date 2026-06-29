-- Sprint 19 (v0.1.10): liberar leitura de demand_history pra todos os
-- membros ativos. A policy original (Sprint 11) restringia SELECT a
-- is_admin(), mas o histórico é útil pro time inteiro entender mudanças
-- nas próprias demandas. Não há conteúdo sensível além de snapshots de
-- status/responsável/atribuição/prazo etc — texto livre (comentários,
-- descrições) não é gravado em demand_history.
--
-- INSERTs continuam exclusivamente via triggers SECURITY DEFINER em
-- demands/comments/attachments — sem policy de INSERT pra authenticated,
-- nenhum cliente consegue forjar entradas.

drop policy if exists "demand_history_select_admin" on public.demand_history;

create policy "demand_history_select_members"
  on public.demand_history for select
  to authenticated
  using (public.is_active_member());
