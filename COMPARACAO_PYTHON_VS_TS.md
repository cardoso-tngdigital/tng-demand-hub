# Comparação COMPLETA: Blog Python (original) vs Sidecar TypeScript + React (novo)

Comparação exaustiva bloco a bloco entre `Blog - TNG Digital/**` (referência Python) e a integração no `tng-demand-hub/` (novo TypeScript+React). Executada em 2026-07-03 após o Gemini responder com schema exemplo `{id, name, price, isInStock, ...}` no primeiro teste real de geração.

Legenda:
- ✅ Paridade OK — comportamento idêntico ou equivalente
- ⚠️ Divergência menor — funciona mas com diferença que pode confundir ou pequena mudança de UX
- ❌ Divergência que **quebra ou muda o resultado** (bug real)
- 🐛 Bug identificado e **JÁ CORRIGIDO** nesta sessão

## Mapa de arquivos

| Python (referência) | TypeScript / React (novo) |
|---|---|
| `app/config.py` | `blog-backend/src/env.ts` + `settings.ts` + `prompt.ts` |
| `app/main.py` | `blog-backend/src/main.ts` + `routes/{sites,historico,config,artigos,plugin}.ts` + `middleware/auth.ts` |
| `app/pipeline.py` | `blog-backend/src/pipeline.ts` |
| `app/agendador.py` | `blog-backend/src/scheduler.ts` |
| `app/steps/gemini.py` | `blog-backend/src/steps/gemini.ts` |
| `app/steps/links.py` | `blog-backend/src/steps/links.ts` |
| `app/steps/images.py` | `blog-backend/src/steps/images.ts` |
| `app/steps/publish.py` | `blog-backend/src/steps/publish.ts` |
| `app/magnific_client.py` | `blog-backend/src/magnific/{client,oauth,tokenStorage,singleton}.ts` |
| `app/wp_client.py` | `blog-backend/src/wordpress.ts` |
| `app/supabase_client.py` | `blog-backend/src/supabase.ts` |
| `app/documento.py` | `blog-backend/src/steps/docx.ts` |
| `app/prompt_padrao_default.txt` | `blog-backend/src/prompt_padrao_default.ts` (embutido em TS) |
| `db/blog_schema.sql` + `db/blog_agendamentos.sql` | reusa as mesmas tabelas + NOVA `supabase/migrations/20260702000001_blog_ai_usage.sql` |
| `wp-plugin/tng-blog-connect.php` | `blog-backend/wp-plugin/tng-blog-connect.php` — **byte a byte idêntico** ✅ |
| `web/index.html` + `web/assets/app.js` + `styles.css` | `src/components/blog/BlogPanel.tsx` + `views/{NovoArtigo,Programacao,Sites,Historico,Config}View.tsx` |

---

## Bloco 1 — Prompt padrão (arquivo de instruções ao Gemini)

### 🐛 BUG CRÍTICO — arquivo `.txt` não vai pro bundle Bun compile → prompt vazio → schema exemplo do Gemini

- **Sintoma observado**: `parseEValidar` recebeu `{id, name, price, isInStock, tags, manufacturer, releaseDate, weightKg}` — schema clássico da doc de "structured output" do Google.
- **Causa**: `prompt.ts::getPrompt()` fazia `Bun.file(resolve(import.meta.dir, "prompt_padrao_default.txt"))` como seed. Funciona em dev, mas `bun build --compile` **não bundleia recursos `.txt`**. No binário, `seed.exists()` retornava `false` → `getPrompt()` retornava `""` → `savePrompt("")` gravava arquivo vazio → Gemini recebia `contents=""` → respondia com schema Product da doc.
- **Fix**: criado `blog-backend/src/prompt_padrao_default.ts` com o texto embutido como `export const PROMPT_PADRAO_DEFAULT = \`…\``. `prompt.ts` importa a constante e re-semeia arquivos vazios existentes. Vai pro bundle direto.

Fora do bug, seções, placeholders (`{keyword}`, `{site_url}`, `{links_internos}`) e regras de saída batem 1:1 com o Python.

---

## Bloco 2 — Chamada ao Gemini SDK

