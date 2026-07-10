import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { LoginScreen } from "./screens/LoginScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { CaptureScreen } from "./screens/CaptureScreen";
import { PreviewScreen } from "./screens/PreviewScreen";
import { applyHotkey, migrateHotkeyConfigIfNeeded } from "./lib/hotkey";

function MainApp() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-tng-marine-900">
        <div className="text-sm text-tng-marine-300">Carregando…</div>
      </div>
    );
  }

  return session ? <DashboardScreen /> : <LoginScreen />;
}

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("main");
  const [bootError, setBootError] = useState<string | null>(null);

  // Atalho pra abrir o inspetor/console em QUALQUER janela (main, capture,
  // preview) — inclusive no app empacotado (a feature `devtools` no
  // Cargo.toml habilita em release). F12 / Ctrl+Shift+I / Cmd+Alt+I.
  //
  // IMPORTANTE (2026-07-10): NÃO damos `preventDefault` no F12. No Windows o
  // WebView2 tem F12 NATIVO (que a feature devtools habilita); o
  // preventDefault da versão anterior BLOQUEAVA esse nativo e o F12 não abria
  // nada. Sem preventDefault, o nativo funciona no Windows e o invoke abre no
  // macOS (que não tem F12 nativo). Caminho garantido em qualquer caso:
  // menu do tray → "Abrir Console".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo =
        e.key === "F12" ||
        ((e.ctrlKey || e.metaKey) &&
          e.shiftKey &&
          (e.key === "I" || e.key === "i")) ||
        (e.metaKey && e.altKey && (e.key === "I" || e.key === "i"));
      if (combo) {
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("open_devtools").catch((err) =>
            console.error("[devtools] falha ao abrir:", err),
          ),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const label = getCurrentWindow().label;
        setWindowLabel(label);
        // Só a janela main pilota o atalho global — a janela capture é
        // criada/escondida pelo Rust e não tem dependência da preferência.
        if (label === "main") {
          migrateHotkeyConfigIfNeeded();
          void applyHotkey();
        }
      } catch (err) {
        console.error("[App] erro ao detectar janela:", err);
        setBootError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  if (bootError) {
    return (
      <div className="flex h-screen items-center justify-center bg-tng-marine-900 p-6">
        <div className="max-w-md text-center">
          <h1 className="font-sans text-xl font-semibold text-tng-orange-400">
            Erro ao iniciar
          </h1>
          <pre className="mt-3 whitespace-pre-wrap text-xs text-tng-marine-200">
            {bootError}
          </pre>
        </div>
      </div>
    );
  }

  if (windowLabel === "capture") {
    return <CaptureScreen />;
  }

  if (windowLabel === "preview") {
    return <PreviewScreen />;
  }

  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}

export default App;
