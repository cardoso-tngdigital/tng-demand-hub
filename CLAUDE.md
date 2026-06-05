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
| IA | Google Gemini 2.0 Flash (via Edge Function, futuro) |

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

## Próximo: Sprint 4 — Integração com Gemini (IA Extratora)

Ver seção 11.2 do PRD. Entregas previstas:

- Edge Function `extract-demand` no Supabase chamando Gemini 2.0 Flash.
- Prompt v1 do extrator (ver seção 9.2 do PRD).
- Validação do JSON retornado e fallback para captura manual.
- Tela de confirmação editável com campos extraídos.
- Tabela `ai_usage_log` para controle de custo.

## Regras para você (Claude Code)

1. Antes de implementar algo grande, **consulte o PRD** (`../prd_projeto-TNG-Digital.md`) — ele tem schema, fluxos detalhados e prompts da IA.
2. Mantenha as **convenções acima** rigorosamente. Se precisar quebrar uma, justifique aqui e atualize a seção.
3. Sempre que adicionar dependência ou criar pasta nova, **atualize este arquivo**.
4. Não invente arquivos ou paths. Se não souber onde algo está, pergunte ou explore primeiro.
5. Mantenha tipos TypeScript fortes — `any` apenas com comentário justificando.
6. **Nunca** commite `.env.local` nem chaves de API.
