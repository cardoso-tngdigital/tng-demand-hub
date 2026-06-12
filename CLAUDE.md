# TNG Demand Hub — Guia para Claude Code

Este arquivo é o **contexto persistente** que o Claude Code consulta a cada interação. Atualize-o sempre que tomar decisões arquiteturais, mudar convenções ou adicionar dependências relevantes.

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

- ✅ **Refinar prompt da IA (#82) — 2026-06-08.** Título da demanda
  agora inclui o cliente quando identificado ("Banner da Cliente A"
  em vez de só "Banner"). Adicionados mais few-shots no prompt
  cobrindo casos curtos comuns ("feito 3 do Cliente A", "Cliente B
  aprovou") pra reduzir falsos "criar". Edge Function `extract-demand`.

- ✅ **Anexos no modo editar via IA (#79) — 2026-06-10.** Antes,
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

- ✅ **Prompt distingue anexar de comentar — 2026-06-10.** Edge
  Function `extract-demand` ganhou exemplo `[D]` em "editar"
  cobrindo "anexa esse print na demanda do banner do Cliente A" +
  imagem → `intencao: "editar"`. Regra forte no topo das dicas:
  captura com anexo + referência a demanda existente → SEMPRE
  editar, nunca comentar (anexos só ficam vinculados a demandas
  neste sistema; comentários não suportam arquivos). Sem essa
  regra a IA classificava "anexa essa imagem na demanda X" como
  comentar — que descartava silenciosamente o anexo.

### Quick Look preview (#80) — 2026-06-11

- ✅ **Janela Tauri separada para anexos com zoom.** Substituído o
  overlay full-screen do drawer (`AttachmentViewer`) por uma janela
  Tauri dedicada (`label: "preview"`), pré-declarada em
  `tauri.conf.json` (visible: false, viva escondida — mesmo padrão
  da `capture`). Carrega 1000×720, redimensionável, decorations
  nativas, fica fora do alwaysOnTop.
- ✅ **Comunicação main → preview via evento Tauri.** Helper
  `src/lib/preview.ts` resolve a signed URL do Storage, emite
  `preview:open` com payload (`url`, `name`, `mime`, `sizeBytes`)
  pra janela e dá show + focus. `PreviewScreen.tsx` escuta o
  evento e atualiza o título da janela com o nome do arquivo.
- ✅ **Zoom rico em imagens.** Scroll wheel com pivô no cursor
  (mantém o pixel sob o cursor parado), drag pra pan quando
  ampliado, double-click toggle 1×↔2×, atalhos `+` / `−` / `0`,
  range 10%–1000%. Vídeo, áudio e PDF continuam com controles
  nativos do webview (zoom de PDF é nativo do iframe).
- ✅ **Janela é hideable, não closeable.** `onCloseRequested`
  intercepta o X nativo e chama `hide()` em vez de fechar — assim
  a janela sobrevive entre invocações e a próxima abertura é
  instantânea. Esc também esconde.
- ✅ **Permissões adicionadas.** `core:event:allow-emit`,
  `core:event:allow-emit-to`, `core:window:allow-set-title` no
  `capabilities/default.json`. Janela `preview` incluída em
  `windows: ["main", "capture", "preview"]`.

#### Ajustes pós-feedback (2026-06-11):

- ✅ **Áudio toca inline, não abre janela.** Áudio não tem
  benefício de zoom ou janela separada — só atrapalha. Agora
  `AttachmentItem` no drawer detecta `category === "audio"` e,
  ao clicar, expande um `<audio controls>` dentro do próprio
  item (signed URL carregado on-demand). O botão alterna entre
  "Tocar" e "Recolher". Imagem/vídeo/PDF continuam abrindo na
  janela preview.
- ✅ **Botão Fechar visível na PreviewScreen.** Adicionado `✕`
  no header (sempre presente), e o container raiz ganha
  `tabIndex={-1}` + foco automático ao receber payload — assim
  Esc funciona no abrir.
- ✅ **Esc funciona também dentro do iframe de PDF.** Quando o
  payload é PDF, registramos `Escape` como **global shortcut**
  escopo-por-foco: o useEffect ouve `onFocusChanged` da janela
  e só mantém o atalho registrado enquanto a preview está em
  primeiro plano. Isso evita sequestrar o Esc de outros apps.
  Atalho é desregistrado ao trocar de PDF pra outro tipo, ao
  esconder a janela e no unmount. Permissions adicionadas:
  `global-shortcut:allow-register/unregister/is-registered`.
- ✅ **Mídia para ao esconder a janela.** Antes, `hide()` só
  invisibilizava o webview — `<video>` e `<audio>` continuavam
  tocando. Agora `hide()` limpa o `payload` (desmonta a mídia)
  antes do `getCurrentWindow().hide()`. Reseta zoom/pan também.
- ✅ **Imports estáticos pra Tauri APIs.** `lib/preview.ts` e
  `PreviewScreen.tsx` usavam `import("@tauri-apps/api/webviewWindow")`
  e `import("@tauri-apps/plugin-global-shortcut")` dinâmicos.
  O Vite não pre-bundla deps descobertas só em runtime, então a
  primeira tentativa devolvia 504 "Outdated Optimize Dep" e o
  preview falhava com "Importing a module script failed". Trocados
  por imports estáticos no topo dos arquivos.
- ✅ **`optimizeDeps.include` no `vite.config.ts`.** Mesmo com
  imports estáticos, o cache stale do Vite (`node_modules/.vite`)
  pode segurar o 504 entre runs. Adicionado include explícito de
  `@tauri-apps/api/event`, `@tauri-apps/api/webviewWindow`,
  `@tauri-apps/api/window` e `@tauri-apps/plugin-global-shortcut`
  pra força bruta no pre-bundle do boot. Defesa contra esse vetor
  voltar a aparecer pra outras APIs Tauri.

### Viewer de documentos office (#81) — 2026-06-11

- ✅ **DOCX/XLSX/TXT/CSV abrem dentro da PreviewScreen.** Antes,
  esses tipos caíam no fallback "Pré-visualização não suportada —
  use Baixar". Agora cada um tem um viewer dedicado dentro da
  janela preview. Tipos não-office (e.g. RTF, ODT) continuam com
  o fallback.
- ✅ **`src/lib/officeRender.ts`.** Funções `renderDocxAsHtml`,
  `renderXlsxAsSheets`, `renderTextFile` que aceitam signed URL,
  fazem fetch como `Uint8Array` e usam as mesmas libs do pipeline
  de extração pra IA — `mammoth.convertToHtml` (que devolve HTML
  com formatação, vs `extractRawText` usado pra IA),
  `read-excel-file/web-worker` (linhas por aba). Lazy import,
  zero impacto no bundle inicial. Também tem `parseCsv` próprio
  pra CSV com aspas duplas.
- ✅ **Componentes na PreviewScreen.** `DocxView` renderiza o
  HTML sanitizado (DOMPurify) num container `bg-white max-w-3xl`
  estilo página de Word. `XlsxView` tem **tabs de abas** quando
  há mais de uma planilha + `<table>` com header sticky e
  numeração de linhas. `CsvView` reusa o `SheetTable`.
  `PlainTextView` é `<pre>` monoespaçado. Loading e error states
  comuns via hook `useAsyncResource(loader, key)`.

#### Hardening pós-feedback (2026-06-11):

- ✅ **XLSX: normalização do retorno de `read-excel-file`.** A lib
  às vezes devolve `{ rows, errors }` em vez de `Row[]` puro
  (depende da versão e do formato do arquivo). `renderXlsxAsSheets`
  agora normaliza pra `Cell[][]` e garante que cada linha é uma
  array — sem isso, `header.map(...)` no `SheetTable` lançava
  TypeError com planilhas em formato inesperado.
- ✅ **XLSX: API v9 do `read-excel-file` — 2026-06-11.** A
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
- ✅ **#81 fechado — 2026-06-11.** XLSX, DOCX, CSV e TXT abrindo
  certinho na PreviewScreen, com tabs de abas e formatação. Pronto
  pra distribuição beta.
- ✅ **`SheetTable` com guards.** Se `header` não for array mesmo
  após normalização, mostra "Planilha em formato não suportado"
  em vez de crashar.
- ✅ **`ViewerErrorBoundary` em volta dos viewers.** Class
  component minimalista (`getDerivedStateFromError` +
  `componentDidCatch`) que captura throws de qualquer viewer e
  exibe o `ErrorPane`. Reset via `key={payload.url}` — toda troca
  de arquivo monta um boundary novo, sem estado de erro herdado.
  Antes, um crash em planilha deixava a árvore React em estado
  ruim e os próximos arquivos abertos também não montavam direito.

### Bug pré-existente corrigido

- ✅ **Tiptap: extensão `link` duplicada — 2026-06-11.** StarterKit
  v3 já inclui `Link` por padrão e a gente registrava `Link` de
  novo no `RichTextEditor` pra setar `autolink`, `linkOnPaste` e
  classes custom. Resultado: warning `[tiptap warn]: Duplicate
  extension names found: ['link']` em todo render. Desligado o
  Link do StarterKit (`link: false`) — nossa config custom segue
  sendo a única em uso.
- ✅ **Global shortcut Esc abria a captura — 2026-06-11.** O
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

- ✅ **Drag-drop reabilitado (#83) — 2026-06-10.** Funcionou após
  a migração do Font Awesome do Kit pro pacote npm (Sprint 11):
  o Kit injetava `<svg>` no lugar de `<i>` em runtime e
  cascateava num `NotFoundError` do React 19 que quebrava o
  listener `tauri://drag-drop`. Sem o Kit, o handler sobrevive
  e o drop funciona normal.

- ✅ **Font Awesome — Kit→npm — 2026-06-08.** Migrado de
  `https://kit.fontawesome.com/...js` pra
  `@fortawesome/fontawesome-free` (CSS + webfont, zero
  manipulação de DOM). O Kit em modo SVG conflitava com o
  reconciler do React 19 (cascateava `NotFoundError`). Import
  em `src/main.tsx`: `import "@fortawesome/fontawesome-free/css/all.min.css"`.
  Kit script + bloco `window.FontAwesomeConfig` removidos do
  `index.html`.

### Identidade visual

- ✅ **Ícone do app atualizado pra logo-icone.png — 2026-06-11.**
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
- ✅ **Tray icon colorido — 2026-06-11.** `icon_as_template(true)`
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

- ✅ **Testes removidos do projeto — 2026-06-11.** Apagados todos
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

- ✅ **Em-dash no productName quebrava o `latest.json`.** Na release
  v0.1.2 o `tauri-action` logou `Signature not found for the updater
  JSON. Skipping upload...` em ambos os jobs (macOS e Windows), e o
  `latest.json` não foi anexado. Resultado: o endpoint do updater
  (`releases/latest/download/latest.json`) ficou retornando 404 —
  auto-update silenciosamente quebrado. Causa raiz: o caractere `—`
  (em-dash, U+2014) no `productName: "TNG Sites — Demandas"` parece
  confundir a lógica de matching de arquivo .sig no tauri-action.
  Na v0.1.1 (nome era "TNG Demand Hub", sem em-dash) funcionava.
- ✅ **Fix: em-dash trocado por hífen ASCII em 6 lugares.**
  `tauri.conf.json` (`productName` + `windows[0].title`),
  `index.html` (`<title>`), `src-tauri/src/lib.rs` (header comment,
  menu item "Abrir TNG Sites - Demandas", tray tooltip).
- ✅ **Bump 0.1.2 → 0.1.3 e novo release.** v0.1.2 fica como
  histórico mas não pode ser usada como base de auto-update.

### Hotfix do build de produção (v0.1.4) — 2026-06-12

- ✅ **`fetch failed` no login após instalar release.** O `release.yml`
  não passava `VITE_SUPABASE_URL` nem `VITE_SUPABASE_ANON_KEY` como
  env vars pro step do `tauri-action`. O `vite build` no GitHub
  Actions rodava sem essas vars, então `import.meta.env.VITE_SUPABASE_URL`
  ficava `undefined` e o `client.ts` caía no fallback
  `https://placeholder.supabase.co`. Qualquer fetch → ENOTFOUND. O
  bug só apareceu agora porque até v0.1.3 ninguém tinha testado o
  binário distribuído (sempre testava via `tauri dev`, que lê
  `.env.local`).
- ✅ **Fix: secrets `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
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

- ✅ **Project ref do Supabase removido do CLAUDE.md.** Estava em 4
  lugares: bloco de comandos úteis, seção "Configuração do Supabase
  remoto", link do painel. Substituído por placeholder `$SUPABASE_PROJECT_REF`
  + nota de que o valor real está no `.env.local`. (Tecnicamente o ref
  vai no binário via `VITE_SUPABASE_URL`, mas defense in depth — não
  precisa estar em texto puro no repo público.)
- ✅ **Nomes de clientes reais anonimizados** na Edge Function
  `extract-demand/index.ts` (27 ocorrências) e no CLAUDE.md. "Bruning
  Homes" → "Cliente Beta", "Acme" → "Cliente Alfa". Não afeta a
  classificação da IA (são só few-shots), mas evita expor relação
  comercial real.
- ✅ **Menções a username pessoal ("cardoso.webdesign") sanitizadas**
  no CLAUDE.md — substituído por "admin inicial" / "owner".
- ✅ **CSP ativado no `tauri.conf.json`.** Antes era `csp: null`
  (permite qualquer fetch/script). Agora whitelist específica:
  `default-src 'self'`, `connect-src` só pro Supabase + GitHub
  releases, `script-src` com `'unsafe-inline'` (Vite precisa),
  `style-src` + `font-src` pro Google Fonts. Protege contra XSS se
  algum input não sanitizado chegar no DOM.
- ✅ **README.md reescrito.** Saiu o template padrão do Tauri
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

## Regras para você (Claude Code)

1. Antes de implementar algo grande, **consulte o PRD** (`../prd_projeto-TNG-Digital.md`) — ele tem schema, fluxos detalhados e prompts da IA.
2. Mantenha as **convenções acima** rigorosamente. Se precisar quebrar uma, justifique aqui e atualize a seção.
3. Sempre que adicionar dependência ou criar pasta nova, **atualize este arquivo**.
4. Não invente arquivos ou paths. Se não souber onde algo está, pergunte ou explore primeiro.
5. Mantenha tipos TypeScript fortes — `any` apenas com comentário justificando.
6. **Nunca** commite `.env.local` nem chaves de API.
