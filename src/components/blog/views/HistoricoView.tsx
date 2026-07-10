// =============================================================================
// HistoricoView — artigos publicados/rascunho/falha (Sprint 27)
// =============================================================================
// Consulta o histórico do sidecar (que já vem enriquecido com dados do WP)
// e permite: publicar rascunhos, baixar .docx pra revisão do cliente, e
// abrir o post ao vivo.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { blogFetch, blogFetchBlob } from "../../../lib/blogClient";
import { showToast } from "../../../lib/toast";
import type { BlogHistoricoItem, BlogSite } from "../../../types/blog";

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  // Aceita tanto "concluido" (nomenclatura antiga do sidecar TS) quanto
  // "publicado" (nomenclatura do app Python — usada pelo endpoint de
  // publicar rascunho a partir de 2026-07-03).
  concluido: { label: "Publicado", cls: "bg-emerald-500/20 text-emerald-300" },
  publicado: { label: "Publicado", cls: "bg-emerald-500/20 text-emerald-300" },
  agendado: { label: "Agendado", cls: "bg-blue-500/20 text-blue-300" },
  rascunho: { label: "Rascunho", cls: "bg-amber-500/20 text-amber-300" },
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
 * - `fixedSiteId` — quando presente, esconde o filtro de site e trava a
 *   listagem naquele site. Usado dentro do drawer de detalhe do site.
 */
