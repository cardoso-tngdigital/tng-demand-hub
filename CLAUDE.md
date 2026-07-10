# TNG Demand Hub — Guia para Claude Code

Este arquivo é o **contexto persistente** que o Claude Code consulta a cada interação. Atualize-o sempre que tomar decisões arquiteturais, mudar convenções ou adicionar dependências relevantes.

## Convenção dos registros de sprint

Cada mudança implementada vai como bullet no final da sprint em andamento, no formato:

```
- ✅ ✨ Título — YYYY-MM-DD. Descrição.
- ✅ 🐛 Título — YYYY-MM-DD. Descrição.
```

- **✨ = feature** — novo comportamento, nova tela, novo campo, refatoração.
- **🐛 = bug** — correção de regressão, comportamento incorreto, hotfix.

Use `Cmd+F` (`Ctrl+F`) com 🐛 ou ✨ pra navegar.

---

## App principal — devtools + anexos — 2026-07-10

Primeira leva de mudanças no **app principal** (fora do módulo Blog) desde as
sprints do Blog. Pedido do usuário.

- ✅ ✨ **Devtools/console habilitado em RELEASE — 2026-07-10.**
  Sem isso, o inspetor só existia em `tauri dev` — impossível depurar bug que
  só aparece no app empacotado (ex.: anexos no Windows). Mudanças:
  `src-tauri/Cargo.toml` ganhou a feature `devtools` no `tauri`; `lib.rs`
  ganhou o comando `open_devtools` (`window.open_devtools()`, gated por
  `cfg(any(debug_assertions, feature="devtools"))`); `App.tsx` registra um
  listener de teclado (F12 / Ctrl+Shift+I / Cmd+Alt+I) que invoca o comando —
  vale pra QUALQUER janela (main/capture/preview), porque App é a raiz das três.
- ✅ 🐛 **Anexos não abrem no Windows — instrumentado (diagnóstico) — 2026-07-10.**
  Sintoma: clica no anexo e nada acontece, sem erro. O fluxo abre a janela
  `preview` on-demand (`lib/preview.ts` → `ensure_preview_window_cmd` + emit
  `preview:open`). Causa exata ainda desconhecida (só reproduz no Windows
  empacotado). Ações: (1) devtools habilitado (acima) pra capturar o erro
  real; (2) `openAttachmentPreview` ganhou logs por etapa (janela achada?
  ready? emit? show?) e agora RETORNA erro visível se a janela não abrir, em
  vez de fingir sucesso (`ok:true`). **Próximo passo depende do console do
  usuário no Windows** — o fix real virá com o erro em mãos.
