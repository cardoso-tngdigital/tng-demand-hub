import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Garante que as APIs Tauri usadas em janelas secundárias (preview,
  // capture) entram no pre-bundle do Vite. Sem isso, módulos importados
  // só por essas rotas demoram pra ser descobertos e a primeira requisição
  // devolve 504 "Outdated Optimize Dep", quebrando o carregamento.
  optimizeDeps: {
    include: [
      "@tauri-apps/api/event",
      "@tauri-apps/api/webviewWindow",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-global-shortcut",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // Porta trocada de 1420 pra 5173 em 2026-06-08: a 1420 ficou em
    // estado inutilizável (Vite não startava nem com lsof/pkill — algum
    // processo zumbi ou bloqueio do macOS segurava ela em silêncio).
    port: 5173,
    strictPort: true,
    // Força IPv4 (127.0.0.1) para evitar conflito IPv4/IPv6 no macOS
    // que faz o webview do Tauri dar timeout ao acessar "localhost".
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