**Python** (`gemini.py:84-92`):
```python
cliente = genai.Client(api_key=chave)
cfg = types.GenerateContentConfig(response_mime_type="application/json")
resp = cliente.models.generate_content(model=modelo, contents=prompt, config=cfg)
```

**TS** (`gemini.ts:197-201`):
```ts
const resp = await cliente.models.generateContent({
  model: modelo, contents: prompt, config: { responseMimeType: "application/json" },
});
```

✅ Paridade OK. Mesmo modelo padrão (`gemini-2.5-flash`), mesma reserva (`gemini-2.5-flash-lite`), mesma detecção de erros transitórios (503, 429, RESOURCE_EXHAUSTED), mesmo retry (3× + fallback), mesma tabela de mensagens amigáveis.

---

## Bloco 3 — Parser + validação da resposta

TS espelha 1:1 o Python (`_parse_e_validar`), com melhorias defensivas adicionadas nesta sessão:
- 🐛 (fix nesta sessão) Log dos primeiros 500 chars quando `JSON.parse` retorna não-objeto ou `dados` está vazio
- 🐛 (fix nesta sessão) `_talvezDesembrulhar` cobre `{artigo: {...}}` / `{output: {...}}` / etc. — Python não trata isso mas TS agora sim
- ✅ `_normalizarSlug` idêntico ao `_normalizar_slug` Python (NFD → strip acentos → lower → hifenizado, 80 chars)
- ✅ `_limitarBordaPalavra` idêntico ao `_limitar` Python

---

## Bloco 4 — Descoberta de links internos WordPress

### ⚠️ Divergência — TS pula slug "sobre"

**Python** `_SLUGS_EVITAR` (`links.py:23-26`):
```
politica, privacidade, privacy, termos, terms, cookie, cookies,
lgpd, contato, contact, fale-conosco, carrinho, checkout, minha-conta
```

**TS** `SLUGS_EVITAR` (`links.ts:26-42`) tem o mesmo conjunto **+ `"sobre"`**.

**Impacto**: se um cliente tem página "sobre" ou "sobre-a-empresa" como página-pilar útil, TS descarta como link interno e Python inclui. Recomendo remover `"sobre"` do TS pra bater com o comportamento validado no Sprint 4 do app original.

Fora disso, estratégia (2 páginas + 1 post relevantes, busca por relevância + completa com genéricos, dedup por id): ✅ paridade.

---

## Bloco 5 — Publicação WordPress

**Distribuição de imagens no corpo**: `_inserirImagensNoCorpo` (TS) espelha `_inserir_no_corpo` (Python) — insere `<figure>` antes dos H2 pulando o 1º, sobra vai ao fim, inserção de trás pra frente pra preservar índices. ✅ Paridade OK.

**Agendamento**: Python usa `dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")`; TS usa `data.toISOString().slice(0, 19)`. Mesmo output. ✅ Paridade OK.

**RankMath**: 
- Python `wp_client.gravar_rankmath` monta `{post_id, title, description, focus_keyword}` — o plugin PHP espera exatamente esses nomes.
- TS `gravarRankMath` recebe `{rank_math_title, meta_description, rank_math_focus_keyword}` **mas mapeia pros mesmos nomes do plugin** (`payload["title"] = campos.rank_math_title`, etc — `wordpress.ts:347-351`). ✅ Paridade OK (confirmado). Alarme falso da rodada anterior.

**Upload de mídia + featured**: ambos sobem mídias antes de criar o post, 1ª = destacada, alt/caption via PATCH separado, tolerantes a falha do RankMath. ✅ Paridade OK.

---

## Bloco 6 — Imagens (Magnific MCP)

### ❌ DIVERGÊNCIA IMPORTANTE — estratégia de busca no banco

**Python** (`images.py::_do_banco`):
- **1 chamada** `stock_search` com `query=tema` (a keyword do artigo)
- Baixa até N itens do resultado

**TS** (`images.ts::_obterUmaImagem`):
- **N chamadas** — uma `stock_search` por prompt do `artigo.imagens_prompts`
- Para cada prompt: banco → IA se falhar

