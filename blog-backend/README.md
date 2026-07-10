# tng-blog-backend

Sidecar TypeScript do TNG Demand Hub. Motor do painel Blog que substitui o app Python `Blog - TNG Digital/`.

## Por que existe

O Blog original em Python (`../Blog - TNG Digital/`) funciona, mas exige WSL no Windows por causa do cliente MCP do Magnific. Para distribuir pra equipe (Mac + Windows) sem exigir WSL, foi reescrito em Node.js/TypeScript com os SDKs oficiais (`@google/genai`, `@modelcontextprotocol/sdk`) que rodam nativos em ambos os SOs.

## Stack

- **Runtime:** Bun (compila num binário único ~45 MB pra Mac e Windows)
- **Servidor:** Hono
- **Gemini:** `@google/genai` (SDK oficial Google)
- **MCP Magnific:** `@modelcontextprotocol/sdk` (SDK oficial Anthropic)
- **Imagens:** Sharp (redimensiona WebP 1200px)
- **Supabase:** `@supabase/supabase-js` com `.schema('blog')`
- **DOCX:** `docx`

## Como rodar (dev)

```bash
cd blog-backend
cp .env.example .env.local  # preencher chaves
bun install
bun run dev
# Servidor sobe em http://127.0.0.1:8000
```

## Como buildar (sidecar standalone)

```bash
bun run build:mac      # binário Mac ARM64
bun run build:win      # binário Windows x64 (rodar em runner Windows via GitHub Actions)
```

## Segurança

- **NUNCA** commitar `.env.local`. Todo segredo fica lá.
- Token OAuth do Magnific em `data/magnific_token.json` (gitignored).
- Token do WordPress vive no Supabase (RLS + auth), nunca no cliente.

## Migração

Ver seção "Migração do Blog (Sprints 21–29)" no `../CLAUDE.md` do app principal para o roadmap completo.
