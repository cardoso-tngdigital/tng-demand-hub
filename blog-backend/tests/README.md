# Testes do blog-backend

Testes rodam com o runner nativo do Bun (`bun test`). Cada teste sobe o servidor
em um processo filho numa porta alta aleatória, faz asserts via `fetch`, e mata
o processo ao final via `SIGTERM` (graceful shutdown já implementado no `main.ts`).

## Rodar

```bash
# Instala dependências (uma vez)
bun install

# Roda toda a suíte
bun test

# Roda só o teste de health
bun test tests/health

# Modo watch (rerroda ao salvar)
bun test --watch
```

## Variáveis de ambiente

O `health.test.ts` injeta credenciais dummy do Supabase caso o ambiente não tenha
`SUPABASE_URL` / `SUPABASE_ANON_KEY`. Isso permite rodar o smoke test sem `.env.local`
válido — o `/api/health` é público e não fala com Supabase.

Testes futuros que dependem de auth real precisam de um projeto Supabase de teste
configurado explicitamente.

## Convenções

- Nome do arquivo: `*.test.ts`, colocado em `tests/` (não co-localizado).
- Descrições em pt-BR: `describe("Sidecar do blog — smoke test", ...)`.
- Sempre limpar recursos em `afterAll` — nada de processo filho ficar rodando
  além do teste.

## Smoke test manual do Magnific (Sprint 23)

O cliente MCP do Magnific não roda em `bun test` porque precisa de credencial
Magnific viva e abre o browser na 1ª execução. Pra validar sessão + descoberta:

```bash
cd blog-backend
bun run tests/manual/magnific-smoke.ts
```

- Na 1ª execução, o browser abre no fluxo OAuth do Magnific. Faça login
  normalmente; ao concluir, a aba mostra "Magnific conectado" e o token fica
  salvo em `data/magnific_token.json` (mesmo formato do app Python — se você
  já tem esse arquivo do app Python, o smoke usa direto sem reabrir o navegador).
- Nas execuções seguintes, nada de browser — só o log dos passos:
  1. Conectando ao MCP…
  2. Saldo (plano + créditos)
  3. Busca `stock_search("marketing digital", 2)` com os IDs+títulos.
- Se algo der errado, o script imprime a mensagem pt-BR ao usuário e a causa
  técnica em `err.cause` pra debug.
