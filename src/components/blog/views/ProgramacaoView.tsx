// =============================================================================
// ProgramacaoView — agendamentos futuros no Blog (Sprint 27)
// =============================================================================
// Lista tudo que está esperando pra rodar (ou já rodou) do agendamento.
// Auto-refresh a cada 5s pra pegar mudanças do scheduler (status muda de
// pendente → executando → concluido conforme o backend executa).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { blogFetch } from "../../../lib/blogClient";
import type { BlogAgendamento, BlogSite } from "../../../types/blog";

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Agendado", cls: "bg-blue-500/20 text-blue-300" },
  executando: { label: "Executando", cls: "bg-amber-500/20 text-amber-300" },
  falhou: { label: "Falhou", cls: "bg-red-500/20 text-red-300" },
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

/**
 * Props:
 * - `fixedSiteId` — quando presente, filtra a listagem para aquele site
 *   (usado dentro do drawer de detalhe do site). Esconde o nome do site
 *   nos cards, já que fica redundante.
 */
export function ProgramacaoView({ fixedSiteId }: { fixedSiteId?: string } = {}) {
  const [agendamentos, setAgendamentos] = useState<BlogAgendamento[]>([]);
  const [sites, setSites] = useState<BlogSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  // Confirmação inline em 2 cliques (mesmo motivo da SitesView:
  // `window.confirm` é bloqueado pelo Tauri sem `dialog:confirm`).
  const [confirmandoCancelId, setConfirmandoCancelId] = useState<string | null>(
    null,
  );

  // Guard anti-overlap: não dispara um novo poll enquanto o anterior está
  // no ar (o poll de 5s podia empilhar se o sidecar demorasse).
  const pollandoRef = useRef<boolean>(false);

  const carregar = useCallback(async () => {
    if (pollandoRef.current) return;
    pollandoRef.current = true;
    try {
      // No drawer (fixedSiteId), filtramos os agendamentos NO SERVIDOR via
      // `?site_id=` — antes puxávamos TODOS os agendamentos e filtrávamos no
      // cliente, o que ficou lento conforme a base cresceu (feedback
      // 2026-07-09). E não buscamos `/api/sites`: o nome do site já está no
      // cabeçalho do drawer, então o mapa é dispensável aqui.
      const ag = await blogFetch<{ agendamentos: BlogAgendamento[] }>(
        `/api/agendamentos${
          fixedSiteId !== undefined
            ? `?site_id=${encodeURIComponent(fixedSiteId)}`
            : ""
        }`,
      );
      if (fixedSiteId === undefined) {
        const ss = await blogFetch<{ sites: BlogSite[] }>("/api/sites");
        setSites(ss.sites);
      }
      // Concluídos SOMEM daqui — publicado vive só no Histórico. Ficam:
      // pendente (agendado), executando e falhou (com motivo, até excluir).
      setAgendamentos(
        ag.agendamentos.filter((a) => a.status !== "concluido"),
      );
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
      pollandoRef.current = false;
    }
  }, [fixedSiteId]);

  // Sonda o health uma vez pra avisar quando o agendador está desligado —
  // sem isso o operador programa posts que nunca serão publicados e só
  // descobre dias depois (aconteceu em 2026-07-08/09).
  const [schedulerAtivo, setSchedulerAtivo] = useState<boolean | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const h = await blogFetch<{ scheduler?: boolean }>("/api/health");
        setSchedulerAtivo(h.scheduler ?? null);
      } catch {
        // silencioso — health é diagnóstico, não bloqueia a view
      }
    })();
  }, []);

  useEffect(() => {
    void carregar();
    // Refresh a cada 5s enquanto o painel estiver visível.
    const id = setInterval(() => void carregar(), 5000);
    return () => clearInterval(id);
  }, [carregar]);

  const siteMap = useMemo(() => {
    const m = new Map<string, BlogSite>();
    for (const s of sites) m.set(s.id, s);
    return m;
  }, [sites]);

  async function cancelar(id: string) {
    setCancelandoId(id);
    try {
      await blogFetch(`/api/agendamentos/${id}`, { method: "DELETE" });
      setAgendamentos((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      window.alert(
        `Falha ao cancelar: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      );
    } finally {
      setCancelandoId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
            Programação
          </h3>
          <p className="mt-1 text-xs text-tng-marine-400">
            Artigos agendados para os próximos dias. Atualiza automaticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void carregar()}
          className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-300"
        >
          <i className="fa-solid fa-rotate mr-1" aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {erro && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {schedulerAtivo === false && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          <i className="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true" />
          <b>Agendador desligado neste computador.</b> Artigos programados não
          serão publicados até configurar a chave{" "}
          <code className="rounded bg-tng-marine-900 px-1 text-xs">
            SUPABASE_SERVICE_ROLE_KEY
          </code>{" "}
          no ambiente do sidecar e reabrir o app.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-tng-marine-300">Carregando…</p>
      ) : agendamentos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-tng-marine-600 p-8 text-center">
          <p className="text-sm text-tng-marine-300">
            Nenhum agendamento no momento.
          </p>
          <p className="mt-1 text-xs text-tng-marine-400">
            Crie um em "Novo artigo" escolhendo a opção "Programar".
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {agendamentos.map((a) => {
            const site = siteMap.get(a.site_id);
            const style = STATUS_STYLE[a.status] ?? {
              label: a.status,
              cls: "bg-tng-marine-700 text-tng-marine-200",
            };
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.cls}`}
                    >
                      {style.label}
                    </span>
                    {/* Data programada como badge destacado — é a informação
                        mais importante do card (feedback 2026-07-09). */}
                    <span className="rounded-md border border-tng-marine-600 bg-tng-marine-900/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-tng-orange-200">
                      <i
                        className="fa-regular fa-clock mr-1.5"
                        aria-hidden="true"
                      />
                      {fmtData(a.data_programada)}
                    </span>
                    {fixedSiteId === undefined && (
                      <span className="text-xs text-tng-marine-400">
                        {site?.nome ?? site?.url ?? "Site desconhecido"}
                      </span>
                    )}
                    {a.rascunho && (
                      <span className="rounded-full bg-tng-marine-700 px-2 py-0.5 text-[10px] text-tng-marine-300">
                        rascunho
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-tng-marine-50">
                    {a.keyword}
                  </p>
                  {a.erro && (
                    <p className="mt-1 text-[11px] text-red-300">{a.erro}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.post_url && (
                    <button
                      type="button"
                      onClick={() => {
                        void openUrl(a.post_url as string);
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
                  {/* Pendente = "Cancelar" (impede a publicação futura);
                      falhou = "Excluir" (limpa o painel). O backend recusa
                      remover só o status "executando". */}
                  {a.status !== "executando" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmandoCancelId === a.id) {
                          setConfirmandoCancelId(null);
                          void cancelar(a.id);
                        } else {
                          setConfirmandoCancelId(a.id);
                          setTimeout(() => {
                            setConfirmandoCancelId((atual) =>
                              atual === a.id ? null : atual,
                            );
                          }, 4000);
                        }
                      }}
                      disabled={cancelandoId === a.id}
                      className={`rounded-md border px-2.5 py-1 text-xs transition disabled:opacity-50 ${
                        confirmandoCancelId === a.id
                          ? "border-red-400 bg-red-500/20 text-red-100"
                          : "border-red-500/40 text-red-300 hover:bg-red-500/10"
                      }`}
                    >
                      {cancelandoId === a.id
                        ? "Removendo…"
                        : confirmandoCancelId === a.id
                          ? "Confirmar"
                          : a.status === "pendente"
                            ? "Cancelar"
                            : "Excluir"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