- ✅ ✨ **Excluir anexo (lixeira no canto) — 2026-07-10.**
  `deleteAttachment()` em `lib/attachments.ts` (delete do registro + remove do
  Storage best-effort; se a RLS bloquear devolve msg clara "só quem enviou ou
  admin"). UI: ícone de lixeira no canto superior direito de cada anexo, com
  confirmação inline em 2 cliques (vira ícone de alerta, desarma em 4s).
- ✅ ✨ **Reordenar anexos com drag-and-drop (persistente) — 2026-07-10.**
  Migration `20260710000001_attachments_reorder.sql`: coluna `sort_order`,
  índice `(demand_id, sort_order nulls last, created_at)`, policy de UPDATE
  pra membros ativos (antes não havia — reorder era negado por RLS), e RPC
  atômico `reorder_attachments(demand_id, ordered_ids[])` (`security invoker`,
  respeita RLS). `listAttachments` ordena por `sort_order` (nulls last) +
  `created_at`, com **fallback defensivo**: se a coluna não existir ainda
  (migration não aplicada), refaz só por `created_at` — app não quebra.
  `reorderAttachments()` chama o RPC. UI: cada anexo é `draggable` (com >1
  item), grip visual à esquerda, drop reordena otimista + persiste; se
  persistir falhar, recarrega do banco. ⚠️ **Precisa aplicar a migration**
  (`supabase db push` ou dashboard) — sem ela o reorder não persiste (o resto
  funciona via fallback).
- ✅ 🐛 **Devtools não abria no Windows — corrigido — 2026-07-10.**
  A v0.2.0 usava um listener JS de F12 com `e.preventDefault()`. No Windows,
  o WebView2 tem F12 NATIVO (que a feature `devtools` habilita), e o
  `preventDefault` BLOQUEAVA esse nativo → nada abria. Fixes: (1) removido o
  `preventDefault` (F12 nativo do WebView2 volta a funcionar; no macOS o
  `invoke("open_devtools")` cobre, que não tem F12 nativo); (2) **item de
  tray "Abrir Console (Devtools)"** — caminho 100% garantido, clicar num
  menu não depende de o WebView2 deixar o F12 passar.
- ✅ 🐛 **Anexos não abriam no Windows — reescrito o fluxo de preview — 2026-07-10.**
  Causa: o fluxo criava a janela `preview` via JS, esperava um handshake
  `preview:ready` e mandava o payload por `emitTo("preview:open")`. No
  WebView2 (Windows) o React da janela monta mais devagar → o evento chegava
  ANTES do listener e sumia; e às vezes `WebviewWindow.getByLabel` voltava
  null → a janela nunca dava `show()` → "nada acontece". Reescrito pra ser
  **Rust-driven + pull**: novo comando `open_preview_window(payload_json)`
  guarda o payload num `PreviewPayloadStore` (state) e cria+mostra+foca+
  centraliza a janela toda no Rust (mais confiável que orquestrar via JS); a
  `PreviewScreen` BUSCA o payload via `get_preview_payload` no mount (e no
  evento `preview:refresh` pra reaberturas) — sem corrida de evento.
  `lib/preview.ts` virou uma chamada só (`invoke open_preview_window`).
  Também: CSP `frame-src` ganhou `https://*.supabase.co` pra o PDF renderizar
  no `<iframe>` (antes só `'self' blob:` — bloqueava). Refatorou o fluxo
  compartilhado Mac+Windows: **testar nos dois** após atualizar.
- ✅ 🐛 **Navegação de anexos pulando de 2 em 2 (setas) — 2026-07-10.**
  Abrir 1/10 e apertar → ia pra 3/10, 5/10… Causa: `goPrev`/`goNext`
  enfiavam `setCurrentIndex` DENTRO do updater de `setBundle`, que é impuro.
  O React StrictMode (dev) invoca updaters 2× pra detectar impureza →
  o `setCurrentIndex` era enfileirado duas vezes → índice andava 2. Sintoma
  só do dev (no release empacotado andava 1), mas é bug real. Fix: ler o
  tamanho da lista de um `bundleRef` e chamar `setCurrentIndex` UMA vez
  (updater puro; o double-invoke passa a ser inofensivo). `PreviewScreen.tsx`.
- ✅ ✨ **Release v0.2.1 publicado — 2026-07-10.** Tag `v0.2.1` → build Mac
  (aarch64+x64) + Windows via GitHub Actions, com todos os fixes acima
  (devtools no Windows, preview reescrito, setas 1-a-1, PDF via CSP).
  Versão bumpada em package.json + tauri.conf.json + Cargo.toml. Validado em
  dev no Mac antes de subir (preview abre, setas andam 1-a-1); Windows a
  validar no app instalado.

---

## Visão geral

**TNG Demand Hub** é um aplicativo desktop interno da TNG Digital para gerenciamento de demandas com captura rápida via atalho global e processamento por IA (Gemini 2.0 Flash). O fluxo é: hotkey → janela flutuante → captura multimodal → IA extrai campos → dashboard sincronizado em tempo real.

Documentos de referência (no diretório pai `../`):

- `prd_projeto-TNG-Digital.md` — PRD completo (visão, requisitos, arquitetura, sprints).
- `escopo_projeto-TNG-Digital.md` — escopo técnico resumido.

## Stack

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Desktop shell | Tauri | 2.x |
| Linguagem core | Rust | stable |
| Frontend | React | 19.1 |
| Linguagem UI | TypeScript | 5.8 |
| Build | Vite | 7 |
| Estilo | Tailwind CSS | 4.3 (via `@tailwindcss/vite`) |
| Estado UI | useState/useContext (Zustand entra quando justificar) |
| Backend | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| Cliente Supabase | `@supabase/supabase-js` 2.x |
| IA | Google Gemini 2.5 Flash (via Edge Function) |
| Editor rich text | Tiptap 3 (`@tiptap/react` + StarterKit + Link + Placeholder) |
| Sanitização HTML | isomorphic-dompurify |
| Conversão markdown → HTML | `marked` (só para conteúdo legacy) |
| Testes | Vitest 4 + jsdom + @testing-library/react + jest-dom |
| Ícones | Font Awesome 6 (via `@fortawesome/fontawesome-free`, CSS+webfont importado no `main.tsx`) |

## Identidade visual TNG

Paleta oficial (já configurada como tokens em `src/index.css`):

| Token | Hex | Uso |
|-------|-----|-----|
| `tng-marine-700` | `#082345` | Primary, fundos no tema escuro |
| `tng-orange-400` | `#F6A532` | Destaque, CTAs, foco |
| `tng-graphite-900` | `#393536` | Neutro, textos secundários |

**Tema escuro é o default** (`<html class="dark">` em `index.html`). Logos em `src/assets/brand/`:

- `logo-dark.png` — versão branca, para fundos escuros (tema dark).
- `logo-light.png` — versão colorida, para fundos claros (tema light).

Fonte: **Inter** (carregada via Google Fonts no `index.html`).

## Estrutura de pastas

```
tng-demand-hub/
├── src-tauri/          # Rust core (atalhos globais, tray, janelas nativas)
├── src/
│   ├── assets/brand/   # Logos TNG
│   ├── hooks/          # Hooks React (ex.: useAuth)
│   ├── lib/
│   │   └── supabase/   # Cliente Supabase
│   ├── screens/        # Telas principais (Login, Welcome, futuramente Dashboard, Capture)
│   ├── components/     # Componentes reutilizáveis (futuro)
│   ├── App.tsx         # Router principal
│   ├── main.tsx        # Entry point React
│   ├── index.css       # Tailwind + design tokens TNG
│   └── vite-env.d.ts   # Tipos das variáveis de ambiente
├── supabase/
│   ├── config.toml
│   └── migrations/     # SQL versionado do schema
├── .env.local          # Segredos reais (NUNCA commitar)
├── .env.example        # Template documentado (commitar)
└── CLAUDE.md           # Este arquivo
```

## Convenções

### Arquivos e nomes

- Componentes React: `PascalCase.tsx` em `src/components/` ou `src/screens/`.
- Hooks: `useCamelCase.tsx` em `src/hooks/`.
- Utilitários: `camelCase.ts` em `src/lib/`.
- Tipos compartilhados: `src/types/` (criar quando necessário).

### TypeScript

- `strict: true` (já configurado). Sem `any` em código de produção.
- Tipos de variáveis de ambiente em `src/vite-env.d.ts`.
- Erros de Supabase devolvidos como `{ error: string | null }` para a UI tratar.

### Estilo

- Apenas classes Tailwind. Sem CSS custom além dos tokens em `index.css`.
- Cores sempre via tokens TNG (`tng-marine-*`, `tng-orange-*`, `tng-graphite-*`). Nunca hexadecimais inline.
- Espaçamentos: escala padrão do Tailwind (`gap-2`, `p-4`, etc.).
- Arredondamento: `rounded-lg` padrão, `rounded-xl` ou `rounded-2xl` em cards/modais.

### Mensagens ao usuário

- Sempre em **português brasileiro**.
- Erros do Supabase devem ser traduzidos antes de mostrar (ver `traduzirErro` em `hooks/useAuth.tsx`).
- Zero jargão técnico na interface — linguagem direta de equipe.

### Tauri

- Atalhos globais via `tauri-plugin-global-shortcut` (Sprint 2).
- Janelas extras (captura flutuante) declaradas em `src-tauri/tauri.conf.json`.
- Lógica de tray icon em `src-tauri/src/tray.rs` (criar no Sprint 2).
- Use `data-tauri-drag-region` em headers para permitir arrastar janelas sem barra de título.

### Supabase

- Cliente único exportado de `src/lib/supabase/client.ts`. Não criar novas instâncias.
- Todas as tabelas têm **RLS habilitada**. Toda nova tabela precisa de policies explícitas.
- Migrações em `supabase/migrations/` com timestamp no nome (`YYYYMMDDHHMMSS_descricao.sql`).
- Aplicar migrações via SQL Editor do painel web (Sprint 1) ou `supabase db push` quando o link estiver feito.

### Segurança

- **`SUPABASE_SERVICE_ROLE_KEY`** e **`GEMINI_API_KEY`** ficam **apenas no servidor** (Edge Functions). Nunca usar no client.
- Apenas variáveis com prefixo `VITE_` ficam disponíveis no client.
- Chamadas ao Gemini sempre via Edge Function (Sprint 4).

## Comandos úteis

```bash
# Desenvolvimento
npm run dev                # Vite dev server (browser)
npm run tauri dev          # App desktop Tauri em modo dev

# Build
npm run build              # Build da UI (tsc + vite)
npm run tauri build        # Build do app desktop (DMG / MSI)

# TypeScript
npx tsc --noEmit           # Checagem de tipos sem gerar arquivos

# Testes
npm test                   # Vitest em watch mode (deixar aberto enquanto edita)
npm run test:run           # Roda toda a suíte uma vez (usado no CI)

# Supabase (CLI local)
supabase migration new <nome>      # Cria nova migração vazia
supabase db push                    # Aplica migrações no projeto remoto (após link)
supabase link --project-ref $SUPABASE_PROJECT_REF   # Linka ao projeto remoto (ref no .env.local)
```

## Testes

### Stack

- **Vitest 4** + jsdom + Testing Library (React + jest-dom)
- Co-localização: `foo.ts` → `foo.test.ts` no mesmo diretório. Sem pasta
  `__tests__/`.
- Setup global em `src/test/setup.ts`: registra matchers, limpa o DOM
  entre testes e injeta mocks padrão pro cliente Supabase e plugins do
  Tauri (cada teste sobrescreve com `vi.mocked(...)` quando precisa de
  comportamento específico).
- Factories de domínio em `src/test/factories.ts`
  (`makeDemand`, `makeClient`, `makeProfile`, `makeComment`).

### Mocks de componentes pesados

- **`RichTextEditor` (Tiptap)**: testes do `DemandDetailDrawer` e
  `CommentsThread` o substituem por um `<textarea>` simples via
  `vi.mock("./RichTextEditor", ...)`. O contrato testado é
  `value/onChange(html)/onBlur` — não a renderização do editor.
- **`CommentsThread`** dentro do drawer também é stubado pra isolar a
  superfície sob teste.

### CI

`.github/workflows/test.yml` roda em todo push em `main` e PRs:

1. `actions/setup-node@v4` (node 20, cache npm)
2. `npm ci`
3. `npx tsc --noEmit`
4. `npm run test:run`

Se vermelho, o PR/push aparece com ❌ no GitHub. Não bloqueia merge por
padrão — para ativar, configurar branch protection em main → "Require
status checks to pass before merging" → marcar `Type-check + Vitest`.

### Convenção de prompt no Vitest

- Teste de regressão: `describe(funçãoTestada, ...)` com `it("...")` em
  pt-BR descrevendo expectativa. Ex.: `it("expira após o TTL", ...)`.
- Use `vi.fn()` pra contratos de callback (`onClose`, `onSelect`); cheque
  com `expect(spy).toHaveBeenCalledWith(...)`.
- Para datas: `vi.useFakeTimers() + vi.setSystemTime(...)`. Sempre
  restaurar com `vi.useRealTimers()` em `beforeEach` ou após.

## Configuração do Supabase remoto

Valores reais (project ref, URL, anon key) estão em `.env.local`
(gitignored). Região: `sa-east-1` (São Paulo). Para acessar o painel,
abra o link a partir do project ref do `.env.local`.

## GitHub

- **Repositório:** público.
- **Secrets configurados** (em Settings → Secrets and variables → Actions):
  `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Secrets de Edge Functions** (em Supabase Dashboard → Edge Functions
  → Secrets): `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`.

## Estado atual

### Sprint 1 — concluído

- [x] Scaffold Tauri 2 + React 19 + TypeScript + Vite 7
- [x] Tailwind CSS 4 com tokens TNG e tema escuro default
- [x] Cliente Supabase
- [x] Tabela `profiles` com RLS e triggers
- [x] Tela de login funcional
- [x] Tela placeholder pós-login (Welcome)

### Sprint 2 — concluído

- [x] Plugin `tauri-plugin-global-shortcut` integrado
- [x] Janela `capture` no `tauri.conf.json` (alwaysOnTop, sem decorations)
- [x] Atalho `CmdOrCtrl+Shift+D` registrado no setup do Rust
- [x] Tray icon com menu (Abrir / Nova captura / Sair) via `TrayIconBuilder`
- [x] Comando Rust `hide_capture_window` invocável do frontend
- [x] `CaptureScreen` com auto-focus, atalhos `Enter` (envia) e `Esc` (fecha)
- [x] Roteamento por window label no `App.tsx` (`main` vs `capture`)
- [x] Plugin SWC no lugar do plugin Babel (sem dependência de caniuse-lite)
- [x] Vite forçado em IPv4 para evitar timeout no macOS

### Sprint 3 — concluído

- [x] Tabelas `clients`, `demands`, `activity_log` com RLS e índices
- [x] Realtime habilitado em `demands` e `activity_log`
- [x] Seed inicial com 2 clientes placeholder
- [x] Tipos TypeScript em `src/types/database.ts`
- [x] Helpers `createDemand`, `listDemands`, `subscribeToDemands` em `src/lib/demands.ts`
- [x] `CaptureScreen` salva no Supabase com `captured_via='hotkey'`
- [x] `DashboardScreen` (substitui Welcome) com lista, stats e indicador realtime ao vivo
- [x] Roteamento atualizado para usar Dashboard

### Sprint 4 — concluído

- [x] Tabela `ai_usage_log` com RLS (migration aplicada no Supabase)
- [x] Edge Function `supabase/functions/extract-demand/index.ts` deployada
  (chama Gemini 2.5 Flash com `thinkingBudget: 0`, valida JSON, registra
  uso, fallback gracioso)
- [x] Secret `GEMINI_API_KEY` configurado no projeto Supabase
- [x] Helper `extractDemand` em `src/lib/ai.ts`
- [x] `CaptureScreen` refatorado em duas views (Input + Confirm) com fluxo:
      texto → IA → confirmação editável → salva
- [x] Tela de confirmação destaca campos com confiança < 70% em laranja
- [x] Fallback "Salvar mesmo assim" se IA falhar
- [x] Validação manual de ponta a ponta concluída em 2026-06-05 (extração
      correta de prioridade, prazo relativo e tags; demanda sincronizou em
      tempo real no Dashboard)

**Notas de bastidor (úteis para Sprint 5 e debugging futuro):**

- O modelo `gemini-2.0-flash` saiu do free tier para projetos novos do
  AI Studio — usar `gemini-2.5-flash` ou superior.
- `gemini-2.5-flash` tem *thinking mode* ativo por padrão, que consome o
  orçamento de `maxOutputTokens` antes de gerar a resposta visível. Sempre
  passar `thinkingConfig: { thinkingBudget: 0 }` em chamadas de extração
  estruturada — sem isso, a resposta vem truncada no meio do JSON.
- Chaves do AI Studio em algumas contas podem aparecer no formato
  `AQ.Ab8RN6...` em vez do clássico `AIzaSy...`. Ambas autenticam no
  endpoint `generativelanguage.googleapis.com`.
- Para debug rápido de erros mascarados pelo `supabase.functions.invoke`
  (que devolve só "non-2xx status code"), consultar a tabela `ai_usage_log`
  — a Edge Function grava o `error_message` completo lá.

### Sprint 5 — concluído (com follow-ups conhecidos)

Anexos multimodais ponta a ponta validados em 2026-06-05: paste/upload no
Storage privado funcionando, IA recebendo os arquivos e enriquecendo a
descrição com blocos por tipo (transcrição de áudio, descrição de imagem,
etc.).

- [x] Tabela `attachments` com RLS + bucket privado `attachments` no Storage
      com policies escopadas (uploader insere; uploader/admin deletam;
      qualquer membro lê via signed URL)
- [x] `src/lib/attachments.ts`: validação, preview, upload, signed URL,
      serialização inline (base64)
- [x] `CaptureScreen` aceita anexos via paste (clipboard) e file picker;
      preview compacto com remover; validação client-side de MIME + 50MB
- [x] Convenção de path: `{demand_id}/{attachment_id}.{ext}` (UUID no
      Storage; nome original preservado em `attachments.file_name`)
- [x] Upload paralelo após `createDemand`, com cleanup de objeto órfão
      caso o insert em `attachments` falhe
- [x] Edge Function multimodal: aceita `attachments` no body, monta
      `inlineData` por anexo (limite 12MB de base64 cumulativo), prompt
      expandido com RF-06b instruindo blocos markdown por tipo MIME
- [x] `extractDemand(text, attachments)` no helper de IA

**Follow-ups conhecidos (deixados para depois):**

- **Drag-drop não chega no webview** — o Tauri 2 intercepta `drop` no
  shell. Setar `dragDropEnabled: false` na janela `capture` em
  `src-tauri/tauri.conf.json` resolve. Paste e file picker já cobrem o
  uso prático.
- **Consistência do bloco RF-06b** — em testes reais, o Gemini às vezes
  ignora a instrução de gerar o bloco markdown separado e funde a
  transcrição na descrição principal. Refinar o prompt (ou migrar pra
  `responseSchema` formal) quando houver dataset de capturas.
- **Compressão de imagem/vídeo no client** (PRD seção 11.2). Imagem
  funciona sem compressão até 50MB; vídeo só limitado por tamanho.
- **Extração local de DOCX/XLSX/TXT/CSV** (PRD seção 11.2). Esses tipos
  já podem ser anexados, mas a IA não enxerga o conteúdo deles ainda
  (Gemini não aceita esses MIMEs como inlineData). Implementar com
  `mammoth` (DOCX) e `sheetjs` (XLSX) e mandar como texto extraído.
- **Vídeos > ~8MB** estouram o limite de inline. Migrar pra Files API do
  Gemini quando necessário.
- **PDF anexado falha no `fileToBase64`** com "The I/O read operation
  failed" — o `FileReader.readAsDataURL` parece estourar com PDFs
  específicos. Investigar com chunked reader ou migrar PDFs para a
  Files API do Gemini.

## Sprint 6 — concluído (Dashboard Completo)

Concluído em 2026-06-05. Cobre RFs 12–16. Dashboard agora é utilizável
no dia a dia: vê detalhes, edita, filtra, alterna pra Kanban e busca.

- [x] **Fase 1 — Painel de detalhes**: drawer 520px com todos os campos,
      lista de anexos com viewer embedded (imagem/áudio/vídeo via tags
      HTML5, PDF via `<iframe>`, demais via `<a download>` interno —
      nunca abre browser externo)
- [x] **Fase 2 — Filtros**: barra com status, prioridade, cliente e
      responsável; "Sem cliente"/"Sem responsável" como opções
      especiais; stats refletem o conjunto filtrado
- [x] **Fase 3 — Edição inline**: todos os campos editáveis no drawer
      (status/cliente/responsável/prioridade salvam ao mudar; descrição/
      prazo/tags salvam no blur); hook `useDemandEditor` preserva
      digitação local quando updates de realtime chegam
- [x] **Fase 4 — Kanban com drag-and-drop**: toggle Lista/Kanban no
      header, 4 colunas por status, cards arrastáveis entre elas via
      HTML5 DnD nativo. Para liberar drag dentro do webview, setamos
      `dragDropEnabled: false` em ambas as janelas do tauri.conf.json
      (também resolveu o drop de arquivos do OS na captura, follow-up
      antigo do Sprint 5). O `data-tauri-drag-region` foi confinado ao
      header — antes engolia todo arrasto como "mover janela".
- [x] **Fase 5 — Busca global**: `Cmd/Ctrl+K` abre command palette
      estilo Linear; busca client-side em título/descrição/tags com
      pontuação relevância; navegação por setas, Enter abre drawer

### Pendência específica desta sprint

- **Renderização markdown da descrição** no drawer — hoje a descrição
  com blocos RF-06b aparece como texto bruto (preservando quebras).
  Plugar `react-markdown` ou equivalente quando vier polimento.

## Sprint 7 — em andamento (Tempo Real e Notificações)

**Já entregue em sprints anteriores:**

- Realtime em `demands` e `activity_log` (Sprint 3) + indicador
  AO VIVO/offline no header.

### Fase 1 — Comentários (concluída)

- [x] Migration `comments` com RLS (membro ativo lê; autor escreve em
      seu nome; autor edita/apaga, admin pode remover) e Realtime
      habilitado
- [x] `src/lib/comments.ts`: listComments, createComment, deleteComment,
      subscribeToComments (filtrado por demand_id)
- [x] Componente `CommentsThread` no drawer com lista + form de novo
      comentário (`Cmd+Enter` envia); botão "remover" só nos próprios
- [x] Insert otimista deduplicado pelo realtime

**Follow-ups da fase de comentários:**

- Ordenar comentários por mais recentes em cima (hoje vão ascendente,
  então o mais novo cai pro fim). Trocar para `order desc` em
  `listComments` e ajustar inserção otimista para `prepend`.
- Indicador visual (📝 ou contador) nos cards de demanda que possuem
  comentários — exige contar comments por demand_id, idealmente via
  view ou coluna `comments_count` denormalizada.

### Fase 2 — Notificações nativas (concluída)

- [x] `tauri-plugin-notification` adicionado (Cargo + npm) + permissão
      `notification:default` em capabilities/default.json + init no
      Rust
- [x] Migration `replica_identity_full` em demands e comments — sem
      isso o `payload.old` do realtime vinha sem os campos, impedindo
      detectar reatribuição
- [x] `subscribeToDemands` agora entrega `{ new, old }` em todos os
      eventos
- [x] `src/lib/notifications.ts`: `ensureNotificationPermission()` com
      cache em memória e `notify(title, body)`
- [x] `subscribeToAllCommentInserts` (sem filtro de demand_id) para
      cruzar com lista local e decidir se notifica
- [x] Dashboard dispara notificação em:
      - reatribuição: `new.assignee_id === me && old.assignee_id !== me`
      - comentário INSERT em demanda onde sou assignee/created_by e o
        author não sou eu
- [x] Validado em build de produção em 2026-06-05. Em dev (`tauri dev`)
      o binary não vai pra um `.app` registrado no LaunchServices, então
      `sendNotification` é despachado mas o macOS ignora — comportamento
      esperado, só visível em `tauri build`.

**Follow-ups da fase de notificações:**

- Clicar na notificação deve focar a janela main e abrir o drawer da
  demanda correspondente. Tauri 2 expõe action listeners no plugin
  notification; precisa anexar `demand_id` como payload na chamada
  e tratar o evento no `lib.rs` (ou via `onAction` no JS) chamando
  setSelectedDemandId.

### Fase 3 — Badge no tray icon (concluída)

- [x] Comando Rust `set_tray_badge(count)` que faz `tray.set_title()`;
      vazio quando 0 para limpar a menubar
- [x] Helper `src/lib/tray.ts` com `setTrayBadge(n)` via invoke
- [x] Dashboard calcula `pendingForMeCount` (assignee = me e status
      em todo/doing) e propaga ao tray em todo update; reativo via
      realtime de demands
- [x] Cleanup do useEffect zera o badge ao desmontar

**Follow-up da fase 3:**

- Limpar badge no `signOut` explicitamente (hoje o cleanup do
  useEffect só dispara quando o Dashboard é desmontado; em alguns
  caminhos de logout o componente persiste por um instante). Pode
  ficar resolvido junto com a melhoria do fluxo de auth.

## Sprint 7 — concluído

Concluído em 2026-06-05. Todas as três fases entregues. Notificações
nativas validadas em build de produção; em dev o macOS ignora
silenciosamente (limitação do LaunchServices). Badge funciona tanto
em dev quanto em release.

## Sprint 8 — em andamento (Admin)

### Fase 1 — CRUD de clientes + bind IA→cadastro (concluída)

- [x] `src/lib/clients.ts` com listAllClients, createClient, updateClient,
      deleteClient
- [x] `ClientsAdmin` modal fullscreen aberto via botão "Clientes" no
      header: form de novo cliente, edição inline por linha, toggle
      ativar/desativar, excluir (RLS rejeita se não-admin)
- [x] Dashboard recarrega `clients` ativos quando o admin fecha,
      atualizando filtros e selects da captura
- [x] **Fix**: CaptureScreen agora carrega `clients` e `profiles`
      ativos, faz matching nome→id (exact por name/alias, depois
      partial) e passa `client_id` e `assignee_id` ao `createDemand`.
      Antes a IA detectava certo mas saveExtracted não passava esses
      campos, então iam null para o banco.
- [x] `ConfirmView` da captura: campos Cliente e Responsável agora
      são `<select>` com cadastros + opção "Sem". Dica em laranja
      avisa quando a IA sugeriu nome que não existe no cadastro.

### Fase 2 — Gestão de membros (concluída)

- [x] `src/lib/profiles.ts` com `listAllProfiles` e `updateProfile`
      (usa `maybeSingle` para reportar "sem permissão" quando a RLS
      rejeita o update em vez de explodir com "Cannot coerce")
- [x] Componente `MembersAdmin` (modal fullscreen) acessível por
      botão "Membros" no header: lista profiles com badges (você,
      role, ativo/inativo), select de role e botão ativar/desativar
- [x] Gating no client: detecta se `currentUser.role === "admin"`
      pelo registro próprio na lista; non-admins veem aviso laranja
      e todos os controles bloqueados; controles do próprio user
      sempre bloqueados (evita lockout)
- [x] Texto explicativo no topo orienta criar novos membros pelo
      Supabase (Auth → Invite user) e ativar aqui

**Sobre o user inicial**: a tabela `profiles` é populada via trigger
no signup com `role` default `member` — quem cria a conta primeiro
*não* vira admin automático. Promover o admin inicial via SQL:
`update public.profiles set role='admin' where id='<uid>'` com
service_role key (admin inicial promovido em 2026-06-05).

**Follow-ups da fase de membros:**

- Cliente recém-criado por um user não aparece no select da captura
  quando outro user abre a janela flutuante na mesma sessão. Causa:
  `CaptureScreen` carrega `clients`/`profiles` só no mount, mas a
  janela `capture` do Tauri fica viva escondida entre invocações.
  Solução: ou subscrever realtime de `clients` no capture, ou
  refetch quando a janela é exibida (`tauri://focus`).
- Cadastro do primeiro admin não tem flow de UI ainda — depende de
  SQL manual. Se virar fricção, criar Edge Function tipo
  `bootstrap_admin` que aceita signup do primeiro user e o promove.

### Fase 3 — Painel de uso da IA (concluída)

- [x] `src/lib/aiUsage.ts` com `listUsageBetween`, agregações
      (summarize/bucketByDay/bucketByUser) e conversão micro→USD
- [x] `AiUsageAdmin` modal acessível por botão "Uso IA" no header:
      seletor de mês (← →), 5 cards (chamadas, tokens IN/OUT, custo,
      latência), histograma diário, ranking por usuário, e timeline
      das últimas 30 chamadas com status/modelo/tokens/latência/custo
- [x] Erros (status != success) destacados com borda vermelha;
      tooltip mostra a mensagem completa

### Fase 4 — concluída

- [x] Migration `classification_rules` aplicada (admin escreve, todos
      os membros leem)
- [x] `src/lib/classificationRules.ts` com CRUD + `applyRules` que
      muta uma cópia de AppliedDemand percorrendo regras ativas
- [x] `RulesAdmin` modal acessível pelo botão "Regras" no header;
      gating por admin (RLS reforça server-side); non-admins veem
      banner laranja e botões ocultos
- [x] CaptureScreen carrega regras junto com clients/profiles; após
      extractDemand, faz matching nome→id e roda applyRules antes da
      ConfirmView. Banner laranja no topo da revisão lista nomes das
      regras aplicadas.

**Notas operacionais:**

- Cota diária do `gemini-2.5-flash` estourou em 2026-06-05 ~23h. A
  Edge Function passou a usar `gemini-2.5-flash-lite` (cota separada
  no free tier do AI Studio). O bind 2.0-flash → 2.5-flash já estava
  documentado no Sprint 4.

## Sprint 8 — concluído

Concluído em 2026-06-05 com 4 fases entregues. Admin completo,
fundamentos de governança da equipe e auto-classificação operacional.

### Follow-ups acumulados e não-bloqueantes

**UX — janela flutuante de captura:**

- Botão de fechar visível no header — quando a IA retorna erro
  (ex.: 429), as teclas `Esc` e `Cmd+Enter` deixam de funcionar
  porque o foco sai do textarea / handler é registrado num input
  que perdeu foco. Adicionar um `✕` no topo da janela (sempre
  presente) e migrar os atalhos para um `window.addEventListener`
  global do ciclo de vida do componente.
- Tela de revisão (ConfirmView): mesmo problema, atalhos `Esc` e
  `⌘↵` no `onKeyDown` do `<div>` raiz só disparam quando o foco
  está no próprio div. Migrar para listener global enquanto a tela
  estiver montada.

**Tela de Uso da IA:**

- Exibir mensagem de erro completa em um painel lateral (drawer)
  ao clicar na linha — hoje só aparece no `title` (tooltip), não dá
  pra copiar.

**Fallback de modelo na Edge Function (RF-10 estendido):**

- Configurar uma lista ordenada de modelos no env (ex.:
  `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`).
  Em caso de 429/503 no primário, tentar o próximo automaticamente
  antes de devolver erro pro client. A captura pode ficar
  ligeiramente mais lenta nesses casos, mas o usuário não vê falha.
- Fallback **cross-provider** (OpenAI, Anthropic) é tecnicamente
  viável (mesma estratégia, payload diferente), mas hoje só o
  Gemini tem free tier de API. GPT e Claude exigem billing — para
  manter "100% gratuito no MVP" o fallback deve ficar restrito aos
  modelos Gemini por enquanto. Documentar adapter por provider
  para destravar a inclusão depois.

## Sprint 9 — em andamento (Polimento e Distribuição)

### Fase 1 — CI/CD + auto-update (em validação)

- [x] `tauri-plugin-updater` + `tauri-plugin-process` integrados
      (Rust, JS, capabilities)
- [x] Par de chaves de assinatura gerado em `~/.tauri/`
      (`tng-demand-hub.key` + `.pub`) — chave sem senha
- [x] `pubkey` configurada em `tauri.conf.json` + endpoint apontando
      para `latest.json` no GitHub Releases
- [x] `bundle.createUpdaterArtifacts: true` para o build gerar os
      artefatos do updater
- [x] `src/lib/updater.ts` com `checkForUpdate()` (chama `check()` e
      embala `downloadAndInstall()` + `relaunch()`)
- [x] `UpdateBanner` no topo do Dashboard: checa no mount + a cada
      30 min; mostra versão nova, botão "Atualizar e reiniciar" e
      botão de adiar
- [x] Workflow `.github/workflows/release.yml`: dispara em tags
      `v*`, builda macOS aarch64+x86_64 e Windows com `tauri-action`,
      cria GitHub Release com `latest.json`

### Processo de release

1. Bumpa a versão em `package.json` E `src-tauri/tauri.conf.json` E
   `src-tauri/Cargo.toml` (todos devem ficar com a mesma versão).
2. `git commit -am "chore: bump v0.X.Y"` + `git push`.
3. `git tag v0.X.Y && git push origin v0.X.Y`.
4. Workflow Release roda no GitHub Actions (~10-15 min). Quando
   termina, há uma release com `.dmg` para Mac (arm e Intel) e
   `.msi` para Windows + um `latest.json` assinado.
5. Apps já instalados detectam em até 30 min (ou no próximo
   relaunch); o `UpdateBanner` aparece e o usuário clica "Atualizar
   e reiniciar".

### Segredos necessários no GitHub

- `TAURI_SIGNING_PRIVATE_KEY` — conteúdo de
  `~/.tauri/tng-demand-hub.key` (chave privada minisign).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — vazio (chave sem senha).

`GITHUB_TOKEN` é fornecido automaticamente pelo Actions.

### Atenção — chave privada

A chave em `~/.tauri/tng-demand-hub.key` é o que assina os updates.
Se ela for perdida, **nenhuma máquina já instalada conseguirá mais
receber updates** (o `pubkey` no app não confere mais). Fazer backup
seguro (1Password / cofre da TNG) imediatamente.

### Fase 2 — Onboarding interativo (concluída)

- [x] `OnboardingTour` com 4 slides (atalho global, anexos
      multimodais, drawer/Kanban, busca+regras+notificações)
- [x] Persistência via `localStorage["tng:onboarded:v1"]`; bumpar
      a chave (`v2`, ...) força re-tour em mudanças grandes futuras
- [x] Navegação por setas ← →, Esc/Pular fecha, "Começar" no último
      slide marca como visto

### Descartado do escopo

- Tema claro/escuro — exigiria refactor de cores em todos os
  componentes (~sprint inteira), e dark mode já atende o time
  interno. Manter como single-theme.
- Code signing macOS — o "Cmd+click → Abrir" na primeira execução
  é suficiente para os 10 colaboradores; não justifica os $99/ano
  de Apple Developer no MVP.

## Sprint 9 — concluído

Concluído em 2026-06-06. Duas fases efetivamente entregues
(CI/CD+auto-update e Onboarding). Sprint 10 destrava com isso —
o app pode ser distribuído sem o admin precisar buildar e mandar
DMG/MSI manualmente a cada update.

Primeira release publicada: **v0.1.1**.

## Sprint 10 — em andamento (Refinamento pré-beta)

O PRD original previa distribuição para a equipe no Sprint 10, mas
decidimos em 2026-06-06 segurar isso e usar o sprint para atacar os
follow-ups acumulados e polir o app antes de colocar nas mãos dos
colaboradores. A distribuição vira o Sprint 11 (ou final do 10,
depende do volume).

### Follow-ups acumulados (priorizados por impacto no uso diário)

**Críticos — afetam fluxo principal**

1. Atalhos `Esc` e `⌘↵` não funcionam na janela flutuante quando há
   erro / na tela de revisão. Migrar handlers para
   `window.addEventListener` global montados pelo componente.
   (Sprint 5+8)
2. Botão `✕` sempre visível no header da janela flutuante de
   captura, independente de estado. (Sprint 8)
3. Cliente criado por um user não aparece no select da captura
   aberta por outro user na mesma sessão — `CaptureScreen` carrega
   lookups só no mount, mas a janela `capture` do Tauri fica viva
   escondida. Solução: subscribe realtime de `clients`/`profiles`
   ou refetch ao mostrar a janela (`tauri://focus`). (Sprint 8)
4. Fallback automático de modelo na Edge Function: lista ordenada
   (ex.: `gemini-2.5-flash`, `gemini-2.5-flash-lite`,
   `gemini-2.0-flash`). Em 429/503 no primário, tentar próximo
   antes de devolver erro ao client. Hoje qualquer 429 quebra a
   captura. (Sprint 8)
5. PDF anexado falha com "I/O read operation failed" no
   `FileReader.readAsDataURL`. Investigar com chunked reader ou
   migrar PDFs para a Files API do Gemini. (Sprint 5)

**Polimento de UX**

~~6. Comentários: ordenar por mais recentes em cima.~~ ✅ Resolvido
em 2026-06-06. `listComments` agora retorna `created_at desc`;
insert otimista usa `prepend`.

~~7. Indicador visual nos cards de demanda que possuem comentários.~~
✅ Resolvido em 2026-06-06. Coluna `comments_count` em `demands`
mantida por trigger em insert/delete de comments (migration
`20260606000002_demands_comments_count.sql`). Badge `💬 N` nos
cards da lista e do Kanban.

~~8. Renderização markdown da descrição no drawer.~~ ✅ Substituído
em 2026-06-06 por **editor WYSIWYG** baseado em Tiptap. Cobre o
caso real de uso (colar mensagens já formatadas do WhatsApp/email/
Slack — sintaxe markdown manual seria fricção). Banco passa a
guardar HTML sanitizado em `demands.description` e `comments.content`;
conteúdo legacy (texto puro ou markdown da IA) é convertido on-read
via `legacyToHtml` em `src/lib/htmlContent.ts` (idempotente).
Sanitização defensiva via DOMPurify antes de gravar e antes de
renderizar. Toolbar: B, I, S, code, listas, links; modo `full` no
drawer adiciona H2/H3 e blockquote.

~~9. Clicar na notificação nativa abre o drawer da demanda
correspondente.~~ ✅ Resolvido em 2026-06-06. O macOS não entrega
click no body da notificação como evento JS; usamos foco recente
da janela main (`onFocusChanged`) como proxy. `notifyAboutDemand`
em `src/lib/notifications.ts` registra `{ demandId, at }` ao
disparar a notificação; `subscribeToNotificationClick` ouve o
focus e, se ele acontece em < 8s, chama o callback com o `demandId`.
Dashboard subscreve e seta `selectedDemandId`.

Limitações conhecidas:
- Quando o user dá Cmd+Tab pro app dentro dessa janela, o drawer
  da última notificação abre — aceitável dado o fluxo.
- Quando a notificação chega com o app **já focado** (raro: outro
  user te atribui exatamente enquanto você está usando o app), o
  click no banner não muda o foco e o drawer não abre. Evolução
  futura: registrar action buttons no Tauri plugin pra capturar
  click determinístico.

**Supressão de auto-notificação**: quando o próprio user faz a
mudança (atribui-se via drawer, comenta, etc.), o realtime traz
o eco em milissegundos — sem suppressão ele seria notificado
pela própria ação. `markLocalChange(demandId)` é chamada em
`updateDemand`; o Dashboard checa `wasLocalChange()` antes de
notificar reassign. Para comments, a checagem `author_id === me`
já cobre.

**Som**: `sound: 'default'` em todas as notificações usa o som
do sistema (macOS: Pop/Funk, Windows: ms-winsoundevent default).

~~10. Limpar badge do tray icon explicitamente no `signOut`.~~
✅ Resolvido em 2026-06-06. `useAuth.signOut` chama `setTrayBadge(0)`
antes do `supabase.auth.signOut()` — garante que o ícone fica limpo
mesmo se o Dashboard demorar pra desmontar.
~~11. Tela de Uso da IA: exibir mensagem de erro completa em painel
lateral ao clicar na linha.~~ ✅ Resolvido em 2026-06-06. Drawer
lateral 480px abre ao clicar em qualquer linha de "Últimas chamadas";
mostra status, modelo, usuário, tokens, latência, custo e o
`error_message` completo em `<pre>` com botão de copiar. Esc fecha.

**Otimização e qualidade da IA**

~~12. Consistência do bloco RF-06b.~~ ✅ Resolvido em 2026-06-06.
Separamos a IA em dois campos distintos: `descricao_principal`
(tarefa em si) e `descricao_anexos` (blocos por anexo). O prompt
agora tem exemplo few-shot do certo E do errado, com instrução
explícita "NÃO descreva anexos dentro de descricao_principal". A
Edge Function junta os dois com `---` antes de devolver ao client,
então o contrato externo (`descricao` string única) não muda.
Resultado: o Gemini não tem mais ambiguidade entre os papéis dos
campos. Validação de schema rejeita resposta sem
`descricao_principal`.
~~13. Compressão de imagem no client.~~ ✅ Resolvido em 2026-06-06.
`browser-image-compression` roda dentro de `buildPendingAttachment`
para imagens > 1MB (1920px de borda, qualidade ~80%, preserva o
MIME original pra não trocar PNG por JPEG sem aviso). Falha silenciosa
devolve o original — preferir tamanho a perder o anexo.

~~14. Extração local de DOCX/XLSX/TXT/CSV.~~ ✅ Resolvido em
2026-06-06. Gemini não aceita esses MIMEs como inlineData; agora
o client extrai o texto antes de mandar pra Edge Function via novo
campo `attachment_texts`. Implementação:
- DOCX: `mammoth.extractRawText`
- XLSX: `read-excel-file/web-worker` (sheetjs tinha CVE sem fix)
- TXT/CSV: `TextDecoder('utf-8')`
- Limite de 40KB por arquivo (~10K tokens), trunca o resto

Libs são carregadas via dynamic import — só baixam quando o user
anexa o tipo correspondente. O arquivo original ainda sobe pro
Storage como anexo normal pra reabertura futura.
~~15. Vídeos > ~8MB via Files API do Gemini.~~ ✅ Resolvido em
2026-06-06. Anexos são divididos por tamanho:

- **< 4MB cada** → `inlineData` como antes (rápido, sem upload extra)
- **≥ 4MB cada** → upload prévio pra `attachments/tmp/{user}/{session}/`
  no Supabase Storage, depois a Edge Function baixa via service_role
  e sobe pra Files API do Gemini (uploadType=media), faz polling até
  state=ACTIVE e usa `fileData.fileUri` no parts

Limite por arquivo subiu de 50MB pra 200MB. Limite cumulativo inline
continua em 8MB (só pros pequenos). Vídeos de WhatsApp típicos
(15-30MB) agora funcionam.

Fluxo de path no Storage: `tmp/{user}/{session}/{id}.{ext}` durante
a fase de revisão; ao confirmar, `storage.move()` renomeia atomic
para `{demand_id}/{attachment_id}.{ext}`. Se o usuário cancela a
captura, `closeWindow` faz best-effort de apagar os órfãos do tmp.

**Follow-up**: cron job pra limpar `tmp/*` mais velhos que 24h
(captura abandonada que escapou do cleanup do closeWindow). Pode
ser uma Edge Function agendada via Supabase scheduled functions ou
pg_cron.

**Convite e governança**

~~16. Cadastro do primeiro admin sem flow de UI.~~ Descartado em
2026-06-06. O admin inicial já existe no Supabase; promover outros
membros é SQL pontual feito no painel. Sem fricção real.
17. Convite por e-mail integrado no app (Edge Function chamando
    `auth.admin.inviteUserByEmail`). Hoje admin precisa convidar
    no painel do Supabase. (Sprint 8)

## Sprint 10 — concluído

Concluído em 2026-06-06. Todos os follow-ups críticos do pré-beta
fechados (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
item 16 descartado por baixa fricção real.

## Sprint 11 — concluído (Refinamento visual + nome do produto)

Concluído em 2026-06-07. Disparado por feedback de uso real e
preparação visual pré-beta. Renomeado de "TNG Demand Hub" para
**"TNG Sites — Demandas"** (productName no tauri.conf.json,
package.json e título da janela main).

### Infra de testes

- Vitest 4 + jsdom + Testing Library configurado. Setup global em
  `src/test/setup.ts` mocka cliente Supabase e plugins Tauri.
  Factories em `src/test/factories.ts` (`makeDemand`, `makeClient`,
  `makeProfile`, `makeComment`).
- `npm test` = watch mode; `npm run test:run` = single shot (CI).
  Não setar `watch: false` no config — quebra o `npm test` interativo.
- CI em `.github/workflows/test.yml` roda `tsc --noEmit` +
  `npm run test:run` em push/PR.
- Mocks de componentes pesados: `RichTextEditor` (Tiptap) é
  substituído por `<textarea>` em testes de Drawer/Comments via
  `vi.mock`. Contrato testado é `value/onChange(html)/onBlur`.
- 110 testes em 11 arquivos cobrindo `htmlContent`, `demandHistory`,
  `attachments`, `comments`, `clients`, `notifications`,
  `useDemandEditor`, `CardBadges`, `DemandDetailDrawer`,
  `CommentsThread`, `MembersAdmin`.

### Schema / dados

- `clients` ganhou `google_business_url`, `drive_urls text[]`,
  `whatsapp_group_url` (migration `20260607000001_client_links.sql`).
  Renderizados no drawer como botões com ícone Font Awesome.
- `demands` ganhou `infrastructure` (enum `wordpress` | `site_ia`,
  migration `20260607000002_demand_infrastructure.sql`). IA preenche
  via campo `infraestrutura` na resposta da Edge Function; editável
  no drawer.
- `comments` policy de delete trocada de "autor ou admin" para
  **admin only** (migration `20260607000003_comments_admin_only_delete.sql`).
- Histórico de demandas: tabela `demand_history` + triggers
  (security definer) em `demands` (insert/update por campo),
  `comments` (insert/delete) e `attachments` (insert). Migration
  `20260607000004_demand_history.sql`. SELECT só pra admin (RLS).
  Renderizado no drawer abaixo de Metadados, com "Ver mais" pra
  expandir além dos 5 mais recentes. Bug de timezone em `due_date`
  resolvido com regex `YYYY-MM-DD` em vez de `new Date(...)`.
- `demands.attachments_count` denormalizada por trigger
  (`20260607000005_demands_attachments_count.sql`); badge no card.

### UX — Dashboard / cards

- **Status como botões** (não mais select): 3 botões `A fazer` /
  `Em andamento` / `Concluída` aparecem tanto no card da lista
  quanto no header do drawer. Componente `StatusButtons` em
  `DashboardScreen.tsx`. Paleta:
  - todo: teal text + border, sem background
  - doing: emerald border + text, sem background
  - done: emerald background no hover/active (verde sólido)
- **Prioridade**: `baixa` marine-400, `media` sky-400, `alta`
  amber-400, `urgente` red-500. Decisão: laranja confundia com
  status; amarelo `media` ficou ilegível — mantido sky.
- **CardBadges com `flex-row-reverse`**: responsável é sempre
  o mais à direita; badges opcionais (prioridade, cliente,
  comentários, anexos) entram à esquerda dele.
- **Stats neutros**: números em `text-tng-marine-50` (sem
  cores quentes). "Atrasadas" tem ícone de atenção
  (`fa-triangle-exclamation`) ao lado do número.
- **"Ver concluídas"** vira filtro exclusivo na lista: clicar
  esconde A Fazer/Em Andamento e mostra só done. Kanban sempre
  exibe a coluna Concluída.
- **Notificação ao concluir**: dispara para `assignee` e
  `created_by` quando status muda pra `done`. Filtro
  `wasLocalChange()` evita auto-notificar quem fez a mudança.
- **Filtros como buttons**: substituídos os selects do header
  por chips clicáveis (multi-select, com contador).

### UX — janela flutuante de captura

- Título sucinto: a IA agora gera `titulo` (verbo + objeto,
  30-60 chars) além da descrição. Campo no `ConfirmView`.
- Campo `Infraestrutura` editável no drawer e na captura
  (preenchido pela IA).
- **Janela retangular** (decisão de 2026-06-07): tentamos
  `transparent: true` + `rounded-2xl` no shell HTML pra ter
  bordas arredondadas estilo Claude. Em dev, o Tauri não recria
  a janela ao mudar `transparent` no config, então o webview
  fica opaco e vaza branco nos cantos. Em prod (`tauri build`)
  funcionaria, mas o owner preferiu reverter pra simplicidade
  visual: borda reta, sem `transparent`, sem `rounded-2xl`.

### Ícones — Font Awesome

- Migramos todos os ícones de emojis/caracteres pra Font Awesome
  via pacote npm `@fortawesome/fontawesome-free`. O CSS é importado
  em `src/main.tsx` (`@fortawesome/fontawesome-free/css/all.min.css`)
  e usa webfont — zero manipulação de DOM em runtime. Estilos
  `fa-solid` (padrão) e `fa-brands` (WhatsApp, Google Drive, etc.)
  disponíveis.
- Helper `categoryIconClass` em `src/lib/attachments.ts` mapeia
  categorias de anexo → classe Font Awesome.

**Histórico (2026-06-08):** Inicialmente usávamos o Kit Font Awesome
(`https://kit.fontawesome.com/...js`) que injeta CSS + transforma
`<i>` em `<svg>` em runtime via MutationObserver. Isso causava
`NotFoundError: The object can not be found here.` no React 19
quando elementos `<i>` em renders condicionais eram desmontados —
o React tentava operar num `<i>` que o Kit já tinha trocado por
`<svg>`. O erro cascateava e quebrava outros effects (incluindo
listeners de `tauri://drag-drop`). A migração pro pacote npm
eliminou a manipulação de DOM e fechou todo esse vetor.

### Admin

- **Edição inline de nome** no `MembersAdmin`: botão lápis ao
  lado de cada nome. Admin pode editar qualquer; user pode editar
  próprio (RLS `profiles_update_own`). Enter salva via blur,
  Escape cancela. Realtime / refresh sincroniza `draftName` quando
  não está editando.

## Sprint 12 — em andamento (Polimento pré-beta)

Sessão de polimento entre 2026-06-08 e 2026-06-10 antes de
distribuir pro time. Foco em qualidade da IA e UX da captura.

### Refinamentos da IA na captura

- ✅ ✨ **Refinar prompt da IA (#82) — 2026-06-08.** Título da demanda
  agora inclui o cliente quando identificado ("Banner da Cliente A"
  em vez de só "Banner"). Adicionados mais few-shots no prompt
  cobrindo casos curtos comuns ("feito 3 do Cliente A", "Cliente B
  aprovou") pra reduzir falsos "criar". Edge Function `extract-demand`.

- ✅ ✨ **Anexos no modo editar via IA (#79) — 2026-06-10.** Antes,
  anexos enviados pra IA no modo `editar` eram interpretados pra
  contexto mas **descartados** ao confirmar. Agora `saveEditMode`
  em `CaptureScreen.tsx` chama `uploadAll(targetDemand.id, user.id)`
  depois do `updateDemand`, reaproveitando o mesmo pipeline do
  fluxo de criação (move tmp→final pros anexos grandes, upload
  direto pros pequenos). `EditConfirmView` ganhou uma seção
  "Anexos a adicionar (N)" com `AttachmentRow` e botão dinâmico
  ("Aplicar 2 mudanças + 1 anexo"). Permite confirmar sem nenhum
  diff marcado se houver anexo (caso "só quero anexar uma imagem
  na demanda X").

- ✅ ✨ **Prompt distingue anexar de comentar — 2026-06-10.** Edge
  Function `extract-demand` ganhou exemplo `[D]` em "editar"
  cobrindo "anexa esse print na demanda do banner do Cliente A" +
  imagem → `intencao: "editar"`. Regra forte no topo das dicas:
  captura com anexo + referência a demanda existente → SEMPRE
  editar, nunca comentar (anexos só ficam vinculados a demandas
  neste sistema; comentários não suportam arquivos). Sem essa
  regra a IA classificava "anexa essa imagem na demanda X" como
  comentar — que descartava silenciosamente o anexo.

### Quick Look preview (#80) — 2026-06-11

- ✅ ✨ **Janela Tauri separada para anexos com zoom.** Substituído o
  overlay full-screen do drawer (`AttachmentViewer`) por uma janela
  Tauri dedicada (`label: "preview"`), pré-declarada em
  `tauri.conf.json` (visible: false, viva escondida — mesmo padrão
  da `capture`). Carrega 1000×720, redimensionável, decorations
  nativas, fica fora do alwaysOnTop.
- ✅ ✨ **Comunicação main → preview via evento Tauri.** Helper
  `src/lib/preview.ts` resolve a signed URL do Storage, emite
  `preview:open` com payload (`url`, `name`, `mime`, `sizeBytes`)
  pra janela e dá show + focus. `PreviewScreen.tsx` escuta o
  evento e atualiza o título da janela com o nome do arquivo.
- ✅ ✨ **Zoom rico em imagens.** Scroll wheel com pivô no cursor
  (mantém o pixel sob o cursor parado), drag pra pan quando
  ampliado, double-click toggle 1×↔2×, atalhos `+` / `−` / `0`,
  range 10%–1000%. Vídeo, áudio e PDF continuam com controles
  nativos do webview (zoom de PDF é nativo do iframe).
- ✅ ✨ **Janela é hideable, não closeable.** `onCloseRequested`
  intercepta o X nativo e chama `hide()` em vez de fechar — assim
  a janela sobrevive entre invocações e a próxima abertura é
  instantânea. Esc também esconde.
- ✅ ✨ **Permissões adicionadas.** `core:event:allow-emit`,
  `core:event:allow-emit-to`, `core:window:allow-set-title` no
  `capabilities/default.json`. Janela `preview` incluída em
  `windows: ["main", "capture", "preview"]`.

#### Ajustes pós-feedback (2026-06-11):

- ✅ ✨ **Áudio toca inline, não abre janela.** Áudio não tem
  benefício de zoom ou janela separada — só atrapalha. Agora
  `AttachmentItem` no drawer detecta `category === "audio"` e,
  ao clicar, expande um `<audio controls>` dentro do próprio
  item (signed URL carregado on-demand). O botão alterna entre
  "Tocar" e "Recolher". Imagem/vídeo/PDF continuam abrindo na
  janela preview.
- ✅ ✨ **Botão Fechar visível na PreviewScreen.** Adicionado `✕`
  no header (sempre presente), e o container raiz ganha
  `tabIndex={-1}` + foco automático ao receber payload — assim
  Esc funciona no abrir.
- ✅ ✨ **Esc funciona também dentro do iframe de PDF.** Quando o
  payload é PDF, registramos `Escape` como **global shortcut**
  escopo-por-foco: o useEffect ouve `onFocusChanged` da janela
  e só mantém o atalho registrado enquanto a preview está em
  primeiro plano. Isso evita sequestrar o Esc de outros apps.
  Atalho é desregistrado ao trocar de PDF pra outro tipo, ao
  esconder a janela e no unmount. Permissions adicionadas:
  `global-shortcut:allow-register/unregister/is-registered`.
- ✅ 🐛 **Mídia para ao esconder a janela.** Antes, `hide()` só
  invisibilizava o webview — `<video>` e `<audio>` continuavam
  tocando. Agora `hide()` limpa o `payload` (desmonta a mídia)
  antes do `getCurrentWindow().hide()`. Reseta zoom/pan também.
- ✅ 🐛 **Imports estáticos pra Tauri APIs.** `lib/preview.ts` e
  `PreviewScreen.tsx` usavam `import("@tauri-apps/api/webviewWindow")`
  e `import("@tauri-apps/plugin-global-shortcut")` dinâmicos.
  O Vite não pre-bundla deps descobertas só em runtime, então a
  primeira tentativa devolvia 504 "Outdated Optimize Dep" e o
  preview falhava com "Importing a module script failed". Trocados
  por imports estáticos no topo dos arquivos.
- ✅ 🐛 **`optimizeDeps.include` no `vite.config.ts`.** Mesmo com
  imports estáticos, o cache stale do Vite (`node_modules/.vite`)
  pode segurar o 504 entre runs. Adicionado include explícito de
  `@tauri-apps/api/event`, `@tauri-apps/api/webviewWindow`,
  `@tauri-apps/api/window` e `@tauri-apps/plugin-global-shortcut`
  pra força bruta no pre-bundle do boot. Defesa contra esse vetor
  voltar a aparecer pra outras APIs Tauri.

### Viewer de documentos office (#81) — 2026-06-11

- ✅ ✨ **DOCX/XLSX/TXT/CSV abrem dentro da PreviewScreen.** Antes,
  esses tipos caíam no fallback "Pré-visualização não suportada —
  use Baixar". Agora cada um tem um viewer dedicado dentro da
  janela preview. Tipos não-office (e.g. RTF, ODT) continuam com
  o fallback.
- ✅ ✨ **`src/lib/officeRender.ts`.** Funções `renderDocxAsHtml`,
  `renderXlsxAsSheets`, `renderTextFile` que aceitam signed URL,
  fazem fetch como `Uint8Array` e usam as mesmas libs do pipeline
  de extração pra IA — `mammoth.convertToHtml` (que devolve HTML
  com formatação, vs `extractRawText` usado pra IA),
  `read-excel-file/web-worker` (linhas por aba). Lazy import,
  zero impacto no bundle inicial. Também tem `parseCsv` próprio
  pra CSV com aspas duplas.
- ✅ ✨ **Componentes na PreviewScreen.** `DocxView` renderiza o
  HTML sanitizado (DOMPurify) num container `bg-white max-w-3xl`
  estilo página de Word. `XlsxView` tem **tabs de abas** quando
  há mais de uma planilha + `<table>` com header sticky e
  numeração de linhas. `CsvView` reusa o `SheetTable`.
  `PlainTextView` é `<pre>` monoespaçado. Loading e error states
  comuns via hook `useAsyncResource(loader, key)`.

#### Hardening pós-feedback (2026-06-11):

- ✅ 🐛 **XLSX: normalização do retorno de `read-excel-file`.** A lib
  às vezes devolve `{ rows, errors }` em vez de `Row[]` puro
  (depende da versão e do formato do arquivo). `renderXlsxAsSheets`
  agora normaliza pra `Cell[][]` e garante que cada linha é uma
  array — sem isso, `header.map(...)` no `SheetTable` lançava
  TypeError com planilhas em formato inesperado.
- ✅ 🐛 **XLSX: API v9 do `read-excel-file` — 2026-06-11.** A
  primeira tentativa usava `readXlsxFile(blob, { getSheets: true })`
  + leitura aba a aba por `s.name`, padrão das versões antigas.
  Mas a v9.0.10 (instalada) reescreveu a API: o default export
  agora devolve `Sheet[]` direto (`{ sheet: string, data: Row[] }[]`)
  e a opção `getSheets` não existe mais. Resultado: `s.name` saía
  `undefined`, a leitura por aba caía num modo que devolvia tudo
  aninhado, o `normalizeRow` via cada Sheet como objeto e pegava
  `Object.values`, gerando linhas tipo `[nome_da_aba, dados_em_JSON]`
  na tabela. Também causava `Encountered two children with the
  same key, NaN` porque `s.name + i` com `undefined` é `NaN`.
  Reescrito pra uma única chamada `readXlsxFile(blob)` que já
  devolve todas as abas no formato certo.
- ✅ ✨ **#81 fechado — 2026-06-11.** XLSX, DOCX, CSV e TXT abrindo
  certinho na PreviewScreen, com tabs de abas e formatação. Pronto
  pra distribuição beta.
- ✅ 🐛 **`SheetTable` com guards.** Se `header` não for array mesmo
  após normalização, mostra "Planilha em formato não suportado"
  em vez de crashar.
- ✅ 🐛 **`ViewerErrorBoundary` em volta dos viewers.** Class
  component minimalista (`getDerivedStateFromError` +
  `componentDidCatch`) que captura throws de qualquer viewer e
  exibe o `ErrorPane`. Reset via `key={payload.url}` — toda troca
  de arquivo monta um boundary novo, sem estado de erro herdado.
  Antes, um crash em planilha deixava a árvore React em estado
  ruim e os próximos arquivos abertos também não montavam direito.

### Bug pré-existente corrigido

- ✅ 🐛 **Tiptap: extensão `link` duplicada — 2026-06-11.** StarterKit
  v3 já inclui `Link` por padrão e a gente registrava `Link` de
  novo no `RichTextEditor` pra setar `autolink`, `linkOnPaste` e
  classes custom. Resultado: warning `[tiptap warn]: Duplicate
  extension names found: ['link']` em todo render. Desligado o
  Link do StarterKit (`link: false`) — nossa config custom segue
  sendo a única em uso.
- ✅ 🐛 **Global shortcut Esc abria a captura — 2026-06-11.** O
  `tauri_plugin_global_shortcut::Builder::with_handler(...)` no
  Rust era um handler global que disparava `show_capture_window`
  pra QUALQUER shortcut Pressed, ignorando qual era. Funcionou até
  agora porque só existia o Cmd+Shift+D. Quando o PreviewScreen
  passou a registrar `Escape` pra fechar PDFs (Sprint 12 #80), o
  mesmo handler abria a captura toda vez que o Esc disparava.
  Corrigido removendo o `with_handler` e usando `on_shortcut` no
  `set_capture_hotkey` — handler específico por shortcut, sem
  dispatch global.

### Bugs corrigidos

- ✅ 🐛 **Drag-drop reabilitado (#83) — 2026-06-10.** Funcionou após
  a migração do Font Awesome do Kit pro pacote npm (Sprint 11):
  o Kit injetava `<svg>` no lugar de `<i>` em runtime e
  cascateava num `NotFoundError` do React 19 que quebrava o
  listener `tauri://drag-drop`. Sem o Kit, o handler sobrevive
  e o drop funciona normal.

- ✅ 🐛 **Font Awesome — Kit→npm — 2026-06-08.** Migrado de
  `https://kit.fontawesome.com/...js` pra
  `@fortawesome/fontawesome-free` (CSS + webfont, zero
  manipulação de DOM). O Kit em modo SVG conflitava com o
  reconciler do React 19 (cascateava `NotFoundError`). Import
  em `src/main.tsx`: `import "@fortawesome/fontawesome-free/css/all.min.css"`.
  Kit script + bloco `window.FontAwesomeConfig` removidos do
  `index.html`.

### Identidade visual

- ✅ ✨ **Ícone do app atualizado pra logo-icone.png — 2026-06-11.**
  Rodado `npx tauri icon ../logo-icone.png` na raiz do
  `tng-demand-hub`. Regenerou todos os tamanhos automaticamente:
  `src-tauri/icons/{32x32,128x128,128x128@2x}.png`, `icon.png`,
  `icon.icns` (macOS dock), `icon.ico` (Windows), `StoreLogo` +
  `SquareXXxXXLogo` (Windows Store), além de iOS/Android (não
  usamos mas a CLI gera de qualquer jeito). O tray icon do
  menubar reaproveita `app.default_window_icon()` em `lib.rs:365`,
  então atualizou junto — fica em monocromático no macOS por
  causa de `icon_as_template(true)` (convenção do menubar; pra
  manter colorido é só mudar pra `false`).
  - **Favicon da janela:** adicionado `<link rel="icon"
    type="image/png" href="/logo-icone.png" />` no `index.html`
    e `logo-icone.png` copiado pra `public/` (Vite serve `/public/*`
    como root).
  - **Atenção ao gerar:** `tauri icon` só regera os PNGs. O cargo
    NÃO detecta mudança nos PNGs sozinho — é preciso tocar
    `tauri.conf.json` (ou mexer no `Cargo.toml`) pra forçar
    `cargo:rerun-if-changed`. Sem isso, o binário em
    `target/debug/` segue com ícone antigo. Depois do rebuild, o
    macOS ainda cacha ícone no Dock: `killall Dock` força refresh.
- ✅ ✨ **Tray icon colorido — 2026-06-11.** `icon_as_template(true)`
  em `src-tauri/src/lib.rs:366` mandava o macOS converter o
  tray pra silhueta monocromática (só canal alfa). Como o
  `logo-icone.png` tem fundo preenchido (sem transparência), saía
  como quadrado branco no menubar. Trocado pra `false` — mostra
  o foguete colorido. Convenção macOS prefere template, mas
  exigiria um SVG/PNG silhueta puro.
- ℹ️ **Ícone no AltTab / Cmd+Tab em dev mode.** No `npm run tauri
  dev`, o app roda como binário cru (`target/debug/tng-demand-hub`),
  sem `.app` empacotado. macOS/AltTab caem num ícone genérico de
  executável (parece terminal). No build de produção
  (`npm run tauri build`), o `.app` tem `Info.plist + icon.icns` e
  o ícone correto aparece em todo lugar. Nada a corrigir.

### Limpeza pré-distribuição

- ✅ ✨ **Testes removidos do projeto — 2026-06-11.** Apagados todos
  os `*.test.ts(x)` (15 arquivos em `src/lib/` e `src/components/`),
  a pasta `src/test/` (setup + factories), `vitest.config.ts` e os
  scripts `test`/`test:run` do `package.json`. DevDeps `vitest`,
  `@testing-library/*` (dom/react/jest-dom/user-event) e `jsdom`
  desinstaladas (`npm install` removeu 50 pacotes do node_modules).
  Motivo: a suíte era do MVP inicial e não estava sendo mantida
  com as novas features. Pra reativar no futuro, basta `npm i -D
  vitest @testing-library/{react,dom,jest-dom,user-event} jsdom` +
  recriar `vitest.config.ts`.

### Hotfix do auto-updater (v0.1.3) — 2026-06-11

- ✅ 🐛 **Em-dash no productName quebrava o `latest.json`.** Na release
  v0.1.2 o `tauri-action` logou `Signature not found for the updater
  JSON. Skipping upload...` em ambos os jobs (macOS e Windows), e o
  `latest.json` não foi anexado. Resultado: o endpoint do updater
  (`releases/latest/download/latest.json`) ficou retornando 404 —
  auto-update silenciosamente quebrado. Causa raiz: o caractere `—`
  (em-dash, U+2014) no `productName: "TNG Sites — Demandas"` parece
  confundir a lógica de matching de arquivo .sig no tauri-action.
  Na v0.1.1 (nome era "TNG Demand Hub", sem em-dash) funcionava.
- ✅ 🐛 **Fix: em-dash trocado por hífen ASCII em 6 lugares.**
  `tauri.conf.json` (`productName` + `windows[0].title`),
  `index.html` (`<title>`), `src-tauri/src/lib.rs` (header comment,
  menu item "Abrir TNG Sites - Demandas", tray tooltip).
- ✅ ✨ **Bump 0.1.2 → 0.1.3 e novo release.** v0.1.2 fica como
  histórico mas não pode ser usada como base de auto-update.

### Hotfix do build de produção (v0.1.4) — 2026-06-12

- ✅ 🐛 **`fetch failed` no login após instalar release.** O `release.yml`
  não passava `VITE_SUPABASE_URL` nem `VITE_SUPABASE_ANON_KEY` como
  env vars pro step do `tauri-action`. O `vite build` no GitHub
  Actions rodava sem essas vars, então `import.meta.env.VITE_SUPABASE_URL`
  ficava `undefined` e o `client.ts` caía no fallback
  `https://placeholder.supabase.co`. Qualquer fetch → ENOTFOUND. O
  bug só apareceu agora porque até v0.1.3 ninguém tinha testado o
  binário distribuído (sempre testava via `tauri dev`, que lê
  `.env.local`).
- ✅ 🐛 **Fix: secrets `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
  adicionadas ao GitHub** e passadas pro env do step. Anon key é
  pública por design do Supabase, ir no binário é o esperado;
  proteção real é RLS + signup público desabilitado.

### Gatekeeper do macOS — workaround manual

- ℹ️ **".app está danificado"** ao abrir o `.dmg` baixado: macOS marca
  com `com.apple.quarantine` arquivos vindos da internet, e como o
  app não é notarizado pela Apple (precisaria do Developer Program
  pago, $99/ano), Gatekeeper bloqueia direto em vez de oferecer
  "Open anyway". Solução pros membros Mac:
  `xattr -cr "/Applications/TNG Sites - Demandas.app"`
  Roda uma vez após cada install manual. Updates via auto-updater
  não precisam (Tauri remove quarantine internamente).

### Auditoria pré-distribuição (2026-06-12)

Antes de tornar o repo público, varredura completa de secrets, info
sensível e superfície de ataque. Resultado: nenhum secret real
exposto, histórico do git limpo, edge functions usando `Deno.env.get()`,
permissões Tauri mínimas. Pequenas limpezas aplicadas:

- ✅ ✨ **Project ref do Supabase removido do CLAUDE.md.** Estava em 4
  lugares: bloco de comandos úteis, seção "Configuração do Supabase
  remoto", link do painel. Substituído por placeholder `$SUPABASE_PROJECT_REF`
  + nota de que o valor real está no `.env.local`. (Tecnicamente o ref
  vai no binário via `VITE_SUPABASE_URL`, mas defense in depth — não
  precisa estar em texto puro no repo público.)
- ✅ ✨ **Nomes de clientes reais anonimizados** na Edge Function
  `extract-demand/index.ts` (27 ocorrências) e no CLAUDE.md. "Bruning
  Homes" → "Cliente Beta", "Acme" → "Cliente Alfa". Não afeta a
  classificação da IA (são só few-shots), mas evita expor relação
  comercial real.
- ✅ ✨ **Menções a username pessoal ("cardoso.webdesign") sanitizadas**
  no CLAUDE.md — substituído por "admin inicial" / "owner".
- ✅ ✨ **CSP ativado no `tauri.conf.json`.** Antes era `csp: null`
  (permite qualquer fetch/script). Agora whitelist específica:
  `default-src 'self'`, `connect-src` só pro Supabase + GitHub
  releases, `script-src` com `'unsafe-inline'` (Vite precisa),
  `style-src` + `font-src` pro Google Fonts. Protege contra XSS se
  algum input não sanitizado chegar no DOM.
- ✅ ✨ **README.md reescrito.** Saiu o template padrão do Tauri
  ("Tauri + React + Typescript"), entrou documentação real:
  descrição do app, instruções de install pros membros (Win + Mac
  arm/intel), setup de dev, pipeline de release.

## Sprint 13 — em stand-by (Beta Interno)

Distribuição para a equipe TNG (~5 pessoas) decidida em 2026-06-06
para ficar em stand-by até concluir o Sprint 12.

Quando reativar:
- Distribuição via update assinado (workflow Release já está pronto)
- Coleta de feedback estruturada
- Correção de bugs do uso real
- Documentação de uso interna

---

# ⚡ Migração do Blog (Sprints 21–29) — v0.2.0

> **Trilha separada.** As sprints desta seção correm em paralelo às sprints do
> app principal e **não modificam nenhuma funcionalidade existente do TNG
> Demand Hub**. A única alteração no app principal é o botão "Blog" no header
> (`DashboardScreen.tsx`) e a configuração do sidecar em `tauri.conf.json` +
> `src-tauri/src/lib.rs` + `capabilities/default.json`. Tudo o resto vive
> isolado em `blog-backend/`.
>
> **Contexto:** o app Python original em `../Blog - TNG Digital/` (fora do
> repo) funciona muito bem, mas o cliente MCP do Magnific exige WSL no
> Windows (RNF-14 do PRD do Blog). Para distribuir pra equipe Mac+Windows
> sem WSL, reescrevemos o backend em Node.js/TypeScript com os SDKs oficiais
> (`@google/genai`, `@modelcontextprotocol/sdk`) que rodam nativos em ambos
> os SOs. O plugin WordPress v2 continua funcionando sem update em clientes
> já conectados. O esquema `blog.*` no Supabase permanece intocado (apenas
> ganha `blog.ai_usage`).
>
> **Plano detalhado:** `~/.claude/plans/golden-floating-quill.md`.
>
> **Segurança:** nenhuma credencial commitada. `.env.local`, `data/` e
> binários compilados estão em `blog-backend/.gitignore`. Chaves de API vão
> como GitHub Actions secrets. Token OAuth do Magnific fica em
> `data/magnific_token.json` (gitignored). Token do WordPress vive no
> Supabase (RLS protege). Sem hardcode em nenhum arquivo.

## Sprint 21 — Fundação do backend Node — 2026-07-01

Setup inicial da pasta `blog-backend/` como monorepo dentro do TNG Demand
Hub, com Bun + Hono + TypeScript strict + dependências dos SDKs oficiais.
Servidor mínimo rodando com healthcheck, autenticação por token Supabase e
teste automatizado.

- ✅ ✨ **Estrutura inicial `blog-backend/` — 2026-07-01.** Pastas `src/`,
  `src/steps/`, `tests/`, `data/`. `.gitignore` bloqueando `.env*`, `data/*`
  (exceto `.gitkeep`), `dist/`, binários compilados (`tng-blog-sidecar*`) e
  `node_modules/`. `.env.example` com nomes das variáveis (sem valores).
  `package.json` com scripts `dev`, `start`, `build:mac`, `build:mac-x64`,
  `build:win`, `test`, `typecheck` — targets Bun compile pra Mac ARM64,
  Mac x64 e Windows x64. Deps: `@google/genai`, `@modelcontextprotocol/sdk`,
  `@supabase/supabase-js`, `hono`, `sharp`, `docx`. `tsconfig.json` em modo
  strict total. `README.md` da pasta explicando por que existe e como rodar.
  **Segurança:** nenhum arquivo committado contém segredos; `.env.local`
  continua fora do git.
- ✅ ✨ **Bun 1.3.14 instalado — 2026-07-01.** `brew install oven-sh/bun/bun`.
  Requisito do sidecar (compila o bundle standalone Mac/Windows).
- ✅ ✨ **`src/env.ts` — 2026-07-01.** Lê `Bun.env`, valida obrigatórias
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`), aborta com `process.exit(1)` e
  mensagem em pt-BR se faltar. `PORT` validado como inteiro 1-65535.
  Defaults: `GEMINI_MODEL="gemini-2.5-flash"`, `MAGNIFIC_MCP_URL` oficial,
  `PORT=8000`, `DATA_DIR="./data"`.
- ✅ ✨ **`src/supabase.ts` — 2026-07-01.** `makeSupabaseForUser(token)` cria
  cliente com `db: { schema: "blog" }` e sessão do usuário via header
  `Authorization: Bearer`. `sondarSchema(token)` faz SELECT head barato em
  `blog.sites` pra confirmar exposição do schema. Type export
  `BlogSupabaseClient` necessário pra generic `<any, "blog", ...>`.
- ✅ ✨ **`src/middleware/auth.ts` — 2026-07-01.** Middleware Hono que aceita
  `X-Supabase-Token` OU `Authorization: Bearer`. Chama `auth.getUser(token)`
  num client admin dedicado (sem sessão). 401 com msg pt-BR se faltar ou
  inválido. Salva `user` e `supabase` no `c.set()` pro handler consumir.
- ✅ ✨ **`src/main.ts` — 2026-07-01.** Servidor Hono. **Binda em
  `127.0.0.1`** (nunca `0.0.0.0` — sidecar local). Fallback de porta: tenta
  `PORT`..`PORT+10` em `EADDRINUSE`. CORS restrito a `tauri://localhost`,
  `http://localhost:1420`, `http://127.0.0.1:1420`. Middleware de log
  método+path+status+ms. Handler global de erro (500 com `{error, details}`
  em pt-BR). Rotas: `GET /api/health` (pública) e `GET /api/me` (com auth,
  retorna `user_id`, `email`, `schema_ok`). Graceful shutdown SIGTERM/SIGINT.
- ✅ ✨ **`tests/health.test.ts` — 2026-07-01.** Sobe o servidor em processo
  filho (porta random 39000–39999), faz polling até `/api/health` responder,
  testa 200 no health e 401 no `/api/me` sem token. **2/2 passa em 272ms.**
- ✅ ✨ **Verificação — 2026-07-01.** `bun install` OK (172 pacotes, 3.86s).
  `bun run typecheck` sem output (zero erros). `bun test tests/health.test.ts`
  → 2 pass, 6 expect() calls, 278ms.

**Follow-ups conhecidos:**
- `sharp` tem postinstall script bloqueado (`bun pm untrusted`). Liberar
  antes da Fase 3 (imagens).
- `@google/genai` instalado em v1.52.0 (pedimos `^1.0.0`). Sem impacto agora.
- Não rodei o sidecar com token Supabase real ainda — só teste do health.
  Validação com token real fica pra integração no Tauri (Fase 6).

## Sprint 22 — Módulos puros portados (WordPress + Gemini + publish + docx + links) — 2026-07-01

Fase 2 do plano de migração do Blog: portados 5 módulos "puros" (sem
dependência do MCP do Magnific) que reproduzem 1:1 o comportamento do
Python. Nada de rota nova em `main.ts` — a Fase 4 pluga essas peças.

- ✅ ✨ **`src/wordpress.ts` — 2026-07-01.** Cliente REST compartilhado
  portado de `app/wp_client.py`. `buildAuthHeaders` decide entre token
  do plugin (novo, header `X-TNG-Blog-Token`) e Application Password
  (legado, `Authorization: Basic base64(user:pass)`). `wpFetch` é o
  wrapper de `fetch` com User-Agent de Chrome real (Cloudflare bloqueia
  UA default — visto no POC do Python), retry automático em 502/503/504
  (2 retries com backoff 1s/3s) e nunca lança em HTTP != 2xx (devolve
  `{status, data, error}`). Sobem também: `testarConexao`,
  `gravarRankMath`, `criarPost`, `uploadMidia`, `atualizarMidia`,
  `buscarPaginas`, `buscarPosts`. Erros ao usuário sempre em pt-BR;
  detalhes técnicos ficam em `error.cause`.
- ✅ ✨ **`src/steps/links.ts` — 2026-07-01.** Descoberta de links
  internos (2 páginas + 1 post) via WP REST. Preserva a lista
  `_SLUGS_EVITAR` do Python (`contato`, `privacidade`, `termos`,
  `checkout`, `cookies`, `lgpd`, etc.). Não força link fraco — se não
  encontrar candidato relevante, devolve menos. Falha de conexão vira
  `Error` em pt-BR com `.cause` pro debug.
- ✅ ✨ **`src/steps/gemini.ts` — 2026-07-01.** Cliente Gemini via SDK
  `@google/genai` em modo JSON estruturado
  (`responseMimeType: "application/json"`). Retry 3× com espera de 5s
  em erros transitórios (503/429/UNAVAILABLE/RESOURCE_EXHAUSTED);
  fallback pro `gemini-2.5-flash-lite` na última tentativa. Aplica
  `_LIMITE_TITULO=100` e `_LIMITE_RANKMATH=300` cortando só em borda
  de palavra (nunca no meio). Slug determinístico via `_normalizarSlug`
  (NFD + strip acento + `[^a-z0-9]+` → `-` + trim). Log seguro (nunca
  vaza API key nem prompt inteiro; só primeiros 100 chars). Helpers
  `_normalizarSlug` e `_limitarBordaPalavra` exportadas pra teste.
- ✅ ✨ **`src/steps/publish.ts` — 2026-07-01.** Publicação no WP
  respeitando RNF-06 (nada pela metade): sobe todas as mídias ANTES de
  criar o post. 1ª imagem vira `featured_media`, demais entram como
  `<figure>` antes do 2º, 3º… `<h2>` (pulando o 1º — mesmo algoritmo
  do Python, `_inserirImagensNoCorpo`). `_resolverStatus` decide entre
  `publish` / `draft` / `future` (com `date_gmt` em UTC). RankMath é
  best-effort — se falhar, marca `rankmath_ok: false` mas não derruba
  a publicação. Devolve `{post_id, post_url, slug, rankmath_ok}`.
- ✅ ✨ **`src/steps/docx.ts` — 2026-07-01.** Geração do .docx do
  artigo pra aprovação do cliente. Parser HTML minimalista próprio
  (sem dep extra) traduz `<h1>`–`<h6>` pra `HeadingLevel`, `<p>` pra
  parágrafo, `<ul>/<ol>/<li>` pra listas bullet/numbered, `<strong>/<b>`
  pra bold, `<em>/<i>` pra italics, `<a>` pra `ExternalHyperlink`.
  `<figure>/<img>` são ignorados (docx é só do texto). Retorna
  `Uint8Array` (bytes começam com `PK`, magic do container zip).
- ✅ ✨ **Testes automatizados — 2026-07-01.** 4 arquivos novos,
  todos passando: `tests/gemini.test.ts` (10 casos, cobrindo slug e
  corte em borda de palavra em vários cenários incluindo string sem
  espaço); `tests/wordpress.test.ts` (7 casos, com fake WP via
  `Bun.serve` em porta random — auth headers com token/basic/ambos,
  `testarConexao` caminho feliz e 401, `wpFetch` retry em 503 até 200,
  não-retry em 404); `tests/links.test.ts` (3 casos, com WP mockado —
  caminho feliz 2 pages + 1 post relevantes, pular slugs fracos
  incluindo `sobre` que entrou na lista, zero candidatos → `[]`);
  `tests/docx.test.ts` (3 casos — magic `PK`, HTML vazio, ignora
  `<figure>`). Total geral: **25 pass, 0 fail, 66 expect() em 4.5s**.

**Divergência intencional vs Python (`_SLUGS_EVITAR`):** o Python tem
14 palavras na lista; o TS mantém as 14 do original e acrescenta
`sobre` conforme instrução explícita do briefing da Fase 2 (a lista
requerida pelo enunciado incluía `sobre`, ausente na lista original
do Python). Se a intenção era só copiar 1:1 sem `sobre`, é trivial
remover.

**Divergência intencional (WPListItem):** `descobrirLinks` agora
devolve `LinkInterno { url, title, tipo }` em vez de `list[str]` como
no Python — a tipagem existente do Python era `list[str]` mas a Fase 4
(que vai plugar isso ao Gemini/pipeline) vai precisar do title e do
tipo pra construir prompts melhores. Consumidor pode simplesmente
usar `.url` pra manter o contrato antigo.

**Follow-ups conhecidos:**
- `wordpress.ts` não implementa a atualização de `alt_text` via
  chamada separada dentro do `uploadMidia` — o `publicarPost` faz
  isso via `atualizarMidia`. Mesmo comportamento externo do Python
  (que também fazia POST separado em `/wp-json/wp/v2/media/{id}`).
- Nada foi plugado ao `main.ts`. Rotas `/api/artigos`, `/api/sites`,
  `/api/historico/{id}/docx` etc. entram na Fase 4.
- Sem teste com Gemini real ainda (o briefing sugeriu
  `tests/manual/gemini-compare.ts` como opcional — não implementei
  nesta fase pra não travar; a validação lado-a-lado fica pra Fase 4
  quando a rota estiver ligada).

## Sprint 23 — MCP do Magnific em TypeScript (Fase 3 da migração) — 2026-07-01

Fase mais crítica da migração do Blog: portar o cliente MCP do Magnific de
Python pra TypeScript, resolvendo o RNF-14 (Windows exigia WSL). O SDK
oficial `@modelcontextprotocol/sdk` da Anthropic roda nativo em Mac e
Windows. Nada foi plugado ao `main.ts` — Fase 4 conecta ao pipeline.

- ✅ ✨ **`src/magnific/tokenStorage.ts` — 2026-07-01.** `FileTokenStorage`
  persiste `access_token`/`refresh_token`/`client_info`/`code_verifier` em
  `data/magnific_token.json` **no MESMO formato do Python** (`_FileTokenStorage`
  em `app/magnific_client.py`). Payload tem `tokens` + `client_info` no root.
  Compatibilidade preservada: operador que já tem token do app Python NÃO
  precisa reautorizar no sidecar TypeScript. Escrita atômica (`.tmp` + rename),
  permissão 0600 nos Unix (best-effort no Windows). `load` de arquivo
  ausente ou JSON inválido devolve `null` (não lança) e loga warn.
- ✅ ✨ **`src/magnific/oauth.ts` — 2026-07-01.** Implementação custom da
  interface `OAuthClientProvider` do SDK MCP: expõe `clientMetadata`,
  `clientInformation()`, `saveClientInformation()`, `tokens()/saveTokens()`,
  `codeVerifier()/saveCodeVerifier()` e `redirectToAuthorization()`. Callback
  local: `esperarCallback()` sobe `Bun.serve` em `127.0.0.1:8765/callback`
  (porta hardcoded no Magnific), captura `code`+`state`, devolve HTML de
  confirmação pt-BR, derruba o server. Timeout de 5 min com erro tipado
  (`OAuthTimeoutError`). Porta ocupada vira `CallbackPortInUseError`.
  `openBrowser()` cross-platform: `open`/`cmd /c start`/`xdg-open`.
- ✅ ✨ **`src/magnific/client.ts` — 2026-07-01.** `MagnificClient` de alto
  nível: `ensureAuth()` conecta reutilizando token (nada de browser na 2ª
  vez); em `UnauthorizedError` aguarda callback → `transport.finishAuth(code)`
  → reconecta. `_callTool` faz retry 2× (1s, 3s) em erros transitórios, mas
  NÃO retry em auth (fecha sessão, lança `MagnificAuthRequiredError` pra
  quem chamou). `_parsearConteudo` réplica do Python: (1) blocos JSON puros;
  (2) descarta `<system_reminder>…</system_reminder>`; (3) recorta `{…}` como
  último recurso. API: `listTools`, `accountBalance`, `stockSearch`,
  `stockDownload`, `imagesGenerate`, `creationsWait`, `close`. Logs sempre
  pt-BR e só primeiros 8 chars do token + `…`.
- ✅ ✨ **`src/steps/images.ts` — 2026-07-01.** Portada 1:1 de `steps/images.py`:
  banco primeiro (`stockSearch` + `stockDownload`, ~1 crédito), IA no que
  faltar (`imagesGenerate` + `creationsWait`, ~50 créditos). Otimização com
  `sharp`: `rotate()` (EXIF) → `resize({width:1200, withoutEnlargement:true})`
  → `webp({quality:85})`. Retorna array de `{buffer:ArrayBuffer, filename,
  alt, caption?}` — publicador da Fase 4 sobe direto sem re-ler do disco.
  Escreve tmp em `data/imagens/${jobId}/` só pra debug e **apaga a pasta ao
  fim** (sucesso ou falha, via `try/finally`).
- ✅ ✨ **Testes — 2026-07-01.** `tests/magnific-token-storage.test.ts` (6
  casos: roundtrip com formato Python; `getTokens/setTokens` preservam
  `client_info`; `clear` remove; arquivo ausente → `null`; JSON inválido →
  `null` sem lançar; `clear` idempotente). `tests/images-sharp.test.ts` (4
  casos: PNG 2000x2000 → WebP 1200 com magic `RIFF….WEBP`; imagem 800x600
  não é ampliada; retrato 1200x2000 preserva largura; WebP menor que 2× o
  PNG). Nada de rede/MCP real — sem credencial viva. Smoke manual em
  `tests/manual/magnific-smoke.ts` (rodar com `bun run tests/manual/magnific-smoke.ts`;
  abre browser 1x, imprime saldo e busca "marketing digital"). Suíte
  completa: **35 pass, 0 fail, 90 expect() em 4.77s**.

**Como o OAuth do SDK MCP TypeScript funciona:**
`OAuthClientProvider` é uma **interface** (não classe base). Implementamos
todos os métodos: `redirectUrl`, `clientMetadata`, `clientInformation()`,
`saveClientInformation()`, `tokens()`, `saveTokens()`, `codeVerifier()`,
`saveCodeVerifier()`, `redirectToAuthorization()`, `invalidateCredentials()`.
O `StreamableHTTPClientTransport` recebe o provider e orquestra: (1) usa
tokens salvos; (2) em 401, chama `provider.redirectToAuthorization(url)` e
lança `UnauthorizedError`; (3) o consumidor pega o `code` do callback e
chama `transport.finishAuth(code)`, que troca `code` por tokens via
`exchangeAuthorization` (PKCE). O SDK usa `zod v4` internamente, sem
`openid-client` ou lib externa — tudo do próprio SDK.

**Compatibilidade com o Python:** o formato do token file preserva as
chaves `tokens` e `client_info` no root — se o operador já tem o app
Python instalado com `data/magnific_token.json`, o sidecar TypeScript
usa esse arquivo sem re-login. Testei o roundtrip do `FileTokenStorage`;
não testei o parsing de arquivo REAL do Python porque não temos um em
mãos — mas as chaves e o schema batem 1:1 com `_FileTokenStorage`.

**Riscos residuais (importante ler antes da Fase 4):**
- **Windows não foi testado ainda.** Fluxo de `openBrowser` (`cmd /c start`)
  funciona teoricamente mas o browser em ambiente sem GUI (WSL bare, RDP
  headless) pode não abrir. O sidecar cai no fallback que imprime a URL —
  operador copia manualmente.
- **Porta 8765 hardcoded.** Se algo local estiver segurando essa porta,
  `CallbackPortInUseError` é claro mas o operador precisa liberar. Não
  temos como usar outra porta (Magnific registrou `localhost:8765` no app
  OAuth deles).
- **Discovery state não persistido.** O SDK re-descobre RFC 9728 na cada
  reconexão. Custo: 1 GET a mais no boot da 1ª chamada. Fica pra otimizar
  se virar problema.
- **Nada validado com credencial viva.** O smoke manual precisa rodar pelo
  operador humano (abre browser no 1º uso). Alguns campos podem ter
  formatos diferentes na resposta real do `account_balance` ou
  `stock_search` — o parser é defensivo, mas se algo quebrar, o log em
  `[magnific]` mostra o payload.
- **`sharp` não precisou de `bun pm trust`.** No Bun 1.3.14 atual o sharp
  0.33.5 já vem com libvips prebuilt sem postinstall — testado via WebP
  encode nos testes. Se em máquina nova (arch diferente) exigir build,
  rodar `bun pm trust sharp` conforme briefing original.

## Sprint 24 — Pipeline, Scheduler e endpoints REST completos (Fase 4) — 2026-07-01

Plugou os módulos das Fases 1-3 num pipeline determinístico completo, scheduler
com claim atômico no Supabase, e expôs todas as rotas REST que o React vai
consumir. O sidecar agora é um servidor HTTP funcional de ponta a ponta —
falta só integrar no Tauri (Fase 6) e criar a UI (Fase 7).

- ✅ ✨ **`src/pipeline.ts` — 2026-07-01.** Orquestrador determinístico das 5
  etapas (links → texto → imagens → publicando → historico). Injeção
  explícita de deps (supabase, magnific) — testável com fakes. Emite
  `ProgressoPipeline` via callback em cada transição. RNF-06 respeitado:
  nada pela metade. Falha em qualquer etapa marca `etapa_erro` e retorna
  `status: "falhou"` com mensagem pt-BR. Se `rascunho:true`, status final
  é `"rascunho"` (importante pro scheduler não tratar como falha).
- ✅ ✨ **`src/scheduler.ts` — 2026-07-01.** A cada 60s consulta
  `blog.agendamentos WHERE status='pendente' AND data_programada<=now()`,
  faz **claim atômico** via `UPDATE ... WHERE id=eq.X AND status=eq.pendente`
  (Supabase-JS já usa este filtro; se retornar 0 rows outro sidecar pegou).
  Roda 1× no boot (catch-up de vencidos). Só sobe se
  `SUPABASE_SERVICE_ROLE_KEY` existir — sem ela loga warning e retorna
  stop no-op. Anti-overlap (flag `rodando`) pra não empilhar ticks se o
  processamento demorar > interval.
- ✅ ✨ **`src/magnific/singleton.ts` — 2026-07-01.** Instância única do
  `MagnificClient` compartilhada por rotas e scheduler (a conexão MCP é
  persistente). Lazy init. `closeMagnific()` no shutdown.
- ✅ ✨ **`src/routes/sites.ts` — 2026-07-01.** CRUD `GET/PUT/DELETE
  /api/sites/:id`, `POST /api/sites/:id/testar` (chama `testarConexao` do
  wordpress.ts + atualiza flags), e **`POST /api/conectar` público** que
  recebe form auto-submit do plugin WP v2 e faz upsert via service_role
  (RLS bypass) — página HTML de confirmação com tema TNG marine/orange.
  Token nunca volta pro cliente (sanitizado nas respostas).
- ✅ ✨ **`src/routes/historico.ts` — 2026-07-01.** `GET /api/historico?site_id=`,
  `GET /api/historico/:id/docx` (busca post no WP, gera .docx via `gerarDocxArtigo`,
  retorna com `Content-Disposition: attachment`), `POST /api/historico/:id/publicar`
  (rascunho → publish via WP REST + atualiza histórico).
- ✅ ✨ **`src/routes/config.ts` — 2026-07-01.** `GET/PUT /api/prompt` (arquivo
  atômico), `GET/PUT /api/config/gemini` (chave nunca volta pro cliente, só
  flag `api_key_configurada`), `PUT /api/config/gemini/modelo`,
  `GET /api/config/magnific` (checa existência do `magnific_token.json`),
  `POST /api/config/magnific/conectar` (dispara `ensureAuth`),
  `PUT /api/config/magnific/modelo`.
- ✅ ✨ **`src/routes/artigos.ts` — 2026-07-01.** `POST /api/artigos` — se
  `modo:"agora"` cria N jobs em memória (Map global) e dispara pipeline em
  background (sem await); se `modo:"programar"` insere N rows em
  `blog.agendamentos` espaçadas por `espacamento_dias`.
  `GET /api/artigos/:job_id` retorna progresso do Map. GC a cada 60s
  remove jobs concluídos há > 5 min. **`src/routes/agendamentos.ts`** exporta
  `GET /api/agendamentos?site_id=&status=` e `DELETE /api/agendamentos/:id`
  (só pendentes).
- ✅ ✨ **`src/routes/plugin.ts` — 2026-07-01.** `GET /api/plugin/download` —
  empacota `wp-plugin/tng-blog-connect.php` num .zip mínimo (local file
  header + central directory + EOCD + CRC-32 manual) sem dep externa.
  Compatível com o formato que o Python retorna.
- ✅ ✨ **`src/prompt.ts` + `src/settings.ts` + `prompt_padrao_default.txt` —
  2026-07-01.** Prompt geral persistido em `${DATA_DIR}/prompt_padrao.txt`,
  seed embarcado do template Python. Settings em `settings.json` (chmod 0600
  no Unix): `gemini_api_key`, `gemini_model`, `magnific_modelo_ia`. Nunca
  loggamos os valores.
- ✅ ✨ **`src/main.ts` — 2026-07-01.** Adicionadas rotas públicas (`/api/conectar`,
  `/api/plugin`) ANTES das autenticadas (`/api/sites`, `/api/historico`,
  `/api/config/*`, `/api/prompt`, `/api/artigos`, `/api/agendamentos`).
  Scheduler ligado no boot. Shutdown gracioso agora fecha scheduler +
  Magnific + servidor Hono.
- ✅ 🐛 **Testes granulares removidos — 2026-07-01.** Removidos `docx`,
  `gemini`, `images-sharp`, `links`, `magnific-token-storage` e `wordpress`
  test files a pedido do usuário. Mantido `health.test.ts` (smoke básico)
  e `tests/manual/magnific-smoke.ts` (validação manual).
- ✅ ✨ **Verificação — 2026-07-01.** `bun run typecheck` sem output (zero
  erros). `bun test` → 2 pass, 0 fail, 6 expect() em 615ms.

## Sprint 25 — Bun compile do sidecar + workflow multi-plataforma (Fase 5) — 2026-07-02

Empacotamento do backend TypeScript num binário standalone via `bun build
--compile`. Mac ARM64 rodou local (health OK, `/api/me` sem token = 401 OK,
scheduler adverte quando SUPABASE_SERVICE_ROLE_KEY ausente). Windows e
Mac x64 configurados via GitHub Actions no mesmo workflow do Tauri.

- ✅ ✨ **`package.json` scripts `build:mac`, `build:mac-x64`, `build:win` —
  2026-07-02.** Cada um roda `bun build --compile --minify --external sharp
  --external '@img/*' --target=<plataforma> src/main.ts` e em seguida
  `vendor:sharp`. Binário Mac ARM64 = **62 MB**, vendor ~16 MB, total ~78 MB.
- ✅ ✨ **`scripts/vendor-sharp.ts` — 2026-07-02.** Copia
  `node_modules/{sharp,@img,color,detect-libc,semver}` pra
  `sidecar-vendor/node_modules/`. Cross-platform (usa `fs.cp` do Node, não
  `cp -r`). Roda em Mac e Windows sem shell shim.
- ✅ ✨ **Sharp como import dinâmico opcional — 2026-07-02.** `src/steps/images.ts`
  usa `await import("sharp")` num try/catch (com cache) em vez de `import`
  estático. Se não achar em runtime, loga warning e devolve a imagem crua
  (WordPress ainda gera thumbnails próprios). Isso permite o binário Bun
  compile rodar mesmo se `sidecar-vendor/` não estiver no path — degradação
  graciosa. No modo dev funciona normal. Fase 6 configura o NODE_PATH pelo
  Tauri pra ativar o sharp quando o app real for empacotado.
- ✅ ✨ **`.github/workflows/release.yml` — 2026-07-02.** Adicionados 3 passos
  antes do `tauri-action`: `oven-sh/setup-bun@v1` (1.3.14), `bun install
  --frozen-lockfile` em `blog-backend/` e build do sidecar pra plataforma da
  matrix (macOS ARM/Intel e Windows x64). Binário + `sidecar-vendor/` viram
  inputs pra Fase 6 configurar como `externalBin` do Tauri.
- ✅ ✨ **`sidecar-vendor/` no `.gitignore` — 2026-07-02.** Build artifact,
  não vai no repo. `bun.lock` (text format Bun 1.3) COMMITADO pra o
  `--frozen-lockfile` do CI funcionar; `bun.lockb` continua bloqueado.
- ✅ ✨ **Verificação — 2026-07-02.** `bun run typecheck` sem erros. Binário
  Mac local: `./tng-blog-sidecar` sobe em ~1s, `/api/health` → 200 com
  `{status:"ok", version:"0.2.0"}`, `/api/me` sem token → 401 com pt-BR,
  scheduler loga warning e não sobe (correto pra ambiente sem service key).

## Sprint 26 — Integração sidecar no Tauri (Fase 6) — 2026-07-02

Sidecar do Blog agora sobe on-demand quando o React chama
`invoke("blog_sidecar_start_lazy", { supabase_url, supabase_anon_key })` — só
na 1ª vez que o botão Blog é clicado. Kill automático no shutdown do app.

- ✅ ✨ **`src-tauri/Cargo.toml` — 2026-07-02.** Adicionada
  `tauri-plugin-shell = "2"`.
- ✅ ✨ **`src-tauri/tauri.conf.json` — 2026-07-02.** `bundle.externalBin` =
  `["../blog-backend/tng-blog-sidecar"]` (Tauri busca com sufixo do target
  triple automaticamente). `bundle.resources` = `["../blog-backend/sidecar-vendor"]`
  — vai pro `resource_dir` do app empacotado.
- ✅ ✨ **`src-tauri/capabilities/default.json` — 2026-07-02.** Nova permissão
  scoped `shell:allow-execute` que só permite executar o binário
  `tng-blog-sidecar` como sidecar (não deixa executar qualquer comando).
  Também `shell:allow-kill` pra o shutdown poder matar o processo.
- ✅ ✨ **`src-tauri/src/blog_sidecar.rs` — 2026-07-02.** Módulo Rust novo
  com `BlogSidecarState` (Mutex<Option<CommandChild>> + porta), commands
  `blog_sidecar_start_lazy(args)` (idempotente) e `blog_sidecar_status()`,
  e `kill_sidecar(&state)`. Env vars passadas: `SUPABASE_URL` +
  `SUPABASE_ANON_KEY` (do React), `SUPABASE_SERVICE_ROLE_KEY` (do
  `std::env::var`, NUNCA do frontend — segredo do sidecar), `PORT` (default
  8000), `NODE_PATH` (aponta pro `resource_dir/sidecar-vendor/node_modules`
  pra o Sharp ser resolvido em runtime).
- ✅ ✨ **`src-tauri/src/lib.rs` — 2026-07-02.** `.plugin(tauri_plugin_shell::init())`,
  `.manage(BlogSidecarState::new())`, 2 commands adicionados ao
  `invoke_handler`. `.build().run(|handle, event| ...)` substituiu
  `.run(context)` para poder tratar `RunEvent::ExitRequested` — dispara
  `kill_sidecar` antes de encerrar o app (evita zombie).
- ✅ ✨ **`blog-backend/package.json` — 2026-07-02.** Scripts `build:*`
  agora geram binário com sufixo de target triple que o Tauri espera:
  `tng-blog-sidecar-aarch64-apple-darwin`,
  `tng-blog-sidecar-x86_64-apple-darwin`,
  `tng-blog-sidecar-x86_64-pc-windows-msvc.exe`.
- ✅ ✨ **Verificação — 2026-07-02.** `cargo check --release` completa em
  ~8s. 7 warnings (todas pré-existentes do `objc` crate, não introduzidas
  aqui). Binário Mac ARM64 gerado com o nome correto.

## Sprint 27 — UI React do Blog (Fase 7) — 2026-07-02

Camada visual completa em React seguindo padrão do `SettingsPanel`:
`BlogPanel` overlay tela cheia z-40 com sidebar de 5 abas + 5 telas. Botão
"Blog" no header do Dashboard entre a busca ⌘K e a engrenagem. **App
principal não teve nenhuma lógica alterada** — só adição de estado
`blogOpen`, handler `handleOpenBlog`, botão e `<BlogPanel/>` no JSX.

- ✅ ✨ **`src/types/blog.ts` — 2026-07-02.** Tipos `BlogSite`,
  `BlogHistoricoItem`, `BlogAgendamento`, `BlogProgresso`, `BlogJob`.
- ✅ ✨ **`src/lib/blogClient.ts` — 2026-07-02.** `blogFetch<T>(path, init)`
  injeta `X-Supabase-Token` do `supabase.auth.getSession()`. `setBlogPort()`
  guarda a porta que o sidecar retornou (fallback 8000..8010). `poll()`
  utilitário pra polling de jobs.
- ✅ ✨ **`src/components/blog/BlogPanel.tsx` — 2026-07-02.** Overlay z-40 com
  header (ícone `fa-newspaper` + título Blog + botão X), sidebar 5 abas
  (Novo artigo, Programação, Sites, Histórico, Configurações), corpo à
  direita renderiza view ativa. ESC fecha.
- ✅ ✨ **5 views em `src/components/blog/views/` — 2026-07-02.**
  `NovoArtigoView` (select site + textarea multi-keyword + radios
  agora/programar + publicar/rascunho + polling dos jobs), `ProgramacaoView`
  (auto-refresh 5s, filtro por status colorido), `SitesView` (cards com
  badges + testar + modal prompt por site + baixar plugin .zip),
  `HistoricoView` (filtro por site + publicar rascunho + baixar .docx +
  abrir post), `ConfigView` (prompt geral + Gemini + Magnific).
- ✅ ✨ **`src/screens/DashboardScreen.tsx` — 2026-07-02.** ADIÇÃO PURA:
  imports (`invoke`, `BlogPanel`, `setBlogPort`), estado `blogOpen` +
  `blogStarting`, handler `handleOpenBlog` que chama
  `invoke("blog_sidecar_start_lazy", { args: {...} })`, seta porta,
  aguarda health responder (20× 200ms) e abre painel. Botão "Blog" no
  header + `<BlogPanel/>` no JSX. **Nenhuma lógica existente removida ou
  modificada.**
- ✅ ✨ **Verificação — 2026-07-02.** `npx tsc --noEmit` zero erros.

## Sprint 28 — Migration blog.ai_usage + bump v0.2.0 (Fase 8) — 2026-07-02

Tabela separada `blog.ai_usage` no Supabase pra rastrear consumo do Gemini
pelo Blog — **não polui o painel "Uso da IA" do app principal**. Card novo
dentro do painel Blog mostra o consumo mensal. Bump v0.1.11 → **v0.2.0**
sinaliza a feature grande da Release.

- ✅ ✨ **`supabase/migrations/20260702000001_blog_ai_usage.sql` —
  2026-07-02.** Cria `blog.ai_usage` (id, user_id → auth.users, site_id →
  blog.sites, job_id, modelo, input_tokens, output_tokens, total_tokens
  GENERATED ALWAYS AS STORED, custo_estimado, created_at). RLS: select por
  authenticated (equipe compartilha), insert own (user_id = auth.uid()).
  Índice em `created_at desc` e `(user_id, created_at desc)`. Adicionada
  ao `supabase_realtime` publication.
- ✅ ✨ **`blog-backend/src/steps/gemini.ts` — 2026-07-02.** `ArtigoGerado`
  ganha campo opcional `usage: { modelo, input_tokens, output_tokens }`.
  Extrai de `resp.usageMetadata` (fallback 0 se ausente). Nunca logga a
  chave, só os counts.
- ✅ ✨ **`blog-backend/src/pipeline.ts` — 2026-07-02.** Após etapa "texto"
  ok, chama `_registrarUso` (INSERT best-effort em `blog.ai_usage`).
  **Erro aqui não derruba o pipeline** — o rastreio é acessório.
- ✅ ✨ **`blog-backend/src/routes/config.ts` — 2026-07-02.** Nova rota
  `GET /api/config/ai-usage` — agrega tokens do mês corrente em
  `{ mes_atual: { input_tokens, output_tokens, total_tokens,
  artigos_gerados, por_modelo } }`.
- ✅ ✨ **`src/components/blog/views/ConfigView.tsx` — 2026-07-02.** Card
  "Uso da IA do Blog" no topo com 4 stats (Artigos, Tokens entrada, Tokens
  saída, Total). Componente `<Stat>` com `.toLocaleString("pt-BR")` pros
  números formatados.
- ✅ ✨ **Bump v0.1.11 → v0.2.0 — 2026-07-02.** `package.json`,
  `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`. Feature grande
  (integração do Blog) justifica minor bump — Sprints 18-20 foram patch
  bumps.
- ✅ ✨ **Verificação — 2026-07-02.** `npx tsc --noEmit` zero erros no
  frontend, `bun run typecheck` zero erros no backend, `bun test` mantém
  2/2 pass.

**Pendente do usuário pra Release final:**
- Aplicar migration `20260702000001_blog_ai_usage.sql` no Supabase.
- Criar tag `v0.2.0` no GitHub — dispara o workflow `release.yml` que
  builda o sidecar em Mac ARM64/x64 e Windows x64 e empacota tudo.
- Testar o executável Mac local antes do release (rodar via `npm run tauri dev`
  e verificar que o botão Blog abre o painel).

## Sprint 29 — Correções críticas do code review (Fase 9) — 2026-07-02

Code review Opus 4.8 encontrou 15 defeitos na migração. Os 6 críticos que
quebravam o painel Blog em produção foram corrigidos aqui; os 9 restantes
(alto/médio) ficam documentados na seção "Riscos residuais" abaixo para
serem atacados numa Sprint 30 antes do release público.

- ✅ 🐛 **Fix envelope de resposta — 2026-07-02.** Backend retorna
  `{ sites: [...] }`, `{ historico: [...] }`, `{ agendamentos: [...] }`
  mas os 5 views chamavam `blogFetch<BlogSite[]>` e faziam `.filter/.map`
  direto — `TypeError: data.filter is not a function` → tela em branco.
  Ajustado no front (`NovoArtigoView`, `HistoricoView`, `SitesView`,
  `ProgramacaoView`) pra desestruturar `.sites/.historico/.agendamentos`.
- ✅ 🐛 **Download `.docx` com auth — 2026-07-02.** `<a href={docxUrl}>`
  fazia GET sem `X-Supabase-Token` → 401 em todo download. Novo helper
  `blogFetchBlob(path)` em `src/lib/blogClient.ts` faz fetch autenticado
  + `URL.createObjectURL(blob)` + `<a download>` sintético.
  `HistoricoView` chama via `<button onClick>`.
- ✅ 🐛 **Publicar rascunho não corrompe lista — 2026-07-02.** Backend
  retorna `{ok:true}` mas front tentava `setItens(prev.map(h.id===id ? next : h))`,
  transformando item em `{ok:true}` que sumia do filtro. Trocado por
  `await carregar()` — reload da lista após publish.
- ✅ 🐛 **`PUT /api/config/magnific/modelo` corrigido — 2026-07-02.**
  `MagnificCard` enviava `{ modelo_ia: ... }` mas backend só aceita
  `{ modelo: ... }` (retornava 400 sempre). Trocado no `ConfigView.tsx`.
- ✅ 🐛 **CORS libera 5173 (Vite dev) — 2026-07-02.** `blog-backend/src/main.ts`
  só tinha `1420` (template padrão Tauri) — mas este projeto roda Vite
  em `5173` (ver `vite.config.ts`). Todas as chamadas do painel Blog em
  `npm run tauri dev` batiam em CORS error. Adicionados `http://localhost:5173`
  e `http://127.0.0.1:5173`.
- ✅ 🐛 **Rust lê porta efetiva do sidecar — 2026-07-02.** `blog_sidecar.rs`
  retornava `port: desired_port` — mas o sidecar tem fallback 8000→8010
  se a porta desejada está ocupada. Consequência: outro app usando 8000
  faria o painel bater em endpoint fantasma. Agora o handler de stdout
  parseia `"rodando em http://127.0.0.1:XXXX"` e envia via
  `tokio::sync::oneshot`. `blog_sidecar_start_lazy` faz
  `timeout(Duration::from_secs(8), rx_porta).await` antes de responder.
  Nova dep `tokio = { features = ["sync", "time"] }` no `Cargo.toml`.
- ✅ ✨ **Verificação final — 2026-07-02.** Frontend `tsc --noEmit`
  zero erros. Backend `bun run typecheck` zero erros, `bun test` 2/2 pass.
  Rust `cargo check --release` OK (só warnings pré-existentes do `objc`).
  Binário Mac ARM64 v0.2.0 rebuild = 62 MB + `sidecar-vendor` 16 MB.

### Riscos residuais (Sprint 30 pré-release público)

Findings do code review NÃO corrigidos aqui. Nada bloqueia deployment
interno, mas devem ser atacados antes do release público:

- **[ALTO] `SUPABASE_SERVICE_ROLE_KEY` só via env do Tauri.** Em `.dmg`/`.msi`
  distribuído, essa var estará vazia → scheduler não sobe e `/api/conectar`
  do plugin WP sempre retorna 503 (fluxo de onboarding quebra silenciosamente).
  Decisão: (a) documentar exportação da var pra admin, ou (b) mudar
  `/api/conectar` pra fluxo autenticado (usuário loga no app antes do
  botão "Conectar" no WP).
- **[ALTO] `NovoArtigoView` vaza `setInterval`** — cada job cria um
  interval que continua polling depois do painel Blog fechar. Guardar
  handles em `Map<jobId, NodeJS.Timeout>` num `ref` e `clearInterval` no
  cleanup do `useEffect`.
- **[ALTO] `JOBS` global sem limite** em `routes/artigos.ts` — usuário
  colar lista de 5000 keywords cria 5000 pipelines paralelos. Adicionar
  fila com `concurrency: 2` (ex.: `p-queue`) + validação server-side
  `keywords.length <= 20`.
- **[ALTO] Race em `FileTokenStorage`** (Magnific OAuth) — `setTokens` +
  `setClientInfo` + `setCodeVerifier` chamados em paralelo pelo SDK MCP
  podem se sobrescrever. Adicionar mutex (`async-mutex` ou Promise chain).
- **[ALTO] Scheduler sem reclaim de "executando" órfão** — se sidecar
  crashar no meio de um artigo, agendamento fica `status='executando'`
  pra sempre. Adicionar ciclo prévio ao claim que volta pra `pendente`
  qualquer coisa com `updated_at < now() - interval '10 minutes'`.
- **[ALTO] Sem timeout no MCP Magnific** — `_callTool` pode ficar
  pendurado se o servidor demora. Envelopar em `Promise.race` + 60s.
- **[MÉDIO] CSRF em `POST /api/conectar`** — qualquer processo no
  localhost pode envenenar `blog.sites`. Checar `Origin`/`Referer` +
  rate limit + bootstrap token curto TTL embutido no zip do plugin.
- **[MÉDIO] Shutdown com `void closeMagnific()`** — não aguarda.
  Trocar por `async encerrar() { await closeMagnific(); await server.stop(false); }`.
- ~~**[MÉDIO] `blog_sidecar_start_lazy` não detecta child morto**~~ —
  resolvido na Sprint 30 (health-check TCP + limpeza no `Terminated`).

## Sprint 31 — Bugs pós-produção + reorg do painel Blog — 2026-07-04

Usuário testou de novo: imagens do Magnific voltaram (fix da Sprint 30
pegou), Gemini + RankMath preencheram tudo. Mas apareceram 2 bugs
adicionais e 4 pedidos de feature no painel. Tudo entregue nesta sprint.
Zero mudanças no app principal (mantém a política de escopo).

- ✅ 🐛 **"Abrir post" no Histórico dava `shell.open not allowed` — 2026-07-04.**
  Botão usava `<a href={url} target="_blank">`, que o Tauri intercepta e
  redireciona pro comando `shell:open` (não permitido nas capabilities).
  Fix: trocado por `<button onClick={() => openUrl(url)}>` do
  `@tauri-apps/plugin-opener` — a capability `opener:default` já está
  concedida no `default.json`. Aplicado em `HistoricoView`, `ProgramacaoView`
  e no card de progresso do `NovoArtigoView`. Nada mexido em capabilities.
- ✅ 🐛 **Publicar rascunho dizia OK mas o post continuava draft — 2026-07-04.**
  `routes/historico.ts::/publicar` chamava `wpFetch` com
  `body: JSON.stringify({status:"publish"})` — sem `Content-Type:
  application/json`, o WP não parseava o body e mantinha o status.
  Trocado por `json: { status: "publish" }` (mesmo caminho que
  `criarPost` já usa). Bug simples com sintoma silencioso.
- ✅ 🐛 **`window.confirm` no `ProgramacaoView.cancelar()` — 2026-07-04.**
  Mesmo caso do `ConfigView` na Sprint 30: `dialog.confirm not allowed`
  quando cancelar agendamento. Trocado por confirmação inline em 2 cliques
  (4s de timeout), igual ao padrão da `SitesView`.
- ✅ ✨ **Novo artigo em 2 colunas com busca de site — 2026-07-04.**
  O `<select>` de sites virava um problema conforme a lista cresce (o
  usuário previu chegar a dezenas). Reformulado em 2 colunas: à esquerda,
  aside 280px com busca instantânea + lista alfabética de sites clicáveis
  (destaque no selecionado); à direita, form com cabeçalho mostrando o
  site selecionado + keywords + modo + status. Padrão inicial agora é
  **Rascunho** (feedback: "quase todo blog revisa antes de publicar").
- ✅ ✨ **Sites com busca + drawer por site — 2026-07-04.**
  Card de cada site agora abre um drawer lateral (max-w-3xl, alinhado à
  direita) com abas "Programação" e "Histórico" filtradas pelo site em
  questão — muito mais escalável que ver tudo misturado em abas globais.
  Ações (Testar/Prompt/Editar/Remover) migraram do card pro cabeçalho do
  drawer, deixando o card mais limpo. Contador no canto do card:
  `X/Y pub/total` mostrando publicações vs total (pub+pendente). Badge
  extra em azul quando há agendamentos pendentes. Campo de busca no topo
  do painel Sites. `ProgramacaoView` e `HistoricoView` receberam prop
  `fixedSiteId?: string` — quando presente, filtram + escondem o seletor
  global; reuso puro sem duplicar código.
- ✅ ✨ **Reorg do menu lateral — 2026-07-04.**
  Menu principal do BlogPanel virou: **Novo artigo** · **Sites** ·
  **Prompt** · **Uso de IA** · **Notificações** · **Configurações**.
  Programação e Histórico saíram do menu (agora vivem dentro do drawer de
  cada site). Prompt e Uso de IA eram cards do ConfigView e viraram tabs
  próprias — `PromptView.tsx` e `UsoIAView.tsx` novos. ConfigView ficou
  só com credenciais Gemini + Magnific (fica ~50% mais curto e mais
  fácil de escanear).
- ✅ ✨ **Notificações persistentes (novo módulo) — 2026-07-04.**
  Motivação: scheduler roda em background; se um agendamento falhar
  quando ninguém está com o painel aberto, o evento precisa persistir.
  Toast só cobre o "aqui e agora" — tabela cobre o "depois". Entregas:
  - **DB**: migration `20260704000001_blog_notificacoes.sql` cria
    `blog.notificacoes` com colunas `tipo` (info|success|warning|error),
    `titulo`, `mensagem`, `contexto jsonb`, `lida`, FKs opcionais
    (`site_id`, `job_id`, `agendamento_id`), RLS com policies `select/
    insert/update/delete` restritas ao dono (`user_id = auth.uid()`).
    Índice parcial em `(user_id, lida) WHERE lida=false` pra badge do
    contador ficar barato. Publicação em `supabase_realtime` pra
    subscribe futuro.
    ⚠️ **Precisa ser aplicada** — rode `supabase db push` ou aplique
    manualmente no dashboard.
  - **Backend**: novo `routes/notificacoes.ts` com endpoints
    `GET /` (lista, `?nao_lidas=1` filtra),
    `GET /nao-lidas/count` (só o número, pro badge),
    `POST /:id/lida`, `POST /lidas`, `DELETE /:id`, `DELETE /lidas`.
    `scheduler.ts` insere notificação após cada agendamento (sucesso
    ou falha, com link do post no `contexto`). `routes/artigos.ts`
    (modo "agora") insere notificação ao final de cada job em
    background. Ambos usam try/catch envelope — falha na notificação
    nunca quebra o pipeline.
  - **Frontend**: novo `NotificacoesView.tsx` (lista + filtro "só não
    lidas" + marcar individual/todas + limpar lidas + polling 15s +
    "Abrir post" via plugin-opener). Novo item "Notificações" no menu
    lateral com badge laranja mostrando não lidas — `BlogPanel` faz
    polling de `/api/notificacoes/nao-lidas/count` a cada 20s e ao
    trocar de aba. Tipo `BlogNotificacao` no `src/types/blog.ts`.
- ✅ ✨ **Verificação — 2026-07-04.** `bunx tsc --noEmit` backend: exit 0.
  `npx tsc --noEmit` frontend: exit 0. Binário Mac ARM64 rebuild
  (`bun run build:mac`) → copiado pra `src-tauri/target/debug/tng-blog-sidecar`
  → sidecar antigo morto. Próxima abertura do painel Blog usa o binário
  novo (health-check TCP da Sprint 30 detecta a porta caída e respawna).
  Restou aplicar a migration `20260704000001_blog_notificacoes.sql` no
  Supabase — sem ela o `NotificacoesView` responde 500 e o badge fica
  em 0 permanente. Não afeta o resto do painel.
- ✅ 🐛 **Novo artigo travado em 1 coluna — CSS arbitrário inválido — 2026-07-08.**
  Causa real (a hipótese do breakpoint em 2026-07-06 estava errada): a
  classe `grid-cols-[260px,1fr]` gera `grid-template-columns: 260px,1fr`,
  que é CSS **inválido** — as trilhas do grid são separadas por espaço, não
  vírgula. E no valor arbitrário do Tailwind o espaço se escreve com `_`.
  O browser descartava a declaração inválida e sobrava o `grid-cols-1` →
  1 coluna. Valia pro `lg:` original E pro `md:` — nunca funcionou.
  Fix: `grid-cols-[260px_1fr]` (underscore) e removido o breakpoint de vez
  (é app desktop, não precisa de media query). Só frontend — Tauri dev
  faz hot-reload, sem rebuild de sidecar.
- ✅ ⚡ **Sites carregava em 3-5s — 2026-07-06.**
  `SitesView` chamava `/api/sites` + `/api/agendamentos` (payload inteiro)
  + `/api/historico` (payload inteiro) só pra montar o badge `X/Y pub/total`.
  Com dezenas de artigos publicados a serialização + transporte custava
  3.5s no meu próprio ambiente (logs do usuário: `GET /api/historico 5426ms`).
  Novo endpoint `GET /api/sites/summary` faz o `Promise.all` no sidecar
  com `select("site_id")` filtrado por status — projeção mínima. Frontend
  passou a fazer 1 chamada só. Bônus: os 3 payloads separados sumiram
  do log (menos requests concorrentes na abertura). Não removi
  `/api/agendamentos` e `/api/historico` porque `ProgramacaoView` e
  `HistoricoView` ainda usam com filtro por site dentro do drawer.
- ✅ 🐛 **App "abrindo e fechando" durante a geração — CRÍTICO — 2026-07-08.**
  Root cause achado no log do usuário: `Info File src-tauri/data/imagens/
  job-… changed. Rebuilding application...`. O sidecar grava as imagens
  baixadas do Magnific em `${DATA_DIR}/imagens/` — e `DATA_DIR` default é
  `./data`, que em dev resolve pra `src-tauri/data` (cwd do sidecar). O
  watcher do `tauri dev` vigia `src-tauri/` inteiro, então CADA imagem
  baixada disparava rebuild+restart do app, matando o pipeline no meio e
  (às vezes) deixando o app num estado que não reabria. O mesmo valia pro
  `magnific_token.json` e `settings.json` mudando.
  Fix: `src-tauri/.taurignore` (sintaxe .gitignore, só afeta dev) ignorando
  `data/`. Só vale a partir do próximo start do `tauri dev` — como o app já
  tinha crashado, o usuário reinicia de qualquer forma. Não afeta release
  (não há watcher em produção).
- ✅ 🐛 **Scheduler DESLIGADO → agendamentos nunca executavam — 2026-07-08.**
  Log: `[scheduler] SUPABASE_SERVICE_ROLE_KEY ausente. Scheduler DESLIGADO`.
  A chave `service_role` (que liga o scheduler) vinha só de
  `std::env::var` no `blog_sidecar.rs`, e o usuário roda `npm run tauri dev`
  sem exportá-la → vazia → scheduler off → os 3 posts programados ficaram
  todos `pendente` (inclusive o 1º, que tem `data_programada = now` e só é
  publicado quando o scheduler roda o claim `status=pendente AND
  data_programada<=now()` a cada 60s).
  Descoberta chave (testada com o binário): o sidecar Bun compilado
  **auto-carrega `.env` do cwd**. MAS o `blog_sidecar.rs` passava
  `SUPABASE_SERVICE_ROLE_KEY=""` explícito, e variável de processo SOMBREIA
  o `.env` no Bun → continuava off. Fix: `blog_sidecar.rs` só injeta a
  variável quando ela é **não-vazia**; ausente, o Bun preenche do
  `src-tauri/.env` (dev). Adicionado `.env*` ao `src-tauri/.gitignore`
  (repo público — a chave nunca pode vazar). Ação do usuário: criar
  `src-tauri/.env` com `SUPABASE_SERVICE_ROLE_KEY=...`. ⚠️ Produção: a
  distribuição pra equipe ainda precisa definir como a chave chega ao
  sidecar sem embutir no binário (questão em aberto — repo público).
- ✅ ✨ **Novo artigo: colunas 40/60 + progresso no topo — 2026-07-08.**
  Coluna do site alargada pra ~40% via `grid-cols-[minmax(0,2fr)_
  minmax(0,3fr)]` (o `minmax(0,…)` impede URL longa de estourar a trilha).
  Card "Em processamento" (jobs "agora") movido do rodapé pro topo do
  painel — antes passava despercebido lá embaixo.
- ✅ ✨ **Toasts flutuantes (topo direito) — 2026-07-08.**
  Faltava a parte "flutuante" da feature 8 (só tinha o drawer/badge
  persistente). Entregue: `src/lib/toast.ts` (event bus a nível de módulo,
  sem Provider — dá pra disparar `showToast()` de qualquer lugar) +
  `ToastHost.tsx` (pilha no topo direito, `z-[60]` acima de painel/drawers,
  auto-descarte 6s, botão "Abrir post", cor por tipo). Montado 1x no
  `BlogPanel`. Fontes de toast: (1) `NovoArtigoView` toasta na hora quando
  um job "agora" conclui/falha; (2) o poller do `BlogPanel` toasta eventos
  do SCHEDULER (notificações com `agendamento_id != null`) — assim o
  usuário vê "2º post falhou: <motivo>" mesmo sem estar olhando. Guarda
  `primed` evita vomitar o backlog de não-lidas ao abrir o painel; `vistos`
  Set evita re-toastar. Jobs "agora" (agendamento_id nulo) não duplicam
  porque o poller só toasta os de scheduler.
- ✅ ✨ **Verificação — 2026-07-08.** `npx tsc --noEmit` frontend: exit 0.
  `cargo check --lib` src-tauri: ok (só warnings objc pré-existentes).
  Sem rebuild de sidecar (nada em `blog-backend/src` mudou neste turno).
  Rust recompila no `tauri dev`; frontend hot-reload; `.taurignore` vale
  no próximo start.
- ✅ 🐛 **Scheduler "ligado" que nunca executava — claim quebrado — CRÍTICO — 2026-07-09.**
  Mesmo com a service key ok (usuário criou `src-tauri/.env` certinho), o
  1º agendamento vencido continuou `pendente`. Diagnóstico por camadas:
  query do scheduler reproduzida via curl E via supabase-js retornava a
  row → o problema estava DEPOIS. Era o `_reivindicar`: o UPDATE gravava
  `executando_por: "sidecar-${hostname}-${pid}"`, mas a coluna é **uuid
  com FK pra `auth.users`** (herança do app Python, que gravava o usuário
  da sessão). Erro `22P02 invalid input syntax for type uuid` em TODO
  claim — e `_reivindicar` retornava `false` SEM LOGAR, então parecia
  "outro sidecar pegou". Trocar por `crypto.randomUUID()` só mudou o erro
  pra `23503 violates foreign key` (segunda camada!). Fix definitivo: o
  claim NÃO grava mais `executando_por` — a atomicidade vem do filtro
  `.eq("status","pendente")` no UPDATE condicional, a coluna era só
  informativa. E `_reivindicar` agora LOGA o erro (o silêncio escondeu o
  bug por dias). Testado end-to-end: sidecar novo fez o claim e executou
  o pipeline do agendamento real na hora.
- ✅ ✨ **`/api/health` expõe `scheduler: boolean` + aviso no painel — 2026-07-09.**
  `iniciarAgendador` retorna `ativo` no handle; health devolve. A
  `ProgramacaoView` sonda 1x e mostra banner âmbar "Agendador desligado
  neste computador" quando `false` — antes o operador programava posts
  que nunca rodariam e só descobria dias depois.
- ✅ 🐛 **"Baixar .docx" não fazia nada — 2026-07-09.**
  O fluxo era fetch autenticado → blob URL → `<a download>` + `click()`.
  O WKWebView do macOS IGNORA silenciosamente cliques em
  `<a download href="blob:">` (não há handler de download no webview) —
  por isso nem console logava. Fix: `save()` do `@tauri-apps/plugin-dialog`
  (capability `dialog:default` já inclui `allow-save`) + novo comando Rust
  `write_file_bytes(path, bytes)` no `lib.rs` (padrão do `read_file_bytes`
  existente) grava o blob no destino escolhido. Toast de sucesso com o
  caminho salvo. Spinner "Gerando…" no botão.
- ✅ ✨ **Programação só mostra o que está programado — 2026-07-09.**
  `concluido` some da lista (vive no Histórico). Ficam: pendente
  (relabel "Agendado", badge azul), executando e falhou (com motivo).
- ✅ ✨ **Data/hora como badge destacado — 2026-07-09.**
  Programação e Histórico mostram a data num badge próprio (borda +
  fundo escuro + texto laranja + ícone relógio/calendário) em vez de
  texto cinza pequeno — era a informação mais importante do card.
- ✅ ✨ **Excluir em Programação e Histórico — 2026-07-09.**
  Programação: "Cancelar" (pendente) / "Excluir" (falhou) — backend
  `DELETE /api/agendamentos/:id` agora aceita `.neq("status","executando")`
  em vez de só pendente. Histórico: novo `DELETE /api/historico/:id`
  (apaga só o REGISTRO do painel; o post no WordPress fica — caso de uso:
  publicou no site errado por falha humana, apaga lá e limpa aqui).
  Ambos com confirmação inline em 2 cliques (padrão do projeto).
- ✅ ✨ **Progresso de geração flutuante no topo direito — 2026-07-09.**
  O bloco "Em processamento" do NovoArtigoView virou overlay
  `fixed right-4 top-16 z-[55]` (abaixo dos toasts em top-4/z-60), com
  cards de bg sólido + shadow. Não empurra mais o layout do form.
- ✅ ✨ **Toast "Agendamento criado" com atalho pra programação — 2026-07-09.**
  Ao programar, em vez do aviso estático embaixo do form, sobe toast de
  sucesso com botão "Ver programação" que navega direto: aba Sites →
  drawer do site → aba Programação. Infra nova: `src/lib/blogNav.ts`
  (bus de navegação, mesmo padrão do bus de toast), `BlogPanel` assina e
  repassa `drawerRequest` pro `SitesView` (novo par de props), `SiteDrawer`
  ganhou `initialTab`. Toast ganhou campo `acao?: {label, onClick}` e o
  `ToastHost` renderiza o botão (fecha o toast ao clicar).
- ✅ 🐛 **Retry no INSERT do histórico (falha parcial) — 2026-07-09.**
  No smoke test end-to-end, o pipeline publicou o post no WP mas o INSERT
  em `blog.historico` falhou com "socket connection was closed
  unexpectedly" — a conexão HTTP reusada pelo supabase-js morreu durante
  os MINUTOS de upload de imagens. Resultado enganoso: agendamento
  "falhou" com post publicado e histórico sem a linha. Fixes:
  `_registrarHistorico` agora tenta 3× com backoff (0s/2s/4s, cobrindo
  erro do PostgREST E rejeição de socket do fetch); e o scheduler grava
  `post_url` também no patch de FALHA — falha parcial mostra o link do
  post no card.
  ⚠️ Estado residual desse teste: agendamento "O que é GEO e SEO?"
  (300683e2…) está `falhou` no banco, mas o post EXISTE como draft no WP
  (`o-que-e-geo-e-seo` em teste.tngdigital.com.br). Reparo manual do
  registro foi barrado por permissão — pendente de decisão do usuário
  (ou simplesmente excluir o card de falha pelo painel).
- ✅ ✨ **Verificação — 2026-07-09.** Frontend `npx tsc --noEmit` exit 0;
  backend `bunx tsc --noEmit` exit 0; `cargo check --lib` exit 0. Sidecar
  rebuild 2× + copiado pra `target/debug` + processos antigos mortos.
  Smoke test real: binário novo fez claim do agendamento pendente,
  executou o pipeline completo e o post chegou no WordPress como draft
  (rascunho=true) — fix do scheduler confirmado end-to-end. Restam 2
  agendamentos pendentes (10/07 e 11/07) que agora rodarão sozinhos.
  Usuário confirmou: 1º artigo agendado publicou certinho.
- ✅ ✨ **Histórico: excluir vira ícone + ações na mesma linha — 2026-07-09.**
  Card reorganizado (pedido do usuário): lixeira só-ícone no canto
  superior direito (confirmação 2 cliques vira ícone de alerta; tooltip
  explica que o post no WP não é apagado); Publicar → Baixar .docx →
  Abrir post agora ficam juntos numa linha no rodapé do card, nessa ordem.
  "Abrir post" ganhou borda pra alinhar visualmente com os vizinhos.
- ✅ ✨ **Uso de IA virou dashboard com filtros — 2026-07-09.**
  Backend: `GET /api/config/ai-usage?periodo=hoje|7d|30d|mes|tudo`
  (default `mes`) devolve `{periodo, inicio, totais {input, output,
  total, execucoes, custo_estimado}, por_modelo[] (in/out/total/execuções
  por modelo), execucoes[]}` — as execuções individuais (id, modelo,
  tokens, custo, site_id, job_id, created_at), até 200 mais recentes.
  Shape antigo `{mes_atual}` descontinuado (único consumidor era o
  próprio UsoIAView). Frontend: chips de período, stats agregados (card
  de custo só aparece quando `custo_estimado > 0`), tabela "Por modelo"
  (execuções/entrada/saída/total) e tabela "Execuções" com data/hora,
  modelo, site resolvido via `/api/sites`, tokens — com select de filtro
  por modelo (client-side). Espelha o espírito do painel de IA do app
  principal sem tocá-lo.
- ✅ ✨ **Config: status como badge sólido no topo dos cards — 2026-07-09.**
  Novo `StatusBadge` em `ConfigView`: pill com FUNDO verde sólido
  (`bg-emerald-500` + texto escuro) quando ok, vermelho sólido quando não
  conectado/sem chave, cinza "Verificando…" enquanto carrega. Renderizado
  ACIMA do título de cada card (prop `badge` no `Section`) — primeira
  coisa visível ao abrir Configurações. Status inline antigo (texto
  verde/âmbar no corpo) removido dos dois cards.
- ✅ ✨ **Verificação (rodada UI/UX) — 2026-07-09.** Frontend e backend
  `tsc --noEmit` exit 0. Sidecar rebuild (mudou `routes/config.ts`) +
  copiado pra `target/debug` + processo antigo morto — reabrir o painel
  Blog respawna o novo.
- ✅ 🐛 **"Baixar plugin WP" dava "Plugin não encontrado no sidecar" — 2026-07-09.**
  `routes/plugin.ts` lia `wp-plugin/tng-blog-connect.php` do disco via
  `import.meta.url`/`process.cwd()`. Funciona em dev (`bun run`), mas o
  binário `bun build --compile` não tem `wp-plugin/` ao lado e o
  `import.meta.url` aponta pro filesystem virtual `/$bunfs/` → todos os
  paths falhavam → 500. (Mesma classe do bug do sharp, resolvido com
  vendor.) Fix: EMBUTIR o .php no bundle em build time via import de texto
  do Bun — `import pluginPhp from "../../wp-plugin/tng-blog-connect.php"
  with { type: "text" }`. Vira string constante dentro do binário; zero
  I/O de disco no runtime. Removido todo o `_localizarPlugin()`. Tipo do
  import declarado em `src/php-modules.d.ts` (`declare module "*.php"`).
  Verificado end-to-end: binário rodado de um cwd SEM `wp-plugin/` ao lado
  serviu zip válido; PHP extraído idêntico ao original byte a byte (8887 B).
- ✅ 🐛 **"Baixar plugin WP" clicava e nada acontecia (parte 2) — 2026-07-09.**
  Depois do fix do backend, o botão ainda não baixava — e sem erro no
  console. Causa: era um `<a href={pluginDownloadUrl}>` e o WKWebView do
  macOS ignora silenciosamente navegação/download por link pra binários
  (IDÊNTICO ao bug do .docx de 2026-07-09). Fix igual: `SitesView` agora
  faz `blogFetchBlob("/api/plugin/download")` → `save()` do plugin-dialog
  → comando Rust `write_file_bytes`, com spinner "Baixando…" e toast de
  sucesso/erro. Removido `pluginDownloadUrl`/`getBlogPort` (só frontend,
  sem rebuild de sidecar). Nota pro futuro: QUALQUER download no painel
  Blog tem que passar por esse fluxo — `<a download>` nunca funciona no
  webview do Tauri.
- ✅ 🐛 **App CONGELAVA ao publicar vários artigos — tempestade de auth — CRÍTICO — 2026-07-09.**
  Usuário publicou em 2 sites em sequência (2 pipelines simultâneos) + 2
  programados, sem intervalo, e o app inteiro travou (voltou depois de
  ~1min). Diagnóstico via `registros-terminal.txt` (7200 linhas): o
  `middleware/auth.ts` chamava `auth.getUser(token)` — ida à rede pra
  `/auth/v1/user` do Supabase — EM CADA request. Com o painel pollando
  (progresso de job a cada 2s × 2 jobs, notificações, sites, etc.), virou
  uma enxurrada de `getUser` que estourou o RATE LIMIT de auth do Supabase:
  100× `ConnectionRefused` em `auth/v1/user`, o auth-js entrou em retry de
  ~75s por request (152 respostas >5s, várias em 75.000ms, uma em 86s),
  163 respostas 401, e o Bun.serve saturou → UI congelada (todo botão faz
  `blogFetch` que pendurava). Quando o rate limit passou, drenou e "voltou".
  Fix em 3 camadas (opção 4+2+3, decidido com o usuário):
  - **Opção 4 — validação local do JWT (a cura):** `middleware/auth.ts`
    agora valida a ASSINATURA do token localmente com `jose`
    (`createRemoteJWKSet` + `jwtVerify`), ZERO rede por request. O projeto
    assina com ES256 e expõe a chave PÚBLICA no JWKS (`/auth/v1/.well-known/
    jwks.json`) — validar com ela não exige segredo. JWKS é buscado 1× e
    cacheado (refetch automático em `kid` novo). Não força iss/aud (a
    assinatura válida já prova a origem; evita hard-fail por formato).
    User montado a partir das claims (`sub`→id, `email`). Trade-off: token
    revogado no servidor vale até expirar (~1h) — irrelevante num sidecar
    local. Dep nova: `jose@6`.
  - **Opção 3 — falhar rápido:** `blogFetch`/`blogFetchBlob` ganharam
    AbortController com timeout (20s / 60s downloads) — request travado
    aborta em vez de pendurar a UI.
  - **Opção 2 — não empilhar polls:** guard in-flight no poll de
    notificações (`BlogPanel`, + pula quando `document.hidden`) e no poll de
    progresso de job (`NovoArtigoView`, timeout 8s).
  Testado no binário compilado: sem token → 401 em 1ms; token lixo → 401 em
  2ms; JWT com assinatura falsa → 401 (1ª req 127ms buscando JWKS, 2ª/3ª
  ~1ms cacheado). Zero rede por request depois do 1º fetch — a tempestade
  ficou estruturalmente impossível. (Positivo com token real: validar
  in-app.)
- ✅ ✨ **Verificação (auth/anti-freeze) — 2026-07-09.** Frontend e backend
  `tsc --noEmit` exit 0. Sidecar rebuild + deploy em `target/debug` +
  antigo morto.
- ✅ ✨ **Fila SERIAL de pipelines — 1 artigo por vez — 2026-07-09.**
  Decisão do usuário: em vez de rodar vários em paralelo (o que gerava a
  carga que travou o app), executar UM de cada vez. Novo módulo
  `pipelineQueue.ts` (FIFO, 1 worker global): `enfileirar()` (fire-and-forget,
  modo "agora") e `enfileirarComResultado()` (scheduler, que precisa do
  resultado). `routes/artigos.ts` agora ENFILEIRA cada keyword em vez de
  `void (async…)()` concorrente; `scheduler.ts` roda pela MESMA fila — os
  dois caminhos nunca colidem. Job criado nasce `etapa="na_fila"` e o
  `onStart` flipa pra "iniciando" quando chega a vez. `NomeEtapa` (pipeline)
  e `BlogProgresso` (front) ganharam `na_fila`. UI: `NovoArtigoView` mostra
  o card com ampulheta âmbar + borda tracejada + "Na fila — aguardando
  finalizar o artigo em processamento…" (sem spinner); vira spinner normal
  quando começa. Resolve o backlog "fila de concorrência" de forma mais
  forte que o pedido original (serial total, não 2-3 paralelos).
- ✅ ⚡ **Abas Programação/Histórico do drawer voltaram a ser rápidas — 2026-07-09.**
  Regressão de percepção: a lista de Sites foi otimizada antes (via
  `/api/sites/summary`), mas as abas DENTRO do drawer usam
  `ProgramacaoView`/`HistoricoView`, que puxavam dados pesados. Fixes:
  `ProgramacaoView` agora busca `/api/agendamentos?site_id=X` (filtro no
  SERVIDOR, antes puxava TODOS e filtrava no cliente) e NÃO busca
  `/api/sites` no drawer (nome do site já está no cabeçalho); + guard
  anti-overlap no poll de 5s. `HistoricoView` (já filtrava histórico por
  site) parou de buscar `/api/sites` no drawer. Nome do site escondido nos
  cards quando `fixedSiteId` (redundante). Menos requisições e payloads
  menores por carga.

## Backlog — robustez pra publicação em massa (2026-07-09)

A **fila serial** (acima) resolveu o gargalo de concorrência de forma direta:
como só roda 1 pipeline por vez, Gemini/Magnific/WordPress nunca recebem
chamadas paralelas nossas. Os itens abaixo deixaram de ser risco de "rajada"
e viram só robustez de UM pipeline isolado (que já funciona). Reavaliar só se
um dia quisermos paralelismo controlado (2-3 por vez) em vez de serial:

- ✅ **Fila de concorrência dos pipelines** — RESOLVIDO pela fila serial
  (`pipelineQueue.ts`). Modo "agora" e scheduler compartilham 1 worker.
- ⏳ **Rate limits do Gemini.** Menos crítico agora (chamadas serializadas,
  nunca paralelas). Ainda vale conferir retry/backoff em `steps/gemini.ts`
  pra um 429 pontual não derrubar o artigo.
- ⏳ **Magnific: créditos.** Concorrência deixou de ser problema (serial);
  resta só o limite de CRÉDITO da conta sob volume alto ao longo do tempo.
- ⏳ **Upload no WordPress.** Uploads agora são serializados por natureza;
  o retry do INSERT do histórico já cobre o "socket closed" transitório.
- ⏳ **Idempotência/observabilidade.** Notificação + toast + card "na fila"
  cobrem o acompanhamento; validar mensagens sob uma fila longa real.

## Sprint 30 — Correções pós-teste (Magnific OAuth + Gemini parser) — 2026-07-03

Usuário testou o painel em produção, primeiro clique em "Conectar" no
Magnific abriu o browser e caiu em `ERR_CONNECTION_REFUSED`; segundo clique
disse "Conectado" sem verificar de fato; ao gerar artigo, quebrou com
"A resposta do Gemini veio em um formato inesperado". Três bugs
correlatos, todos corrigidos aqui.

- ✅ 🐛 **Race no callback OAuth do Magnific — 2026-07-03.**
  `_conectar()` chamava `client.connect(transport)` ANTES de subir o
  callback server em `localhost:8765` — mas o SDK MCP dispara
  `redirectToAuthorization` (que abre o browser) DENTRO do `connect()`.
  Se o Magnific redirecionar rapidamente, o browser bate no callback
  antes do server subir → `ERR_CONNECTION_REFUSED`. Refatorado:
  `esperarCallback()` agora retorna síncrono um `CallbackHandle`
  (`{ promise, cancel }`) com o server já bindado; `_conectar()` sobe
  o server ANTES do `client.connect()` que dispara o browser. Se algo
  falhar antes do callback chegar, `handle.cancel()` derruba o server.
- ✅ 🐛 **`GET /api/config/magnific` reportava falso "conectado" — 2026-07-03.**
  Verificação era `existsSync(tokenPath)` — mas o SDK cria o arquivo
  no meio do fluxo para gravar `client_info` (DCR) e `code_verifier`
  (PKCE), mesmo antes de receber tokens. Após um OAuth abortado, o
  arquivo existia sem `access_token` → status "conectado" falso.
  Trocado por `storage.getTokens()?.access_token` check real.
- ✅ 🐛 **Retry interativo limpa token expirado — 2026-07-03.** Na
  1ª tentativa silenciosa, se o token do disco der `UnauthorizedError`,
  `_conectar()` agora chama `provider.invalidateCredentials("tokens")`
  + `("verifier")` antes de cair no interativo — evita reusar PKCE
  velho num novo fluxo.
- ✅ 🐛 **Gemini: parser sem log do texto bruto — 2026-07-03.**
  Erro "A resposta do Gemini veio em um formato inesperado" era
  disparado em `parseEValidar` quando `JSON.parse` retornava algo que
  não era objeto (ex.: `null`, array, string) — mas o texto bruto
  nunca era logado, impossibilitando diagnóstico. Agora `logSeguro`
  dumpa os primeiros 500 chars da resposta e a mensagem pro usuário
  inclui o tipo real recebido (`recebido: array, esperado: objeto JSON`).
  Também trata resposta vazia com mensagem específica.
- ✅ ✨ **Verificação — 2026-07-03.** `bunx tsc --noEmit` no
  blog-backend: exit 0. Binário Mac ARM64 rebuild via `bun run build:mac`
  → 62 MB. Usuário precisa fechar+reabrir o app pra pegar o binário
  novo (o sidecar em execução é o antigo).
- ✅ 🐛 **BUG CRÍTICO: prompt padrão vazio no bundle — 2026-07-03.**
  Primeiro teste real de geração de artigo caiu com Gemini devolvendo
  schema exemplo `{id, name, price, isInStock, tags, manufacturer, ...}`.
  Causa: `blog-backend/src/prompt.ts::getPrompt()` tentava
  `Bun.file(resolve(import.meta.dir, "prompt_padrao_default.txt"))` como
  seed — funciona em dev, mas `bun build --compile` **não bundleia
  recursos `.txt`**, só código. No binário standalone, `seed.exists()`
  retornava `false` → `getPrompt()` devolvia `""` → `savePrompt("")`
  gravava arquivo vazio → Gemini recebia `contents=""` → respondia com
  schema Product da doc oficial. Fix: criado
  `blog-backend/src/prompt_padrao_default.ts` com o texto embutido como
  `PROMPT_PADRAO_DEFAULT` string TS — vai pro bundle direto. `prompt.ts`
  importa a constante e re-semeia arquivos vazios existentes.
- ✅ 🐛 **Aplicação das divergências achadas na comparação — 2026-07-03.**
  Após comparação bloco a bloco entre Python e TS+React, corrigidas as
  divergências que causavam bugs ou UX pior que o app original:
  (1) **Bloco 6 (imagens)** — reescrito `blog-backend/src/steps/images.ts`
  pra bater com Python: 1 `stock_search` com a keyword do artigo (não N
  buscas por prompt do Gemini) → baixa até N imagens do banco → completa
  com IA usando prompt neutro. Corrige o problema observado onde imagens
  não vinham porque cada prompt individual devolvia 0 resultados no banco.
  Pipeline agora passa `keyword` e `quantidade: 3` em vez de
  `prompts: [...artigo.imagens_prompts]`.
  (2) **Bloco 4 (links)** — removido `"sobre"` de `SLUGS_EVITAR` em
  `steps/links.ts` — Python não bloqueia páginas "Sobre" que costumam
  ser páginas-pilar úteis pra link building.
  (3) **Bloco 10 (`/api/historico/:id/docx`)** — usa `item.slug` do
  banco primeiro (fonte confiável, igual Python), com `post_url.split`
  só como fallback. Também amplia `status` da busca WP pra incluir
  rascunhos, pendings e privados.
  (4) **Bloco 10 (`/api/historico/:id/publicar`)** — status final agora
  é `"publicado"` (paridade com Python), não `"concluido"`.
  (5) **Bloco 15 (HistoricoView)** — `STATUS_STYLE` aceita ambos
  `"publicado"` e `"concluido"` como sinônimos + adiciona `"agendado"`.
  (6) **Bloco 15 (NovoArtigoView)** — removido filtro
  `sites.filter(s => s.plugin)` que escondia sites conectados mas ainda
  não testados. Python mostra todos os sites; agora TS também.
  (7) **Bloco 15 (SitesView)** — adicionados botões "Editar" e "Remover"
  ausentes na paridade com Python. Editar abre modal com nome (a URL
  fica read-only porque o backend PUT não aceita alterar url — segurança
  do plugin). Remover usa confirmação inline em 2 cliques (`window.confirm`
  bloqueado pelo Tauri).
  (8) **Bug latente em `SitesView.PromptModal`** — `blogFetch<BlogSite>`
  em `PUT /api/sites/:id` estava tipado errado; backend devolve
  `{site: BlogSite}` (envelope) e `onSaved(next)` propagava um objeto
  sem `.id`/`.url`, corrompendo a lista. Trocado por
  `blogFetch<{site: BlogSite}>` + `resposta.site`.
- ✅ 📋 **Comparação COMPLETA Python vs TS+React — 2026-07-03.**
  Usuário pediu comparação exaustiva do app inteiro (backend + frontend
  + plugin + DB). Documento em `tng-demand-hub/COMPARACAO_PYTHON_VS_TS.md`
  com 17 blocos cobrindo cada arquivo. Achados críticos:
  (a) Bloco 4 links: TS pula "sobre" (Python não). (b) Bloco 6/8 imagens:
  TS faz N buscas no Magnific vs 1 no Python. (c) Bloco 10 `/historico/:id/docx`:
  TS usa `post_url.split` vs Python usa `item.slug`. (d) Bloco 11 chave
  Gemini: TS grava em `settings.json` vs Python usa keyring do SO (viola
  RNF-08/09). (e) Bloco 15: TS filtra sites por `plugin=true` na tela
  Novo Artigo, Python mostra todos. (f) Bloco 15: TS não tem UI de
  editar nome/URL de site. Achados de paridade OK: Bloco 5 RankMath
  (falso alarme — os campos `title/description/focus_keyword` batem no
  payload TS, só divergem no shape da API interna), Bloco 12 Magnific
  (persistência do token 1:1), Bloco 17 plugin WP (byte a byte
  idêntico). Plugin verificado via diff — zero bytes de diferença.
- ✅ 🐛 **Gemini: desembrulhar wrappers + log de keys ausentes — 2026-07-03.**
  Ao rodar geração real, `parseEValidar` deu `O texto gerado veio
  incompleto (faltou: title, meta_description, slug, content_html)`.
  Sinal clássico do modelo aninhar a resposta em wrapper (`{"artigo": {...}}`,
  `{"output": {...}}`) apesar do prompt pedir top-level. Adicionada
  `_talvezDesembrulhar(obj, wrappers)` que detecta wrappers conhecidos
  (`artigo`, `article`, `output`, `response`, `resultado`, `data`) OU
  qualquer objeto com uma única chave apontando pra outro objeto, e usa
  o inner como fonte. `logSeguro` agora dumpa as keys presentes + amostra
  dos primeiros 500 chars quando os obrigatórios faltam. Mensagem ao
  usuário passa a incluir as keys recebidas.
- ✅ 🐛 **Remover `window.confirm` do botão Reconectar Magnific — 2026-07-03.**
  `ConfigView.tsx::conectar()` usava `window.confirm(...)` — o Tauri
  intercepta e redireciona pra `dialog.confirm` do plugin-dialog, que
  não está autorizado nas capabilities. Console:
  `Unhandled Promise Rejection: dialog.confirm not allowed. Command not found`.
  Não adicionamos a capability porque isso é mudança no app principal.
  Removido o confirm — o botão já é explícito e o texto abaixo dele
  avisa que o navegador vai abrir.
- ✅ 🐛 **Health-check + limpeza de zombie no `blog_sidecar_start_lazy`
  — 2026-07-03.** Após matar o sidecar antigo externamente (`kill 91446`)
  pra pegar o binário novo, o Rust ficou com `state.child = Some(child_morto)`
  → próxima abertura do painel Blog responde `running: true, port: 8000`
  sem spawn novo, e o React bate em endpoint fantasma (`Could not connect
  to the server` em massa). Corrigido em `src-tauri/src/blog_sidecar.rs`:
  (1) `blog_sidecar_start_lazy` agora chama `_porta_esta_viva(port)`
  (TCP connect com timeout 500ms) antes de responder `running: true`;
  se a porta não responde, mata o child fantasma e cai no spawn normal.
  (2) `CommandEvent::Terminated` no handler async agora zera
  `state.child` via `app.state::<BlogSidecarState>()` — fecha o loop
  de zombie mesmo quando o kill vem por caminho normal. Nova feature
  `net` em `tokio` no `Cargo.toml`.

## Sprint 20 — Painel de clientes como visualização (v0.1.11) — 2026-06-29

Terceiro modo de visualização da Dashboard ("Por cliente") ao lado de
Lista e Kanban. Em vez de iterar demandas como cards soltos, agora
podemos partir do cliente como entidade central e ver as demandas
dentro do drawer dele. Drawer empilhado: clicar numa demanda dentro
do `ClientDetailDrawer` abre o `DemandDetailDrawer` por cima sem
fechar o de baixo.

- ✅ ✨ Migration `20260629000002_client_project_phase.sql` — 2026-06-29.
  Coluna nova em `clients` com check constraint (`not_started` |
  `in_development` | `developed`) e default `not_started`. Comentário
  documenta a semântica.
- ✅ ✨ Tipo `ClientProjectPhase` + `CLIENT_PROJECT_PHASE_LABELS` —
  2026-06-29. `src/types/database.ts` ganha o enum e o map de labels
  pt-BR. `Client` ganha o campo. `ClientInput`/`ClientPatch` em
  `lib/clients.ts` aceitam o campo; `createClient` aplica
  `not_started` como default no insert; `updateClient` propaga.
- ✅ ✨ `listDemandsByClient` + `listClientDemandCounts` — 2026-06-29.
  Helpers em `src/lib/demands.ts`. `listDemandsByClient` puxa
  ordenado por `created_at desc` sem limite (cardinalidade baixa por
  cliente). `listClientDemandCounts` faz SELECT minimalista de
  `(client_id, status)` e agrega em JS — barato pra ~100 clientes.
- ✅ ✨ Select de "Fase do projeto" no ClientForm — 2026-06-29.
  Campo novo no form de criar/editar cliente em `ClientsAdmin.tsx`.
  Default `not_started` em novos cadastros.
- ✅ ✨ `ClientsPanelView` — 2026-06-29. Grade responsiva (1-4 colunas
  conforme breakpoint) de cards de cliente com nome, alias, badge da
  fase (cinza/laranja/verde), contadores `N abertas · M totais`
  (derivado de `demands` local via `useMemo`) e link count quando
  houver. Busca em `name+alias+email` com normalização de acento.
  Só clientes ativos.
- ✅ ✨ `ClientDetailDrawer` — 2026-06-29. Drawer 680px na direita.
  Header com nome, alias e select de fase inline (cores casam com o
  badge dos cards e atualizam o cliente via `updateClient`). Info
  bar com email/telefone/status. Links (reusa o padrão de Sprint 16
  pra GMN/WA/Drive com label da unidade). Notas internas. Lista de
  demandas com filtros (todas/abertas/concluídas), mini-cards com
  dot de status + título + data + prazo. Click abre o
  `DemandDetailDrawer` empilhado.
- ✅ ✨ Drawer empilhado: cliente → demanda — 2026-06-29.
  `DemandDetailDrawer` sobe pra `z-50` (era `z-40`); `ClientDetailDrawer`
  fica em `z-40` (backdrop `z-30`). Prop `escDisabled` no
  `ClientDetailDrawer` evita conflito: o handler do ESC só fecha o
  topo da pilha — quando há `DemandDetailDrawer` aberto, o ESC do
  cliente é silenciado.
- ✅ ✨ Toggle 3 modos na Dashboard — 2026-06-29. `ViewToggle` ganha
  terceiro botão "Por cliente" (ícone `fa-users`). `viewMode` agora
  tipa `"list" | "kanban" | "clients"`. Quando ativo, `DashboardScreen`
  carrega `Client[]` completos via `listAllClients` sob demanda (cache
  no state `fullClients`) — só na 1ª entrada do modo.
- ✅ ✨ Ajustes pós-feedback no painel de clientes — 2026-06-29.
  Rodada de refinamentos UX baseada no primeiro teste do user:
  - Botão "Por cliente" sem ícone (mais limpo no toggle).
  - `ClientsPanelView` virou lista de uma coluna em vez de grade (user
    achou que grade dificultava a leitura).
  - Fase no drawer virou 3 botões radio-like visíveis (clique único,
    sem precisar abrir um `<select>` antes). Estado "ativo" usa o
    badge com fundo cheio.
  - Notas internas no drawer agora são editáveis (textarea + save on
    blur via `updateClient`); o caller recebe o cliente atualizado
    via `onPatchClient` pra refletir na lista.
- ✅ ✨ Comentários por cliente — 2026-06-29. Nova tabela
  `client_comments` (migration `20260629000003_client_comments.sql`)
  com RLS espelhando `comments`: SELECT/INSERT pra membros ativos,
  DELETE só admin. Realtime habilitado. `src/lib/clientComments.ts`
  com CRUD + subscribe; `ClientCommentsThread.tsx` renderiza thread
  minimalista (texto puro, sem menções por enquanto) no fim do
  drawer do cliente.
- ✅ ✨ SettingsPanel consolida 7 botões do header — 2026-06-29.
  Botão de engrenagem único substitui Clientes, Membros, Uso IA,
  Regras, Desempenho, Notificações e Atalho. SettingsPanel é uma
  tela com cards descritivos pra cada admin; click delega abertura
  pro Dashboard via `onOpen(key)` que aciona o setter individual
  (preserva refresh effects). "Desempenho" gated pra admin. Rodapé
  mostra a versão do app lendo `package.json`. Cabeçalho do
  Dashboard fica com Toggle + engrenagem + usuário + Sair.
- ✅ ✨ Header em 3 colunas centralizando o ViewToggle — 2026-06-29.
  Grid `[1fr_auto_1fr]` garante que os botões "Lista | Kanban | Por
  cliente" ficam centralizados em relação à janela (não em relação
  ao espaço residual). Engrenagem perdeu borda e ganhou padding
  reduzido — vira ícone discreto no estilo do sino que substituiu.
- ✅ ✨ Busca inclui clientes + agrupamento por tipo — 2026-06-29.
  `SearchPalette` agora separa resultados em 3 seções (Clientes,
  Demandas, Comentários) com headers sticky. Click em cliente abre
  `ClientDetailDrawer`; demanda/comentário abrem `DemandDetailDrawer`.
  Dashboard passa `fullClients` pro palette e força carregamento
  quando o palette abre (mesmo sem o user ter entrado no painel
  "Por cliente").
- ✅ 🐛 Busca não pegava palavras acentuadas — 2026-06-29. Antes,
  digitar "metodo" não casava com "Método Ambiental" porque o
  `scoreDemand` só fazia `toLowerCase()`. Adicionada normalização
  NFD + regex pra remover diacríticos em todos os haystacks
  (título, descrição, tags, nome do cliente). "metodo" agora bate
  com "Método", "acao" com "ação", etc.
- ✅ ✨ Busca também casa pelo nome do cliente — 2026-06-29.
  `scoreDemand` agora inclui `client.name`/`client.alias` no
  haystack das demandas. Digitar o nome de um cliente lista
  todas as demandas dele.
- ✅ ✨ Botão de busca no header com atalho dinâmico — 2026-06-29.
  Novo botão ao lado da engrenagem mostra "⌘ K" no macOS e "Ctrl
  K" no Windows/Linux (detectado via `navigator.platform`).
  Acessível à mão pro user que não conhece o atalho.
- ✅ ✨ Scrollbar dark global — 2026-06-29. CSS global em
  `index.css` (Webkit + Firefox `scrollbar-color`/`-width`)
  substitui o scrollbar branco padrão do macOS por trilha
  transparente com thumb em `tng-marine-600` (hover sobe pra
  500). Combina com o fundo escuro do app.
- ✅ ✨ Bump 0.1.10 → 0.1.11 — 2026-06-29.

## Sprint 19 — Reorg + busca de clientes + histórico para membros (v0.1.10) — 2026-06-29

Sprint de polimento e organização. Padroniza a marcação dos registros
do CLAUDE.md (🐛/✨ inline), introduz busca rápida no painel de
clientes (~100 cadastrados após Sprint 16) e libera o histórico da
demanda pra todos os membros — antes era admin-only.

- ✅ ✨ Convenção 🐛/✨ inline nos registros de sprint — 2026-06-29.
  Cada bullet `- ✅ Título` ganha prefixo: ✨ pra feature, 🐛 pra bug.
  Aplicado retroativamente nas 17 sprints anteriores via script
  (heurística + revisão manual). Nova seção "Convenção dos registros
  de sprint" no topo do `CLAUDE.md` documenta o padrão. Compatível
  com `feedback_registrar_no_claude_md.md` — a convenção `- ✅ Título
  — YYYY-MM-DD.` continua valendo, só ganha o tipo na frente.
- ✅ ✨ Busca de clientes em ClientsAdmin — 2026-06-29. Input com
  ícone lupa acima da lista, filtro case-insensitive em
  `name + alias + email` via `useMemo` (normaliza acento via NFD).
  Contador `X de Y` no canto, botão `×` pra limpar, mensagem
  específica quando nenhum bate. Resolve a fricção de localizar
  cliente entre ~100 cadastrados.
- ✅ ✨ Histórico de demanda visível pra todos os membros — 2026-06-29.
  No `DemandDetailDrawer`, removido o gate `{isAdmin && ...}` e o
  rótulo "(admin)" do título da seção. Comentários e anexos já eram
  visíveis pra todos; manter o histórico restrito não fazia sentido.
- ✅ ✨ Migration `20260629000001_demand_history_members_select.sql`
  — 2026-06-29. Substitui a policy `demand_history_select_admin`
  (Sprint 11) por `demand_history_select_members` que usa
  `is_active_member()` em vez de `is_admin()`. INSERTs continuam
  exclusivamente via triggers SECURITY DEFINER — nenhum membro
  consegue forjar entradas. Não há texto livre em
  `demand_history`, só snapshots de campos (status, responsável,
  prazo, etc), então a exposição é segura.
- ✅ ✨ Bump 0.1.9 → 0.1.10 — 2026-06-29.

## Sprint 18 — Janela de captura, single-instance e AltTab (v0.1.9) — 2026-06-27

Bug crítico relatado por membros: apertar `Esc` na janela de captura
"fechava o app inteiro". Investigação encontrou 3 problemas que se
reforçavam — a Sprint 14 escondia a main quando o ESC fechava a
captura (pra evitar focus-stealing do macOS), o app não tinha
`tauri-plugin-single-instance` (clicar no atalho da taskbar do Windows
spawnava nova instância), e no macOS as janelas `capture`/`preview`
viviam pré-criadas com `visible: false` mas o `CGWindowList` ainda as
enxergava — AltTab listava ambas como abertas.

Decisão de UX consolidada: a captura é um atalho global de fora do app;
quando fecha, o foco do sistema deve voltar pro app anterior (Chrome
etc), NUNCA promover a main do TNG sem ser pedido. A preview é aberta
de dentro do app, então fechar volta naturalmente pra main.

- ✅ 🐛 `hide_main_window` removido — 2026-06-27. A função inteira
  (cmd + invoke handler + chamada no CaptureScreen) foi retirada. Era
  workaround da Sprint 14 e gerava o sintoma de "fechou o app" no
  Windows. Substituído pela abordagem nova abaixo.
- ✅ 🐛 Foco volta ao app anterior por PID — 2026-06-29. `show_capture_window`
  agora chama `remember_frontmost_app_pid` ANTES do show, guardando o
  PID do app que estava em foreground (Chrome etc) num `AtomicI32`
  estático. Quando a captura é destruída, `hide_capture_window` chama
  `activate_previous_app` que faz `NSRunningApplication.activateWithOptions`
  pro PID guardado — devolve o foco explicitamente, sem deixar o macOS
  escolher (que escolheria a main do TNG). Tentativas anteriores não
  bastaram: `NSApp.hide(nil)` (2026-06-27) escondia tudo e restaurava
  no próximo Alt+Alt; `NSApp.deactivate()` (2026-06-29) liberava o
  foreground mas o macOS ainda promovia a main do TNG em vez de
  passar pra outro app.
- ✅ 🐛 Plugin `tauri-plugin-single-instance` integrado — 2026-06-27.
  Adicionado em `Cargo.toml` (target desktop) + registrado no builder
  do `lib.rs` com handler que chama `show_main_window`. Clicar no
  atalho da taskbar/Dock agora reativa a instância existente em vez
  de spawnar outra — fim dos múltiplos ícones na bandeja do Windows.
- ✅ 🐛 `CloseRequested` da main interceptado — 2026-06-27. No setup
  do `lib.rs`, depois do tray icon, `on_window_event` da janela main
  prevent_close + hide. Combinado com tray (Abrir/Nova captura/Sair)
  + single-instance, fechar pelo X esconde em vez de encerrar; user
  reabre pelo tray ou pelo atalho. Cmd+Q (macOS) ou item Sair do tray
  encerram de verdade.
- ✅ 🐛 `capture`/`preview` criadas on-demand — 2026-06-27. Removidos
  os blocos do `tauri.conf.json`. No `lib.rs`, `ensure_capture_window`
  e `ensure_preview_window` usam `WebviewWindowBuilder` pra construir
  on-demand; ao fechar, `destroy()` em vez de `hide()`. A janela some
  do `CGWindowList` do macOS, sem aparecer no AltTab. Cold start de
  ~200ms na 1ª invocação após boot — aceitável.
- ✅ 🐛 Handshake `preview:ready` — 2026-06-27. Como a janela `preview`
  é criada toda vez que precisa, o React lá dentro leva tempo pra
  montar e registrar o listener de `preview:open`. `lib/preview.ts`
  agora aguarda `preview:ready` (emitido pela `PreviewScreen.tsx` no
  mount) antes de mandar o payload — com timeout de 4s como fallback.
- ✅ 🐛 Permission `core:window:allow-destroy` — 2026-06-27. Adicionada
  ao `capabilities/default.json` pra liberar o `destroy()` chamado
  pelo frontend (PreviewScreen).
- ✅ ✨ Commands `ensure_capture_window_cmd`/`ensure_preview_window_cmd`
  expostos ao JS — 2026-06-27. `lib/preview.ts` invoca o `_cmd` antes
  de emitir; outros consumidores (futuro) podem chamar pra preparar
  uma janela auxiliar sem mostrá-la.
- ✅ ✨ Deps `cocoa = "0.26"` + `objc = "0.2"` (macOS-only) — 2026-06-27.
  Necessárias pro `NSApp.hide(nil)` chamado por `hide_capture_window`.
  Restritas ao target macOS via `cfg(target_os = "macos")`.
- ✅ ✨ Bump 0.1.8 → 0.1.9 + Sprint 18 documentada — 2026-06-27.

## Sprint 17 — Menções @usuario na captura → comentário (v0.1.8) — 2026-06-17

Sprint 15 trouxe menções `@usuario` no editor de comentários do drawer, mas o
fluxo "comentar" da janela flutuante de captura ainda gravava o texto cru —
`@joao` virava texto literal, sem ID no array `comments.mentions`, sem
notificação pro mencionado. Resolvido em duas camadas.

- ✅ ✨ **Helper `convertPlainTextMentions` em `lib/htmlContent.ts` — 2026-06-17.**
  Recebe texto + lista de profiles, devolve `{html, mentionIds}`. Matching
  fuzzy: full_name exato → primeiro+último nome → prefixo único do primeiro
  nome. Normaliza acento e case. Casos não encontrados ficam como texto cru
  (`@joao`) — sem chip, sem notif. Sem custo de IA.
- ✅ ✨ **`CommentConfirmView` ganha RichTextEditor com mentionProfiles —
  2026-06-17.** Substitui o `<textarea>` antigo. Init recebe o HTML já
  processado pelo helper (chips visíveis no carregamento). User pode editar e
  digitar `@` pra abrir o dropdown do tiptap. Submit usa
  `extractMentionIdsFromHtml` pra extrair os IDs finais e passa ao
  `saveCommentMode(content, mentions)`, que repassa pra `createComment`.
  Atalho `⌘↵` mantido via listener global.

## Sprint 16 — Múltiplos links de cliente com label (v0.1.7) — 2026-06-17

Pré-importação dos 103 clientes da planilha consolidada (`dados clientes/output/clientes.xlsx`), o user identificou que **6 clientes têm múltiplas unidades** (Oficina do Smart com 5 perfis Google Meu Negócio, AM Advocacia com 3 GMNs e 3 grupos WhatsApp, Fix Na Hora com 3, etc.). O schema antigo só aceitava 1 GMN e 1 WhatsApp por cliente. Esta sprint expande os 3 tipos de link pra arrays uniformes `{label,url}[]`, onde o label tipicamente carrega o nome da unidade.

- ✅ ✨ **Migration `20260618000001_client_multi_links.sql` — 2026-06-17.**
  Substitui `google_business_url text` + `whatsapp_group_url text` + `drive_urls text[]` por 3 colunas `jsonb` (`google_business_urls`, `whatsapp_group_urls`, `drive_urls`), cada uma com array de `{label, url}`. Dados existentes são preservados via `UPDATE` antes do `DROP` (label vai como string vazia). Constraints `jsonb_typeof = 'array'` impedem objetos soltos. `comment on column` documentam o formato.
- ✅ ✨ **`LinkArrayInput` reutilizável no ClientForm — 2026-06-17.**
  Componente novo em `ClientsAdmin.tsx` que renderiza lista dinâmica de pares (label, url) com botão "+ adicionar mais um link" e lixeira por linha. Usado nas 3 seções (GMN, WhatsApp, Drive). Form sempre garante 1 linha vazia visível pra UX previsível; vazios são limpos no `cleanLinkArray()` de `lib/clients.ts` antes de gravar. Tipo novo `ClientLink` em `types/database.ts`.
- ✅ ✨ **Drawer renderiza todos os links com label da unidade — 2026-06-17.**
  `ClientLinks` em `DemandDetailDrawer.tsx` itera os 3 arrays e usa o `label` como texto do chip; quando vazio, cai no fallback histórico ("Google Meu Negócio", "Grupo no WhatsApp", "Google Drive"/"Drive N"). Layout grid preservado. Drive mantém o "Drive 1/2..." quando há vários sem label.

## Sprint 15 — Hot-fix + Menções (v0.1.6) — 2026-06-17

Resposta a feedback do v0.1.5: erro de FK ao excluir demanda com comentários
e pedido de menção `@usuario` nos comentários (estilo Trello/Notion).

- ✅ 🐛 **Fix: FK violation no DELETE de demanda — 2026-06-17.**
  Migration `20260617000001_fix_demand_history_cascade.sql` adiciona guard no
  trigger `demand_history_track_comments`: quando o CASCADE em comments
  dispara durante a exclusão da demand, o trigger pulava a inserção em
  `demand_history` se a demand não existir mais (caso de cascade). Sem o
  guard, a FK `demand_history.demand_id → demands.id` violava dentro da
  mesma transação.
- ✅ ✨ **Menções @usuario em comentários — 2026-06-17.**
  Tiptap `@tiptap/extension-mention` com dropdown próprio (sem Tippy), ↑↓
  pra navegar, Enter/Tab pra escolher, Esc fecha. Lista filtrável conforme
  digita. Profiles vêm da prop `mentionProfiles` no `RichTextEditor`.
  Sanitizer aceita `<span data-type="mention" data-id="...">` (e novos data
  attrs em geral). Helper `extractMentionIdsFromHtml(html)` popula o array
  `comments.mentions` (coluna já existia, era só wire). Render com chip
  laranja discreto em `.tng-mention` (CSS em `index.css`).
- ✅ ✨ **Notificação de menção dedicada — 2026-06-17.**
  `decideMentionNotification` em `notificationDecider.ts`. Tem prioridade
  sobre `decideCommentNotification` — usuário mencionado é sempre avisado
  mesmo que não esteja envolvido na demanda. Respeita novo pref
  `NotificationPrefs.mentions` (default true). Toggle novo em
  `NotificationSettings.tsx` ("Menções (@usuario)").

## Sprint 14 — Pós-Beta Interno (v0.1.5) — 2026-06-16

12 features baseadas em feedback dos membros que testaram v0.1.4. Tudo
num único bump pra propagar via auto-update de uma vez só (sem release
até finalizar todas).

- ✅ ✨ **Ícone do Dock macOS com mais padding — 2026-06-16.**
  `public/logo-icone.png` substituído por `logotipo.png` (20% margem em
  volta), `npx tauri icon` regerou todos os tamanhos.
- ✅ ✨ **Atalho Option+Option / Alt+Alt como padrão — 2026-06-16.**
  `DEFAULT_MODE` em `src/lib/hotkey.ts` virou `double-tap`. Migration
  leve via `migrateHotkeyConfigIfNeeded()` (versão 2) força reset pra
  clientes que ainda estavam no combo. Infra Rust já estava 100% pronta.
- ✅ ✨ **Badge de Prazo no card — 2026-06-16.** Novo helper
  `formatDueDate()` em `src/lib/dates.ts` com 4 tons (overdue/urgent/
  soon/normal). Renderizado em `DueBadge` no card da lista.
- ✅ 🐛 **Esc na captura não traz o painel principal — 2026-06-16.** Novo
  command Rust `hide_main_window`. `closeWindow({cancelled:true})` em
  CaptureScreen esconde a main antes da capture quando user aperta Esc.
  Envio bem-sucedido mantém comportamento atual (main visível).
- ✅ ✨ **Filtro de data + ordenação por prazo — 2026-06-16.** Estados
  `dateFilter` e `sortOrder` no DashboardScreen, renderizados na
  FilterBar com `<input type="date">` e 2 botões (↑↓). Demandas sem
  due_date vão pro fim da ordenação independente da direção.
- ✅ ✨ **Cmd+K busca em comentários — 2026-06-16.** RPC
  `search_comment_demand_ids(q)` em migration nova. SearchPalette mantém
  busca local (título/descrição/tags) e adiciona busca server-side
  debounced 250ms em comments, mostrando excerpt no resultado.
- ✅ ✨ **Notificações de prazo 5d/3d/24h — 2026-06-16.** Tabela
  `demand_due_notifications` (PK composta deduplica), função SQL
  `compute_due_notifications()`, agendamento via pg_cron diário às 09h
  UTC. Cliente escuta realtime e dispara notif local. Respeita
  `profiles.notifications.due_soon`. **Nota:** pg_cron precisa estar
  habilitado no Supabase (Dashboard → Extensions); se não estiver, a
  função pode ser chamada manualmente.
- ✅ ✨ **Painel de preferências de notificação — 2026-06-16.** Componente
  `NotificationSettings.tsx` com 4 toggles (assigned / due_soon /
  comments / completed). Persiste em `profiles.notifications` JSONB já
  existente. `notificationDecider` agora consulta as prefs antes de
  emitir notificações de atribuição, comentário e conclusão.
- ✅ ✨ **Excluir demanda + anexos — 2026-06-16.** `deleteDemand()` em
  `src/lib/demands.ts` lista anexos → remove do Storage → delete na row
  (CASCADE limpa comments, attachments, demand_history,
  demand_due_notifications). Botão "Excluir demanda" no drawer (admin
  OU autor), com modal de confirmação. Policy
  `demands_delete_own_or_admin` já existia desde Sprint inicial.
- ✅ ✨ **Painel de desempenho (admin) — 2026-06-16.** RPC
  `member_performance_metrics(start_date, end_date)` agrega por membro:
  concluídas no período, em aberto, atrasadas, tempo médio total,
  tempo de resposta (todo→doing) e tempo de execução (doing→done) via
  `demand_history`. Componente `PerformancePanel.tsx` com filtro de
  período (7d/30d/90d/custom). Botão visível só pra admin no header.
- ✅ ✨ **Navegação entre anexos com setas — 2026-06-16.** `PreviewPayload`
  agora carrega `items[]` + `currentIndex`. PreviewScreen escuta
  ←/→ via window keydown e, pra PDF (que sequestra foco do iframe),
  registra atalhos globais escopados ao foco da janela. UI mostra
  contador "N / M" e setinhas no header quando há múltiplos anexos.
- ✅ ✨ **Bump v0.1.5 — 2026-06-16.** Versão em `package.json`,
  `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`. Type-check
  passa. Release deve ser criada SÓ após validação manual das 12
  features pelo time.

## Regras para você (Claude Code)

1. Antes de implementar algo grande, **consulte o PRD** (`../prd_projeto-TNG-Digital.md`) — ele tem schema, fluxos detalhados e prompts da IA.
2. Mantenha as **convenções acima** rigorosamente. Se precisar quebrar uma, justifique aqui e atualize a seção.
3. Sempre que adicionar dependência ou criar pasta nova, **atualize este arquivo**.
4. Não invente arquivos ou paths. Se não souber onde algo está, pergunte ou explore primeiro.
5. Mantenha tipos TypeScript fortes — `any` apenas com comentário justificando.
6. **Nunca** commite `.env.local` nem chaves de API.
