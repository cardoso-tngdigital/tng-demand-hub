-- =============================================================================
-- TNG Demand Hub — REPLICA IDENTITY FULL em demands e comments (Sprint 7)
-- =============================================================================
-- Por padrão o Postgres só envia a PK no payload `old` dos UPDATE/DELETE via
-- replication. Para a UI saber, no Realtime, quem ERA o responsável anterior
-- (e decidir se notifica), precisamos do registro inteiro como `old`.
-- =============================================================================

alter table public.demands  replica identity full;
alter table public.comments replica identity full;
