import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { LoginScreen } from "./screens/LoginScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { CaptureScreen } from "./screens/CaptureScreen";

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

  useEffect(() => {
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        setWindowLabel(getCurrentWindow().label);
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

  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}

export default App;
