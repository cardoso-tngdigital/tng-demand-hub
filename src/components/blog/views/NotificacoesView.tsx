// =============================================================================
// NotificacoesView — histórico de eventos do Blog (2026-07-04)
// =============================================================================
// Lista notificações persistidas em `blog.notificacoes`. Aceita marcar
// como lida individualmente ou em lote, e apagar as lidas.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { blogFetch } from "../../../lib/blogClient";
import type {
  BlogNotificacao,
  BlogNotificacaoTipo,
} from "../../../types/blog";

const TIPO_STYLE: Record<
  BlogNotificacaoTipo,
  { icon: string; cls: string; label: string }
> = {
  info: {
    icon: "fa-circle-info",
    cls: "text-blue-300 bg-blue-500/10 border-blue-500/40",
    label: "Info",
  },
  success: {
    icon: "fa-circle-check",
    cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/40",
    label: "Sucesso",
  },
  warning: {
    icon: "fa-triangle-exclamation",
    cls: "text-amber-300 bg-amber-500/10 border-amber-500/40",
    label: "Aviso",
  },
  error: {
    icon: "fa-circle-xmark",
    cls: "text-red-300 bg-red-500/10 border-red-500/40",
    label: "Erro",
  },
};

function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificacoesView() {
  const [itens, setItens] = useState<BlogNotificacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroNaoLidas, setFiltroNaoLidas] = useState<boolean>(false);

  const carregar = useCallback(async () => {
    try {
      const res = await blogFetch<{ notificacoes: BlogNotificacao[] }>(
        `/api/notificacoes${filtroNaoLidas ? "?nao_lidas=1" : ""}`,
      );
      setItens(res.notificacoes);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [filtroNaoLidas]);

  useEffect(() => {
    void carregar();
    // Refresh a cada 15s pra pegar eventos do scheduler em background.
    const id = setInterval(() => void carregar(), 15_000);
    return () => clearInterval(id);
  }, [carregar]);

  async function marcarComoLida(id: string) {
    try {
      await blogFetch(`/api/notificacoes/${id}/lida`, { method: "POST" });
      setItens((prev) =>
        prev.map((n) => (n.id === id ? { ...n, lida: true } : n)),
      );
    } catch (e) {
      console.warn("[notificacoes] falha ao marcar como lida", e);
    }
  }

  async function marcarTodasComoLidas() {
    try {
      await blogFetch("/api/notificacoes/lidas", { method: "POST" });
      setItens((prev) => prev.map((n) => ({ ...n, lida: true })));
    } catch (e) {
      window.alert(
        `Falha: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      );
    }
  }

  async function limparLidas() {
    try {
      await blogFetch("/api/notificacoes/lidas", { method: "DELETE" });
      setItens((prev) => prev.filter((n) => !n.lida));
    } catch (e) {
      window.alert(
        `Falha: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      );
    }
  }

  const naoLidas = itens.filter((n) => !n.lida).length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
            Notificações
            {naoLidas > 0 && (
              <span className="ml-2 rounded-full bg-tng-orange-400 px-2 py-0.5 text-[10px] font-semibold text-tng-marine-900">
                {naoLidas}
              </span>
            )}
          </h3>
          <p className="mt-1 text-xs text-tng-marine-400">
            Eventos do Blog — publicações, falhas do scheduler, agendamentos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-md border border-tng-marine-600 bg-tng-marine-900 px-2.5 py-1 text-xs text-tng-marine-200">
            <input
              type="checkbox"
              checked={filtroNaoLidas}
              onChange={(e) => setFiltroNaoLidas(e.target.checked)}
              className="accent-tng-orange-400"
            />
            Só não lidas
          </label>
          {naoLidas > 0 && (
            <button
              type="button"
              onClick={() => void marcarTodasComoLidas()}
              className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-300"
            >
              <i
                className="fa-solid fa-check-double mr-1"
                aria-hidden="true"
              />
              Marcar todas
            </button>
          )}
          <button
            type="button"
            onClick={() => void limparLidas()}
            className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-200 transition hover:border-red-500/40 hover:text-red-300"
          >
            <i className="fa-solid fa-broom mr-1" aria-hidden="true" />
            Limpar lidas
          </button>
        </div>
      </div>

      {erro && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-tng-marine-300">Carregando…</p>
      ) : itens.length === 0 ? (
        <div className="rounded-lg border border-dashed border-tng-marine-600 p-8 text-center">
          <p className="text-sm text-tng-marine-300">
            {filtroNaoLidas
              ? "Nenhuma notificação não lida."
              : "Ainda não há notificações. Elas aparecem aqui quando o Blog publica ou falha algo."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {itens.map((n) => {
            const style = TIPO_STYLE[n.tipo] ?? TIPO_STYLE.info;
            const postUrl =
              typeof n.contexto?.["post_url"] === "string"
                ? (n.contexto["post_url"] as string)
                : null;
            return (
              <li
                key={n.id}
                className={`rounded-lg border ${
                  n.lida
                    ? "border-tng-marine-700 bg-tng-marine-800/40 opacity-70"
                    : "border-tng-marine-600 bg-tng-marine-800/60"
                } p-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${style.cls}`}
                      >
                        <i
                          className={`fa-solid ${style.icon}`}
                          aria-hidden="true"
                        />
                        {style.label}
                      </span>
                      <span className="text-[11px] text-tng-marine-500">
                        {fmtData(n.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-tng-marine-50">
                      {n.titulo}
                    </p>
                    <p className="mt-0.5 text-xs text-tng-marine-300">
                      {n.mensagem}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {postUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          void openUrl(postUrl);
                        }}
                        className="text-xs font-medium text-tng-orange-300 hover:underline"
                      >
                        Abrir post{" "}
                        <i
                          className="fa-solid fa-arrow-up-right-from-square"
                          aria-hidden="true"
                        />
                      </button>
                    )}
                    {!n.lida && (
                      <button
                        type="button"
                        onClick={() => void marcarComoLida(n.id)}
                        className="rounded-md border border-tng-marine-600 px-2 py-0.5 text-[11px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-300"
                      >
                        Marcar como lida
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