**Impacto**:
- **Custo Magnific**: TS gasta ~3× mais em `stock_search` quando N=3.
- **Comportamento**: divergente do "port fiel" declarado no plano.
- **Vantagem TS**: pode ter imagens mais alinhadas a cada seção; **Vantagem Python**: menos chamadas, mais consistente.

Otimização WebP 1200px q=85 (`_LARGURA_MAX=1200`, `_WEBP_QUALIDADE=85`): ✅ paridade.
Ordem banco → IA: ✅ paridade.
Prompt editorial IA neutra ("Fotografia editorial profissional para..."): ✅ paridade textual.

### ⚠️ Retorno em memória vs disco

**Python**: baixa pra `data/imagens/<job>/`, publish lê os arquivos, limpa depois.
**TS**: baixa em memória (`Uint8Array`), grava só pra debug, publish consome o `ArrayBuffer` direto e a pasta é apagada no `finally`.

Não é bug — é uma otimização. ✅ Aceitável.

---

## Bloco 7 — Documento .docx

**Python** (78 linhas): `HTMLParser` da stdlib percorre e monta parágrafos com bold/italic. `<a>` vira apenas texto. Ignora `<figure>`. Simples e direto.

**TS** (281 linhas): parser HTML próprio (regex), suporte a `ExternalHyperlink` do `docx` npm, mais robusto pra `<br>` e listas aninhadas.

⚠️ Divergência de complexidade — TS suporta MAIS coisas que Python (hyperlinks). Não é bug, só código mais rico. Docx sai válido nos dois lados.

---

## Bloco 8 — Pipeline orquestrador

**Ordem das etapas**: links → texto → imagens → publicando → historico. ✅ Idêntica.

**Emissão de progresso**: 
- Python: `EstadoArtigo` (dataclass) em memória, `_registrar()` atualiza no dict `_jobs`, front polling `/api/artigos/{job_id}` → serializa via `to_dict()`.
- TS: callback `onProgresso(p)` que o consumidor decide como serializar. `routes/artigos.ts` mantém `JOBS: Map<string, JobEstado>` e o front faz polling do mesmo jeito.

✅ Paridade funcional.

**Etapa imagens** — divergência já registrada no Bloco 6 (Python passa `keyword`, TS passa `artigo.imagens_prompts`).

**Registro de uso da IA (`blog.ai_usage`)** — só existe no TS (novo Sprint 28). ⚠️ Não é regressão porque não existia antes.

**Tratamento de erro por etapa**: ambos param a cadeia, marcam a etapa que falhou, gravam mensagem em pt-BR. ✅ Paridade.

---

## Bloco 9 — Agendador / Scheduler

**Python** (`agendador.py`, 77 linhas):
- `threading.Thread` em daemon, ciclo a cada 60s
- `_ciclo()` verifica `supabase_client.due_agendamentos()` e reivindica via PATCH condicional (`_reivindicar_agendamento(id, user_id)`)
- **Precisa de operador logado** — usa a sessão do usuário no keyring
- Catch-up: `disparar()` no início do app

**TS** (`scheduler.ts`, 169 linhas):
- `setInterval(tick, 60_000)` + tick imediato no boot
- Usa `service_role` (não sessão de usuário) — RLS bypass
- Se `SUPABASE_SERVICE_ROLE_KEY` faltar, scheduler DESLIGA e loga warning
- Limita a 5 rows por tick (`limit(5)`), Python não tem esse limite

### ⚠️ Divergência arquitetural — quem tem "poder" pra rodar agendamentos

- Python: só roda se um humano estiver logado no app → simples pra evitar duplicidade, mas se ninguém abre o app, nada é publicado.
- TS: roda sempre que o sidecar existe (com service_role no ambiente do processo Tauri).

**Impacto**: no TS, se você fechar o Tauri, o scheduler para. Mesma limitação do Python.

**Risco atual documentado** no CLAUDE.md Sprint 29: se `SUPABASE_SERVICE_ROLE_KEY` não estiver no ambiente do processo Tauri em produção (`.dmg`/`.msi`), o scheduler NÃO SOBE e agendamentos programados nunca rodam. Precisa documentar deploy pra admin exportar a var.

