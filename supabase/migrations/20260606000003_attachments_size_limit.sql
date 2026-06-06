-- =============================================================================
-- Aumenta limite por arquivo do bucket `attachments`
-- =============================================================================
-- O default do Supabase é 50 MB. Pra anexar vídeos de celular / WhatsApp
-- (frequentemente 80-150 MB) o limite precisa ser maior. Subimos pra 500 MB,
-- compatível com o MAX_FILE_SIZE de 200 MB no client e com margem.
--
-- IMPORTANTE: existe também o limite GLOBAL do projeto no Supabase. Em
-- plano free é 50 MB; em plano Pro vai até 500 GB. Se esta migration rodar
-- mas o upload de arquivo grande continuar falhando, é provável que o
-- limite global ainda esteja apertando — checar em Storage → Settings.
-- =============================================================================

update storage.buckets
  set file_size_limit = 500 * 1024 * 1024
  where id = 'attachments';
