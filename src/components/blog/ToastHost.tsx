// =============================================================================
// ToastHost — renderiza a pilha de toasts flutuantes no topo direito
// =============================================================================
// Montado uma única vez dentro do BlogPanel. Assina o bus de `toast.ts` e
// cuida do auto-descarte por toast. z-[60] pra ficar acima do painel (z-40)
// e dos drawers/modais (z-50).
// =============================================================================

import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  dismissToast,
  subscribeToasts,
  type Toast,
  type ToastTipo,
} from "../../lib/toast";

const TIPO_STYLE: Record<
  ToastTipo,
  { icon: string; cls: string; bar: string }
> = {
  info: {
    icon: "fa-circle-info",
    cls: "border-blue-500/40 bg-tng-marine-800",
    bar: "bg-blue-400",
  },
  success: {
    icon: "fa-circle-check",
    cls: "border-emerald-500/40 bg-tng-marine-800",
    bar: "bg-emerald-400",
  },
  warning: {
    icon: "fa-triangle-exclamation",
    cls: "border-amber-500/40 bg-tng-marine-800",
    bar: "bg-amber-400",
  },
  error: {
    icon: "fa-circle-xmark",
    cls: "border-red-500/40 bg-tng-marine-800",
    bar: "bg-red-400",
  },
};

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const style = TIPO_STYLE[toast.tipo] ?? TIPO_STYLE.info;
  const duracao = toast.duracao ?? 6000;

  useEffect(() => {
    if (duracao <= 0) return;
    const id = setTimeout(() => dismissToast(toast.id), duracao);
    return () => clearTimeout(id);
  }, [toast.id, duracao]);

  return (
    <div
      className={`pointer-events-auto overflow-hidden rounded-lg border ${style.cls} shadow-xl`}
      role="status"
    >
      <div className="flex items-start gap-3 p-3">
        <div className={`mt-0.5 h-full w-1 shrink-0 rounded-full ${style.bar}`} />
        <i
          className={`fa-solid ${style.icon} mt-0.5 text-sm ${style.bar.replace("bg-", "text-")}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-tng-marine-50">
            {toast.titulo}
          </p>
          {toast.mensagem && (
            <p className="mt-0.5 break-words text-xs text-tng-marine-300">
              {toast.mensagem}
            </p>
          )}
          {toast.postUrl && (
            <button
              type="button"
              onClick={() => {
                if (toast.postUrl) void openUrl(toast.postUrl);
              }}
              className="mt-1.5 text-xs font-medium text-tng-orange-300 hover:underline"
            >
              Abrir post{" "}
              <i
                className="fa-solid fa-arrow-up-right-from-square"
                aria-hidden="true"
              />
            </button>
          )}
          {toast.acao && (
            <button
              type="button"
              onClick={() => {
                toast.acao?.onClick();
                dismissToast(toast.id);
              }}
              className="mt-1.5 rounded-md border border-tng-orange-400/60 px-2 py-0.5 text-xs font-medium text-tng-orange-300 transition hover:bg-tng-orange-400/10"
            >
              {toast.acao.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => dismissToast(toast.id)}
          aria-label="Fechar"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-tng-marine-400 hover:bg-tng-marine-700 hover:text-tng-marine-100"
        >
          <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