Claim atômico via PATCH condicional em ambos: ✅ paridade.

---

## Bloco 10 — Endpoints REST (main.py vs main.ts + routes/*)

### ⚠️ Autenticação — arquitetura diferente

**Python**:
- Tem `/api/auth/login`, `/api/auth/logout`, `/api/auth/session` (tela de login própria)
- Sessão Supabase salva no keyring do SO via `supabase_client.py`
- Middleware `_erro_supabase` traduz erros 401
- `_migrar_sites_locais()` migra `sites.json` legado pro Supabase no 1º login

**TS**:
- **NÃO TEM `/api/auth/*`** — React usa a sessão do app principal (via `@supabase/supabase-js`), envia `X-Supabase-Token` em cada request
- `middleware/auth.ts` valida com `authClient.auth.getUser(token)` e injeta `user` + `supabase` no contexto Hono
- Sem migração de arquivos locais (sidecar novo, começa do zero)

**Impacto**: correto pra sidecar embarcado, mas o **fluxo de bootstrap** é diferente. Usuário do app principal já está logado → sidecar herda a sessão automaticamente. Isso é o comportamento desejado no Demand Hub, ✅ paridade funcional.

### ⚠️ Endpoints divergentes

**Endpoints Python** que NÃO existem no TS:
- `/api/auth/session`, `/api/auth/login`, `/api/auth/logout` — não precisa (React usa Supabase JS SDK)
- `/`, `/assets/*`, `/favicon.ico` — o React roda separado (Tauri)

**Endpoints TS** novos:
- `/api/me` — dados do user autenticado + status do schema
- `/api/config/ai-usage` — agregado do `blog.ai_usage`

**Endpoints redistribuídos** (Python tinha `POST /api/agendamentos` fazendo tudo; TS separou):
- Python: `POST /api/agendamentos` aceita `espacamento_dias=0` (tudo agora) ou N (programa)
- TS: `POST /api/artigos` (modo agora ou programar) → decide qual tabela usar. `POST /api/agendamentos` NÃO EXISTE (só GET/DELETE)

Ambos os endpoints cobrem os mesmos casos de uso. ✅ Paridade funcional.

### ⚠️ `/api/historico/:id/docx` — busca do post no WP diverge

**Python** (`main.py::baixar_docx`): usa `item["slug"]` diretamente do banco pra buscar `posts?slug=...&status=draft,publish,future,pending,private&context=edit`.

**TS** (`historico.ts:26-77`): extrai o slug do `post_url` (`postUrl.split("/").filter(Boolean).pop()`). Se o `post_url` estiver vazio (ex.: publicação falhou mas o histórico existe), retorna 404.

**Recomendação**: TS deve usar `item.slug` do banco como o Python, e cair pro `post_url.split` só como fallback.

### ⚠️ `/api/historico/:id/publicar` — comportamento correto na maior parte

Ambos: buscam post pelo slug com `status=draft,publish,future`, PATCH pra `status=publish`, atualizam histórico.

**Nuance TS**: só atualiza histórico pra `status: "concluido"`. Python usa `status: "publicado"`. Se o front tem filtro por status "publicado", TS não bate — precisa mapear.

### ⚠️ `/api/plugin/download` — implementação divergente

**Python**: usa `zipfile.ZipFile` da stdlib.
**TS**: implementa manualmente ZIP local file header + central directory + EOCD (`_criarZipSimples`) porque `bun build --compile` tem problemas com `node:zlib`.

Ambos produzem zip válido pro WP aceitar. ✅ Paridade funcional.

---

## Bloco 11 — Config / secrets / preferências

### ❌ DIVERGÊNCIA IMPORTANTE — chave do Gemini em arquivo vs keyring

**Python** (`config.py::get_gemini_key`):
- Keychain do macOS ou Credential Manager do Windows (`keyring`)
- Fallback: env var `GEMINI_API_KEY`

**TS** (`settings.ts::getGeminiApiKey`):
- Arquivo `${DATA_DIR}/settings.json` com permissão 0600 (Unix)
- Fallback: env var `GEMINI_API_KEY`

