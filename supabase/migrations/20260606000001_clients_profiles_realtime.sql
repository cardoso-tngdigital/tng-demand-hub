-- =============================================================================
-- TNG Demand Hub — clients e profiles no Realtime (Sprint 10)
-- =============================================================================
-- Permite que a janela flutuante de captura (que fica viva escondida entre
-- usos) receba clientes e membros recém-cadastrados sem precisar recarregar
-- o app.
-- =============================================================================

alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.profiles;
