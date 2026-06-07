-- =============================================================================
-- Links externos por cliente (Sprint 11 / refinamento pré-beta)
-- =============================================================================
-- Cada cliente costuma ter um conjunto de URLs operacionais que a equipe
-- acessa o tempo todo: Google Meu Negócio, pastas no Drive (várias) e o
-- grupo do WhatsApp do cliente. Mantemos como colunas dedicadas (em vez
-- de um campo jsonb genérico) pra facilitar:
--   - Indexação semântica na UI (cada link tem ícone próprio)
--   - Compatibilidade com Postgres array (drive_urls é text[])
--   - Migração futura sem precisar caçar chaves dentro de json
-- Todos opcionais — nenhum cliente é forçado a ter os 3.
-- =============================================================================

alter table public.clients
  add column if not exists google_business_url text,
  add column if not exists drive_urls text[] not null default '{}',
  add column if not exists whatsapp_group_url text;

comment on column public.clients.google_business_url is
  'Link do perfil Google Meu Negócio do cliente. Opcional.';
comment on column public.clients.drive_urls is
  'Pastas/Documentos no Google Drive relacionados ao cliente. Array de URLs.';
comment on column public.clients.whatsapp_group_url is
  'Convite do grupo do WhatsApp do cliente (chat.whatsapp.com/...). Opcional.';
