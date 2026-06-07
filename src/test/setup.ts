// =============================================================================
// Setup global do Vitest
// =============================================================================
// Roda uma vez antes de cada arquivo de teste. Registra:
//   - Matchers do jest-dom (toBeInTheDocument, toHaveTextContent, etc.)
//   - Mocks padrão dos clientes externos (Supabase, Tauri APIs) — testes
//     individuais podem sobrescrever com vi.mocked(...).mockReturnValue(...)
// =============================================================================

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Limpa o DOM entre testes — sem isso, componentes renderizados num teste
// vazam pro próximo e quebram queries.
afterEach(() => {
  cleanup();
});

// crypto.randomUUID() é nativo no Node 19+, mas alguns testes podem
// querer determinismo. Não mockamos por padrão; testes que dependem
// disso devem sobrescrever.

// -----------------------------------------------------------------------------
// Mock do cliente Supabase
// -----------------------------------------------------------------------------
// Por padrão devolve respostas "vazias" pra qualquer chamada. Testes que
// exercitam fluxos com dados precisam usar vi.mocked(supabase.from)... pra
// sobrescrever caso por caso.

vi.mock("../lib/supabase/client", () => {
  const builder = () => {
    const chain = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      upsert: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (cb: (v: { data: unknown[]; error: null }) => unknown) =>
        cb({ data: [], error: null }),
    };
    return chain;
  };

  return {
    supabase: {
      from: vi.fn(builder),
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({ data: { user: null }, error: null }),
        ),
        getSession: vi.fn(() =>
          Promise.resolve({ data: { session: null }, error: null }),
        ),
        signInWithPassword: vi.fn(() =>
          Promise.resolve({ data: { user: null, session: null }, error: null }),
        ),
        signOut: vi.fn(() => Promise.resolve({ error: null })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
      },
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      })),
      removeChannel: vi.fn(() => Promise.resolve("ok")),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(() => Promise.resolve({ data: { path: "x" }, error: null })),
          download: vi.fn(() => Promise.resolve({ data: new Blob(), error: null })),
          createSignedUrl: vi.fn(() =>
            Promise.resolve({ data: { signedUrl: "https://signed" }, error: null }),
          ),
          remove: vi.fn(() => Promise.resolve({ data: null, error: null })),
          move: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      },
      functions: {
        invoke: vi.fn(() => Promise.resolve({ data: null, error: null })),
      },
    },
  };
});

// -----------------------------------------------------------------------------
// Mock das APIs do Tauri
// -----------------------------------------------------------------------------
// invoke() é chamado em vários lugares (hide_capture_window, set_tray_badge,
// read_file_bytes). Mockamos com no-op por padrão.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
    show: vi.fn(),
    hide: vi.fn(),
    setFocus: vi.fn(),
  })),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve("granted")),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));
