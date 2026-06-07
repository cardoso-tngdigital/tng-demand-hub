import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import logoDark from "../assets/brand/logo-dark.png";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen items-center justify-center bg-tng-marine-900 px-6"
    >
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center">
          <img
            src={logoDark}
            alt="TNG Digital"
            className="h-16 w-auto select-none"
            draggable={false}
          />
          <p className="mt-4 text-sm text-tng-marine-200">Sites — Demandas</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-tng-marine-600 bg-tng-marine-700 p-6 shadow-2xl shadow-black/30"
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-xs font-medium text-tng-marine-100">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-lg border border-tng-marine-600 bg-tng-marine-800 px-3 py-2 text-sm text-tng-marine-50 placeholder:text-tng-marine-300 focus:border-tng-orange-400 focus:outline-none focus:ring-2 focus:ring-tng-orange-400/30"
              placeholder="voce@tngdigital.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-xs font-medium text-tng-marine-100">
              Senha
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-lg border border-tng-marine-600 bg-tng-marine-800 px-3 py-2 text-sm text-tng-marine-50 placeholder:text-tng-marine-300 focus:border-tng-orange-400 focus:outline-none focus:ring-2 focus:ring-tng-orange-400/30"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="block w-full rounded-lg bg-tng-orange-400 px-4 py-2.5 text-sm font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 active:bg-tng-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-tng-marine-300">
          Sistema interno da TNG Digital. Acesso restrito à equipe.
        </p>
      </div>
    </div>
  );
}
