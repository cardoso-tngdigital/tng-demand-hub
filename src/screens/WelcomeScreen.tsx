import { useAuth } from "../hooks/useAuth";
import logoDark from "../assets/brand/logo-dark.png";

export function WelcomeScreen() {
  const { user, signOut } = useAuth();

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen flex-col bg-tng-marine-900"
    >
      <header className="flex items-center justify-between border-b border-tng-marine-600 px-6 py-4">
        <div className="flex items-center gap-3">
          <img src={logoDark} alt="TNG Digital" className="h-8 w-auto" draggable={false} />
          <span className="text-sm text-tng-marine-200">Demand Hub</span>
        </div>
        <button
          onClick={signOut}
          className="rounded-md border border-tng-marine-600 px-3 py-1.5 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
        >
          Sair
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-sans text-3xl font-bold text-tng-marine-50">
            Bem-vindo ao TNG Demand Hub
          </h1>
          <p className="mt-3 text-sm text-tng-marine-200">
            Você está logado como{" "}
            <span className="font-medium text-tng-orange-400">{user?.email}</span>.
          </p>
          <p className="mt-6 text-xs text-tng-marine-300">
            Esta é a versão inicial do Sprint 1. O atalho global de captura, dashboard e
            integração com IA serão implementados nos próximos sprints.
          </p>
        </div>
      </main>
    </div>
  );
}
