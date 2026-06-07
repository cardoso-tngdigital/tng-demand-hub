import { useEffect, useState } from "react";
import { checkForUpdate, type UpdateInfo } from "../lib/updater";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function doCheck() {
      const info = await checkForUpdate();
      if (cancelled) return;
      if (info) setUpdate(info);
    }
    void doCheck();
    const id = window.setInterval(() => void doCheck(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!update || dismissed) return null;

  async function handleInstall() {
    if (!update) return;
    setInstalling(true);
    setError(null);
    try {
      await update.apply();
      // Se chegou aqui, deveria ter reiniciado; mantém estado por garantia.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-tng-orange-400/30 bg-tng-orange-400/10 px-6 py-2 text-[11px] text-tng-orange-200">
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium">Nova versão disponível: v{update.version}</span>
        {update.notes && <span className="ml-2 text-tng-marine-300">— {update.notes}</span>}
        {error && <span className="ml-2 text-red-300">· {error}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="rounded-md bg-tng-orange-400 px-2.5 py-1 text-[11px] font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {installing ? "Baixando…" : "Atualizar e reiniciar"}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-tng-marine-300 hover:text-tng-marine-100"
          aria-label="Adiar"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />        </button>
      </div>
    </div>
  );
}