**Justificativa TS**: comentário do `settings.ts` diz "sidecar precisa ficar 100% self-contained pro Bun compile". `keyring` npm requer prompts nativos que travariam o sidecar background.

**Impacto**: viola o **RNF-08/09 do PRD** (credenciais no cofre do SO). Chave fica em texto plano num arquivo, protegida só por permissão de FS. Se o disco for lido por outro processo do mesmo user, expõe.

**Recomendação futura**: adicionar `keytar` ou equivalente (mesmo que precise prompt inicial) OU documentar que o sidecar aceita essa relação de tradeoff.

### ✅ Paridade OK
- Sites/histórico/agendamentos: todos no Supabase (schema `blog`) — Python migrou pra Supabase no Sprint 9B
- Token Magnific: mesmo formato e caminho (`data/magnific_token.json`)
- Prompt padrão: `${DATA_DIR}/prompt_padrao.txt` em ambos
- `MODELOS_GEMINI` array: mesmos 3 modelos (2.5-flash, 2.5-flash-lite, 2.5-pro)

---

## Bloco 12 — Magnific MCP

**Persistência**: `_FileTokenStorage` (Py) vs `FileTokenStorage` (TS). Mesmo path (`data/magnific_token.json`), **mesmo formato** — cliente TS carrega tokens salvos pelo Python (validado — o comentário do TS diz isso, e o usuário efetivamente conectou com tokens pré-existentes).

**Callback OAuth**: porta 8765, redirect_uri `http://localhost:8765/callback`. Idêntico.

**Timeout do login**: Python 180s, TS 300s (5 min). ⚠️ Divergência menor — TS é mais tolerante.

**Retry + backoff em transitórios**: TS tem `RETRY_DELAYS_MS = [1000, 3000]`; Python descarta erro na 1ª. ⚠️ TS mais defensivo.

**Parser da resposta MCP** (`_parsearConteudo` TS vs `chamar_json` Python): mesma lógica — 1) tentar JSON puro por bloco, 2) combinar + remover `<system_reminder>`, 3) recortar `{...}`. ✅ Paridade.

**API alto nível**: `accountBalance`, `stockSearch`, `stockDownload`, `imagesGenerate`, `creationsWait`. Todos com os mesmos endpoints e defaults.

🐛 (fix nesta sessão) `_conectar()` no TS: race no callback OAuth — subia o server DEPOIS do `client.connect()` que já dispara o browser. Corrigido: `esperarCallback()` retorna handle síncrono com o server já bindado.

🐛 (fix nesta sessão) `GET /config/magnific` reportava falso "conectado" — verificava só `existsSync(tokenPath)`. Corrigido pra checar `storage.getTokens()?.access_token`.

---

## Bloco 13 — Cliente Supabase

**Python** (`supabase_client.py`):
- httpx puro
- Login GoTrue + refresh manual
- Sessão salva no keyring
- Headers `Accept-Profile`/`Content-Profile: blog` pra usar schema separado
- Trata `SupabaseError` como mensagens amigáveis em pt-BR

**TS** (`supabase.ts`):
- `@supabase/supabase-js` (SDK oficial)
- Sem persistência (`persistSession: false`) — cada request cria client novo com token do header
- Config `db: { schema: BLOG_SCHEMA }` faz o mesmo trabalho de `Accept-Profile`
- `sondarSchema()` no health check

✅ Paridade funcional. TS aproveita o SDK oficial (mais robusto que httpx manual).

---

## Bloco 14 — Cliente WordPress

