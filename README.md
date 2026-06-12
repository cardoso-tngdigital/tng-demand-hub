# TNG Sites — Demandas

App desktop interno do time **TNG Digital** pra gestão de demandas com
captura rápida (Cmd/Ctrl + Shift + D), extração estruturada via IA e
distribuição automática para os responsáveis.

> ⚠️ Ferramenta interna. Builds são distribuídos só para membros do time
> via [Releases do GitHub](../../releases). Signup público está
> desabilitado no Supabase — contas são criadas pelo admin.

## Instalação (pros membros)

Baixar o instalador correspondente da
[release mais recente](../../releases/latest):

### Windows
1. Baixar `TNG.Sites-Demandas_X.Y.Z_x64-setup.exe`
2. Duplo-clique no instalador
3. Aviso "Windows protegeu seu PC" → **Mais informações** → **Executar
   mesmo assim** (app não é assinado por CA paga)
4. Após instalar, abrir pelo menu Iniciar e fazer login com as
   credenciais fornecidas pelo admin

### macOS (Apple Silicon — M1/M2/M3/M4)
1. Baixar `TNG.Sites-Demandas_X.Y.Z_aarch64.dmg`
2. Abrir o DMG, arrastar o app para **Aplicativos**
3. **Importante** — abrir o Terminal e rodar:
   ```bash
   xattr -cr "/Applications/TNG Sites - Demandas.app"
   ```
   (Remove a flag de quarentena — o app não é notarizado pela Apple)
4. Abrir pelo Launchpad e fazer login

### macOS (Intel)
1. Baixar `TNG.Sites-Demandas_X.Y.Z_x64.dmg`
2. Mesmo passo a passo do Apple Silicon

### Atualizações automáticas
Depois da primeira instalação, o app verifica atualizações
automaticamente. Quando uma nova versão sair, ele baixa em background e
oferece reiniciar pra aplicar. Não precisa reinstalar manualmente.

---

## Setup de desenvolvimento (admin)

### Pré-requisitos
- Node.js 20+
- Rust stable (`rustup`)
- Supabase CLI
- Acesso ao projeto Supabase do TNG (chaves no `.env.local`)

### Instalação
```bash
git clone https://github.com/cardoso-tngdigital/tng-demand-hub.git
cd tng-demand-hub
npm install
cp .env.example .env.local        # preencher com chaves reais
npm run tauri dev                 # roda o app em modo dev
```

### Scripts
- `npm run dev` — Vite dev server (browser)
- `npm run tauri dev` — App desktop em modo dev (hot reload)
- `npm run tauri build` — Build de produção (gera DMG/EXE/MSI)
- `npx tsc --noEmit` — Type-check

### Stack
- Tauri 2 (Rust + WebView) — shell desktop
- React 19 + TypeScript + Vite — UI
- Tailwind 4 — estilos
- Supabase — auth, banco PostgreSQL, storage, realtime
- Edge Functions (Deno) — integração Gemini AI
- Tiptap 3 — editor rico de comentários

### Distribuição
Pushar uma tag `v*` (ex.: `v0.2.0`) dispara o workflow
`.github/workflows/release.yml` que builda Windows/Mac e publica como
GitHub Release com auto-update assinado.

```bash
# Após bump em package.json e tauri.conf.json:
git tag -a v0.2.0 -m "v0.2.0 — descrição"
git push origin v0.2.0
```

## Licença
Uso interno TNG Digital — sem licença de uso público.
