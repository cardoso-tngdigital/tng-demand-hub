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

# Supabase (CLI local)
supabase migration new <nome>      # Cria nova migração vazia
supabase db push                    # Aplica migrações no projeto remoto (após link)
supabase link --project-ref rczvkarulymulmkxolez   # Linka ao projeto remoto
```

## Configuração do Supabase remoto

- **Project Ref:** `rczvkarulymulmkxolez`
- **URL:** `https://rczvkarulymulmkxolez.supabase.co`
- **Região:** `sa-east-1` (São Paulo)
- **Painel:** https://supabase.com/dashboard/project/rczvkarulymulmkxolez

## GitHub

- **Repositório:** https://github.com/cardoso-tngdigital/tng-demand-hub (privado)
- **Secrets configurados:** `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`.

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
service_role key (cardoso.webdesign foi promovido em 2026-06-05).

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

### Próxima fase

- Fase 3 — Tema claro/escuro funcional (já há `profiles.theme`,
  falta aplicar no html dinamicamente + revisar tokens)

Code signing macOS foi descartado do escopo — para o uso interno da
TNG, o "Cmd+click → Abrir" na primeira execução é suficiente.

## Regras para você (Claude Code)

1. Antes de implementar algo grande, **consulte o PRD** (`../prd_projeto-TNG-Digital.md`) — ele tem schema, fluxos detalhados e prompts da IA.
2. Mantenha as **convenções acima** rigorosamente. Se precisar quebrar uma, justifique aqui e atualize a seção.
3. Sempre que adicionar dependência ou criar pasta nova, **atualize este arquivo**.
4. Não invente arquivos ou paths. Se não souber onde algo está, pergunte ou explore primeiro.
5. Mantenha tipos TypeScript fortes — `any` apenas com comentário justificando.
6. **Nunca** commite `.env.local` nem chaves de API.
