-- =============================================================================
-- Múltiplos links por cliente, cada um com label (Sprint 16 / v0.1.7)
-- =============================================================================
-- Clientes com mais de uma unidade (Oficina do Smart com 5, AM Advocacia com 3,
-- NotebookCE com 2, etc.) precisam armazenar mais de um perfil Google Meu
-- Negócio e, às vezes, mais de um grupo de WhatsApp. O formato anterior
-- (`google_business_url text` + `whatsapp_group_url text` + `drive_urls text[]`)
-- não acomodava isso.
--
-- Esta migration substitui as 3 colunas por arrays jsonb uniformes, onde cada
-- item é `{label, url}`. `label` é opcional e tipicamente carrega o nome da
-- unidade ("Savassi", "Recreio", "Santo Amaro"). Quando vazia, a UI cai no
-- fallback padrão ("Google Meu Negócio", "Grupo no WhatsApp", "Google Drive").
--
-- Os clientes já cadastrados são preservados: o `update` antes dos `drop`
-- converte cada valor scalar/array existente para o novo formato jsonb.
-- =============================================================================

-- 1) Adicionar novas colunas jsonb (default array vazio)
alter table public.clients
  add column if not exists google_business_urls jsonb not null default '[]'::jsonb,
  add column if not exists whatsapp_group_urls  jsonb not null default '[]'::jsonb,
  add column if not exists drive_urls_v2        jsonb not null default '[]'::jsonb;

-- 2) Migrar dados existentes
update public.clients
  set google_business_urls = jsonb_build_array(
    jsonb_build_object('label', '', 'url', google_business_url)
  )
  where google_business_url is not null and trim(google_business_url) <> '';

update public.clients
  set whatsapp_group_urls = jsonb_build_array(
    jsonb_build_object('label', '', 'url', whatsapp_group_url)
  )
  where whatsapp_group_url is not null and trim(whatsapp_group_url) <> '';

update public.clients
  set drive_urls_v2 = coalesce((
    select jsonb_agg(jsonb_build_object('label', '', 'url', d))
    from unnest(drive_urls) as d
    where d is not null and trim(d) <> ''
  ), '[]'::jsonb)
  where array_length(drive_urls, 1) > 0;

-- 3) Trocar colunas antigas pelas novas
alter table public.clients
  drop column google_business_url,
  drop column whatsapp_group_url,
  drop column drive_urls;

alter table public.clients
  rename column drive_urls_v2 to drive_urls;

-- 4) Sanity checks — garante que ninguém grava um objeto solto no lugar de array
alter table public.clients
  add constraint clients_google_business_urls_is_array
    check (jsonb_typeof(google_business_urls) = 'array'),
  add constraint clients_whatsapp_group_urls_is_array
    check (jsonb_typeof(whatsapp_group_urls) = 'array'),
  add constraint clients_drive_urls_is_array
    check (jsonb_typeof(drive_urls) = 'array');

-- 5) Comentários documentam o formato pra quem ler o schema
comment on column public.clients.google_business_urls is
  'Perfis Google Meu Negócio. jsonb array de {label,url}. Label = nome da unidade (opcional).';
comment on column public.clients.whatsapp_group_urls is
  'Grupos do WhatsApp. jsonb array de {label,url}. Label = nome da unidade ou referência (opcional).';
comment on column public.clients.drive_urls is
  'Pastas/documentos no Google Drive. jsonb array de {label,url}. Label opcional.';