**User-Agent**: idêntico (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...`). ✅
**Auth**: prioriza token do plugin (`X-TNG-Blog-Token`), fallback pra basic auth. ✅
**`testar`/`testarConexao`**: mesma sequência (REST → users/me → tng-blog/v1/status). ✅
**`gravarRankMath`**: campos do payload PHP idênticos (`title/description/focus_keyword`). ✅

TS adiciona retry em 502/503/504 (`RETRY_STATUS`) que Python não tem. ⚠️ TS mais robusto.

---

## Bloco 15 — Frontend (React vs HTML+JS vanilla)

### 5 abas em ambos: Novo artigo, Programação, Sites, Histórico, Configurações ✅ paridade estrutural.

### ⚠️ NovoArtigo — filtro de sites diferente

**Python**: `select` com TODOS os sites conectados (mesmo sem plugin detectado).
**TS** (`NovoArtigoView.tsx:65`): `sites.filter((s) => s.plugin)` — só sites com `plugin=true`.

**Impacto**: se um site foi cadastrado mas nunca testado (o `plugin` fica `false` até o "Testar" atualizar), TS não deixa gerar artigo lá. Python confia no operador. Recomendação: remover o filtro TS OU garantir teste automático no upsert.

### ⚠️ NovoArtigo — dois modos, mesma UI, mas endpoint diferente

- Python: sempre POST `/api/agendamentos` (agora = espacamento=0)
- TS: modo "agora" → POST `/api/artigos` (job em memória, polling), modo "programar" → POST `/api/artigos` que grava agendamentos

Ambos entregam a mesma UX. ✅ Funcional.

### ⚠️ Sites view — TS não tem modal de "editar nome/url"

Python tem modal `#modal-site` pra editar `nome` e `url` de sites. TS `SitesView` não expõe UI de edição (só listagem + testar + remover + "Prompt"). Se o operador quiser renomear um site, hoje não consegue pelo painel TS.

Recomendação: adicionar botão Editar em `SitesView.tsx`.

### ⚠️ Login — comportamento diferente

- Python: `/api/auth/session` no boot → mostra `#login-overlay` se não logado.
- TS: não tem login próprio (usa a sessão do app principal). Se você não está logado no Demand Hub, o Blog nem abre.

Correto pra sidecar embarcado. ✅ Aceitável.

### ✅ Histórico e Programação: paridade

Filtro por site, status (Publicado/Rascunho/Falhou), botões "Publicar" (rascunhos), "Baixar .docx", "Abrir post". Auto-refresh 5s na Programação.

🐛 (fix nesta sessão) `HistoricoView` estava chamando `blogFetch` diretamente pro download `.docx` → sem `X-Supabase-Token` → 401. Corrigido com `blogFetchBlob`.

### ⚠️ Configurações — divergência de UX (Sprint 30)

- Python: dropdown de modelo Gemini + input de "Modelo de imagem" do Magnific.
- TS: modelo Gemini fixado em `gemini-2.5-flash` + info de fallback; Magnific sem seletor de modelo, com fluxo em 2 passos explicado.

Foi decisão explícita do usuário nesta sessão pra simplificar. ✅ Aceitável.

---

## Bloco 16 — Banco de dados (Supabase, schema `blog`)

**Python** (`db/blog_schema.sql` + `db/blog_agendamentos.sql`):
- `blog.sites`, `blog.historico`, `blog.agendamentos` — todas com RLS pra `authenticated`

**TS**: reusa as mesmas tabelas (já aplicadas do Python) + adiciona `blog.ai_usage` (Sprint 28, novo, sem equivalente Python).

✅ Paridade + adição.

---

## Bloco 17 — Plugin WordPress

Diff `Blog - TNG Digital/wp-plugin/tng-blog-connect.php` vs `tng-demand-hub/blog-backend/wp-plugin/tng-blog-connect.php`: **byte a byte idêntico**. ✅ Paridade total.

---

# Sumário executivo — o que realmente importa

## Bugs identificados e corrigidos nesta sessão (7 total)

1. 🐛 **Bloco 1**: prompt vazio no bundle Bun compile → schema exemplo do Gemini (CAUSA RAIZ do erro `id, name, price, ...`).
2. 🐛 **Bloco 3**: parser sem log do texto bruto quando falha (diagnóstico impossível).
3. 🐛 **Bloco 3**: sem cobertura de wrappers `{artigo: {...}}` na resposta do Gemini.
4. 🐛 **Bloco 12**: race no callback OAuth do Magnific → `ERR_CONNECTION_REFUSED`.
5. 🐛 **Bloco 12**: falso "conectado" no Magnific pós OAuth abortado.
6. 🐛 **Bloco 15**: `window.confirm` bloqueado pelo Tauri (capability faltando).
7. 🐛 **Sidecar sistema**: zombie no `state.child` + health-check TCP para respawnar (Sprint 30 do CLAUDE.md).

## Divergências restantes (não corrigidas — devem ser revisadas em uma Sprint futura)

### ❌ CRÍTICAS (podem afetar comportamento observável)

1. **Bloco 4 (links)**: TS pula slug com "sobre" que Python não pula.
   - **Ação**: remover `"sobre"` de `SLUGS_EVITAR` em `blog-backend/src/steps/links.ts:42`.

2. **Bloco 6/8 (imagens)**: TS faz N chamadas ao Magnific (uma por prompt do Gemini), Python faz 1 chamada com a keyword.
   - **Impacto**: ~3× mais consumo Magnific + comportamento divergente.
   - **Ação**: substituir loop em `_obterUmaImagem` por 1 `stock_search(keyword, N*3)` seguido de N downloads, com IA só pro que faltar (igual Python).

3. **Bloco 10 (`/api/historico/:id/docx`)**: TS busca slug via `post_url.split`, Python usa `item.slug` direto do banco.
   - **Impacto**: se `post_url` estiver vazio (publicação falhou), TS retorna 404.
   - **Ação**: usar `item.slug` como fonte primária, `post_url.split` só como fallback.

4. **Bloco 11 (chave Gemini)**: TS grava em `settings.json` (arquivo), Python em keyring.
   - **Impacto**: viola RNF-08/09; chave em texto plano protegida só por permissão de FS.
   - **Ação**: usar `keytar` npm ou similar, mesmo que exija prompt inicial. OU documentar como decisão de tradeoff.

### ⚠️ MENORES (UX, código, robustez — não bloqueiam funcionamento)

5. **Bloco 6 (retorno)**: TS mantém buffers em memória; Python usa arquivos em disco. Otimização aceitável.

6. **Bloco 7 (docx)**: TS mais rico (hyperlinks); Python simples. Não é regressão.

7. **Bloco 10 (endpoints)**: TS separou "agora" e "programar" em endpoints diferentes; Python unifica. Ambos funcionam.

8. **Bloco 12 (Magnific)**: TS mais defensivo (retry + timeout maior). Não é regressão.

9. **Bloco 14 (WP)**: TS tem retry em 502/503/504 que Python não tem. TS mais robusto.

10. **Bloco 15 (Sites)**: TS não tem UI de editar `nome`/`url` de site. Python tem modal.
    - **Ação**: adicionar botão Editar em `SitesView.tsx`.

11. **Bloco 15 (NovoArtigo)**: TS filtra sites por `plugin=true`. Python mostra todos.
    - **Ação**: revisar critério (talvez deixar sem filtro + aviso pra sites sem plugin).

12. **Bloco 10 (`historico/:id/publicar`)**: TS grava status `"concluido"`, Python `"publicado"`. Verificar se front espera nomenclatura.

## Paridade OK — módulos que não precisam mexer

- Bloco 2 (chamada Gemini SDK)
- Bloco 3 (parser + validação — já com bônus defensivos)
- Bloco 5 (publicação WP — mesmos endpoints, mesmos payloads RankMath)
- Bloco 9 (scheduler — mesmo claim atômico)
- Bloco 13 (cliente Supabase — TS usa SDK oficial)
- Bloco 14 (cliente WP — mesmo User-Agent, mesma detecção plugin/RankMath)
- Bloco 16 (schema DB — mesmas tabelas + adição `ai_usage`)
- Bloco 17 (plugin WP — byte a byte idêntico)

---

## Recomendação de prioridade

Se quiser garantir "fidelidade absoluta" ao Python (o pedido original), a ordem de ataque é:

1. **Bloco 6** — voltar pra 1 `stock_search` com a keyword (impacto de custo real no Magnific).
2. **Bloco 4** — remover `"sobre"` do `SLUGS_EVITAR`.
3. **Bloco 10** — `docx` usar `item.slug` primeiro.
4. **Bloco 11** — chave Gemini no keyring (segurança do RNF-08/09).
5. **Bloco 15** — botão editar site + revisar filtro `plugin=true`.

Tudo o mais é code style / adição / arquitetura equivalente.
