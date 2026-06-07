// =============================================================================
// Configuração do Vitest — runner de testes do TNG Demand Hub
// =============================================================================
// Arquivo separado do vite.config.ts pra que a config do dev server do Tauri
// (porta fixa, host IPv4) não afete o ambiente de testes. O Vitest usa o
// mesmo pipeline do Vite (resolve aliases, plugins, etc.).
// =============================================================================

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom emula um DOM completo no Node — necessário pra Testing Library.
    environment: "jsdom",
    // Roda antes de cada arquivo de teste — registra matchers do jest-dom
    // e mocks globais (Supabase, Tauri APIs).
    setupFiles: ["./src/test/setup.ts"],
    // Detecta .test.ts e .test.tsx co-localizados (preferimos arquivos de
    // teste ao lado do código fonte em vez de pasta __tests__).
    include: ["src/**/*.test.{ts,tsx}"],
    // Sem `watch: false` aqui — o Vitest decide pelo subcomando: `vitest`
    // entra em watch, `vitest run` é one-shot. Forçar `false` no config
    // anulava o watch do `npm test`.
    css: false,
    // Restore mocks entre testes pra isolar comportamento.
    restoreMocks: true,
    clearMocks: true,
  },
});