export function HistoricoView({ fixedSiteId }: { fixedSiteId?: string } = {}) {
  const [sites, setSites] = useState<BlogSite[]>([]);
  const [itens, setItens] = useState<BlogHistoricoItem[]>([]);
  const [siteFilter, setSiteFilter] = useState<string>(fixedSiteId ?? "all");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [publicandoId, setPublicandoId] = useState<string | null>(null);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  // Confirmação inline em 2 cliques (padrão do projeto — `window.confirm`
  // é bloqueado pelo Tauri sem capability `dialog:confirm`).
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<
    string | null
  >(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      // Histórico já vem filtrado por site no servidor (`?site_id=`). No
      // drawer (fixedSiteId) não buscamos `/api/sites`: o nome do site está
      // no cabeçalho e o seletor global fica escondido — uma requisição a
      // menos por carga (feedback de lentidão, 2026-07-09).
      const hs = await blogFetch<{ historico: BlogHistoricoItem[] }>(
        `/api/historico${siteFilter !== "all" ? `?site_id=${encodeURIComponent(siteFilter)}` : ""}`,
      );
      setItens(hs.historico);
      if (fixedSiteId === undefined) {
        const ss = await blogFetch<{ sites: BlogSite[] }>("/api/sites");
        setSites(ss.sites);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [siteFilter, fixedSiteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const siteMap = useMemo(() => {
    const m = new Map<string, BlogSite>();
    for (const s of sites) m.set(s.id, s);
    return m;
  }, [sites]);

  async function publicar(id: string) {
    setPublicandoId(id);
    try {
      // Backend devolve `{ok:true}`, não o item — recarrega a lista pra pegar
      // o status atualizado (Sprint 28 fix do code review).
      await blogFetch<{ ok: boolean }>(
        `/api/historico/${id}/publicar`,
        { method: "POST" },
      );
      await carregar();
    } catch (e) {
      window.alert(
        `Falha ao publicar: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      );
    } finally {
      setPublicandoId(null);
    }
  }

  async function baixarDocx(id: string, keyword: string): Promise<void> {
    setBaixandoId(id);
    try {
      // O WKWebView (macOS) IGNORA cliques em `<a download href="blob:">` —
      // não existe handler de download no webview do Tauri, então a versão
      // anterior "não fazia nada" sem nem logar (bug 2026-07-09). O caminho
      // que funciona: fetch autenticado → dialog save nativo → comando Rust
      // `write_file_bytes` grava no caminho escolhido.
      const blob = await blogFetchBlob(`/api/historico/${id}/docx`);
      const nomeSugerido = `${keyword.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "artigo"}.docx`;
      const destino = await save({
        defaultPath: nomeSugerido,
        filters: [{ name: "Documento Word", extensions: ["docx"] }],
      });
      if (!destino) return; // usuário cancelou o dialog
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      await invoke("write_file_bytes", { path: destino, bytes });
      showToast({
        tipo: "success",
        titulo: "Documento salvo",
        mensagem: destino,
      });
    } catch (e) {
      showToast({
        tipo: "error",
        titulo: "Falha ao baixar .docx",
        mensagem: e instanceof Error ? e.message : "erro desconhecido",
      });
    } finally {
      setBaixandoId(null);
    }
  }

  async function excluir(id: string) {
    setExcluindoId(id);
    try {
      await blogFetch(`/api/historico/${id}`, { method: "DELETE" });
      setItens((prev) => prev.filter((h) => h.id !== id));
    } catch (e) {
      showToast({
        tipo: "error",
        titulo: "Falha ao excluir",
        mensagem: e instanceof Error ? e.message : "erro desconhecido",
      });
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
            Histórico
          </h3>
          <p className="mt-1 text-xs text-tng-marine-400">
            Artigos gerados pelo Blog, com opções de publicar, baixar .docx e
            abrir no WordPress.
          </p>
        </div>
        {fixedSiteId === undefined && (
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-wider text-tng-marine-300">
              Site
            </label>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="rounded-md border border-tng-marine-600 bg-tng-marine-900 px-2.5 py-1 text-sm text-tng-marine-50 focus:border-tng-orange-400 focus:outline-none"
            >
              <option value="all" className="bg-tng-marine-900">
                Todos
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id} className="bg-tng-marine-900">
                  {s.nome ?? s.url}
                </option>
              ))}
            </select>
          </div>
        )}
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
            Nenhum artigo no histórico.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {itens.map((h) => {
            const site = siteMap.get(h.site_id);
            const style = STATUS_STYLE[h.status] ?? {
              label: h.status,
              cls: "bg-tng-marine-700 text-tng-marine-200",
            };
            return (
              // Layout 2026-07-09: excluir é só um ícone no canto superior
              // direito; as ações (Publicar → Baixar → Abrir post) ficam
              // juntas numa linha no rodapé do card.
              <li
                key={h.id}
                className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.cls}`}
                    >
                      {style.label}
                    </span>
                    {/* Data como badge destacado — info crítica pro operador
                        (feedback 2026-07-09). */}
                    <span className="rounded-md border border-tng-marine-600 bg-tng-marine-900/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-tng-orange-200">
                      <i
                        className="fa-regular fa-calendar mr-1.5"
                        aria-hidden="true"
                      />
                      {fmtData(h.data_publicacao)}
                    </span>
                    {fixedSiteId === undefined && (
                      <span className="text-xs text-tng-marine-400">
                        {site?.nome ?? site?.url ?? "Site desconhecido"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmandoExclusaoId === h.id) {
                        setConfirmandoExclusaoId(null);
                        void excluir(h.id);
                      } else {
                        setConfirmandoExclusaoId(h.id);
                        setTimeout(() => {
                          setConfirmandoExclusaoId((atual) =>
                            atual === h.id ? null : atual,
                          );
                        }, 4000);
                      }
                    }}
                    disabled={excluindoId === h.id}
                    aria-label="Excluir do histórico"
                    className={`-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-sm transition disabled:opacity-50 ${
                      confirmandoExclusaoId === h.id
                        ? "bg-red-500/20 text-red-200"
                        : "text-tng-marine-400 hover:bg-red-500/10 hover:text-red-300"
                    }`}
                    title={
                      confirmandoExclusaoId === h.id
                        ? "Clique de novo para confirmar a exclusão"
                        : "Remove só o registro do painel — o post no WordPress não é apagado."
                    }
                  >
                    {excluindoId === h.id ? (
                      <i
                        className="fa-solid fa-spinner fa-spin"
                        aria-hidden="true"
                      />
                    ) : confirmandoExclusaoId === h.id ? (
                      <i
                        className="fa-solid fa-triangle-exclamation"
                        aria-hidden="true"
                      />
                    ) : (
                      <i className="fa-solid fa-trash" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p className="mt-1.5 truncate text-sm font-medium text-tng-marine-50">
                  {h.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-tng-marine-300">
                  Palavra-chave: {h.keyword}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {h.status === "rascunho" && (
                    <button
                      type="button"
                      onClick={() => void publicar(h.id)}
                      disabled={publicandoId === h.id}
                      className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      {publicandoId === h.id ? (
                        <>
                          <i
                            className="fa-solid fa-spinner fa-spin mr-1"
                            aria-hidden="true"
                          />
                          Publicando…
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-upload mr-1" aria-hidden="true" />
                          Publicar
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void baixarDocx(h.id, h.keyword)}
                    disabled={baixandoId === h.id}
                    className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-300 disabled:opacity-50"
                  >
                    {baixandoId === h.id ? (
                      <>
                        <i
                          className="fa-solid fa-spinner fa-spin mr-1"
                          aria-hidden="true"
                        />
                        Gerando…
                      </>
                    ) : (
                      <>
                        <i
                          className="fa-solid fa-file-word mr-1"
                          aria-hidden="true"
                        />
                        Baixar .docx
                      </>
                    )}
                  </button>
                  {h.post_url && (
                    <button
                      type="button"
                      onClick={() => {
                        void openUrl(h.post_url as string);
                      }}
                      className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs font-medium text-tng-orange-300 transition hover:border-tng-orange-400"
                    >
                      <i
                        className="fa-solid fa-arrow-up-right-from-square mr-1"
                        aria-hidden="true"
                      />
                      Abrir post
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
