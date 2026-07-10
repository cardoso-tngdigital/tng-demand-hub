// =============================================================================
// SitesView — sites conectados (Sprint 27)
// =============================================================================
// Lista os sites, mostra status de plugin/RankMath, permite testar conexão
// e editar o prompt específico do site. Guia curto explica como conectar
// um novo WP.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { blogFetch, blogFetchBlob } from "../../../lib/blogClient";
import { showToast } from "../../../lib/toast";
import type { BlogSite } from "../../../types/blog";
import { HistoricoView } from "./HistoricoView";
import { ProgramacaoView } from "./ProgramacaoView";

// Contadores mostrados no card: quantos agendados pendentes e quantos
// publicados no histórico. Populados junto com a lista de sites.
type Contadores = { agendados: number; publicados: number };

/**
 * Props:
 * - `drawerRequest` — pedido externo (bus blogNav) de abrir o drawer de um
 *   site numa aba específica; consumido assim que os sites carregam.
 * - `onDrawerRequestConsumed` — avisa o BlogPanel pra limpar o pedido.
 */
export function SitesView({
  drawerRequest,
  onDrawerRequestConsumed,
}: {
  drawerRequest?: { siteId: string; tab: "programacao" | "historico" } | null;
  onDrawerRequestConsumed?: () => void;
} = {}) {
  const [sites, setSites] = useState<BlogSite[]>([]);
  const [contadores, setContadores] = useState<Record<string, Contadores>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState<string>("");

  const [testingId, setTestingId] = useState<string | null>(null);
  const [promptEditingSite, setPromptEditingSite] = useState<BlogSite | null>(
    null,
  );
  const [editingSite, setEditingSite] = useState<BlogSite | null>(null);
  const [drawerSite, setDrawerSite] = useState<BlogSite | null>(null);
  // Aba inicial do drawer — controlada pelo pedido externo (blogNav).
  const [drawerTabInicial, setDrawerTabInicial] = useState<
    "programacao" | "historico"
  >("programacao");
  const [removingId, setRemovingId] = useState<string | null>(null);
  // ID do site em modo "confirmar remoção" — o 1º clique arma; o 2º remove.
  // Necessário porque `window.confirm` do Tauri exige capability
  // `dialog:confirm` que este projeto não expõe.
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(
    null,
  );
  const [baixandoPlugin, setBaixandoPlugin] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      // Antes fazíamos 3 chamadas em paralelo (sites + agendamentos completos
      // + histórico completo) e reduzíamos no cliente. Com muitos posts a
      // resposta ficava enorme e a UI travava 3-5s. Agora um endpoint só
      // devolve sites + contadores agregados — payload muito menor.
      const res = await blogFetch<{
        sites: BlogSite[];
        contadores: Record<string, Contadores>;
      }>("/api/sites/summary");
      setSites(res.sites);
      setContadores(res.contadores ?? {});
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar sites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Consome o pedido externo de abrir drawer (ex.: toast "Ver programação")
  // assim que a lista de sites estiver disponível.
  useEffect(() => {
    if (!drawerRequest || sites.length === 0) return;
    const alvo = sites.find((s) => s.id === drawerRequest.siteId);
    if (alvo) {
      setDrawerTabInicial(drawerRequest.tab);
      setDrawerSite(alvo);
    }
    onDrawerRequestConsumed?.();
  }, [drawerRequest, sites, onDrawerRequestConsumed]);

  async function removerSite(id: string) {
    setRemovingId(id);
    try {
      await blogFetch(`/api/sites/${id}`, { method: "DELETE" });
      setSites((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      window.alert(
        `Falha ao remover: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      );
    } finally {
      setRemovingId(null);
    }
  }

  async function testar(id: string) {
    setTestingId(id);
    try {
      const res = await blogFetch<{
        connected: boolean;
        plugin: boolean;
        rankmath: boolean;
      }>(`/api/sites/${id}/testar`, { method: "POST" });
      setSites((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                plugin: res.plugin,
                rankmath: res.rankmath,
                status: res.connected ? "conectado" : "erro",
              }
            : s,
        ),
      );
    } catch (e) {
      window.alert(
        `Falha ao testar: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      );
    } finally {
      setTestingId(null);
    }
  }

  // Download do plugin via dialog nativo — MESMO motivo do .docx: o
  // WKWebView do macOS ignora silenciosamente `<a href download>` pra
  // binários, então o botão-link "não fazia nada" (bug 2026-07-09). Fetch
  // do zip → save() → comando Rust write_file_bytes.
  async function baixarPlugin() {
    setBaixandoPlugin(true);
    try {
      const blob = await blogFetchBlob("/api/plugin/download");
      const destino = await save({
        defaultPath: "tng-blog-connect.zip",
        filters: [{ name: "Plugin WordPress", extensions: ["zip"] }],
      });
      if (!destino) return; // usuário cancelou o dialog
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      await invoke("write_file_bytes", { path: destino, bytes });
      showToast({
        tipo: "success",
        titulo: "Plugin baixado",
        mensagem: destino,
      });
    } catch (e) {
      showToast({
        tipo: "error",
        titulo: "Falha ao baixar plugin",
        mensagem: e instanceof Error ? e.message : "erro desconhecido",
      });
    } finally {
      setBaixandoPlugin(false);
    }
  }

  const sitesVisiveis = useMemo(() => {
    const ordenados = [...sites].sort((a, b) =>
      (a.nome ?? a.url).localeCompare(b.nome ?? b.url, "pt-BR", {
        sensitivity: "base",
      }),
    );
    const q = busca.trim().toLowerCase();
    if (q.length === 0) return ordenados;
    return ordenados.filter((s) =>
      `${s.nome ?? ""} ${s.url}`.toLowerCase().includes(q),
    );
  }, [sites, busca]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
            Sites
          </h3>
          <p className="mt-1 text-xs text-tng-marine-400">
            Clique no card para ver programação e histórico daquele site.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void baixarPlugin()}
          disabled={baixandoPlugin}
          className="shrink-0 rounded-md border border-tng-orange-400 bg-tng-orange-400/10 px-3 py-1.5 text-xs font-medium text-tng-orange-200 transition hover:bg-tng-orange-400/20 disabled:opacity-50"
        >
          {baixandoPlugin ? (
            <>
              <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" />
              Baixando…
            </>
          ) : (
            <>
              <i className="fa-solid fa-download mr-1.5" aria-hidden="true" />
              Baixar plugin WP
            </>
          )}
        </button>
      </div>

      {/* Busca */}
      <div className="relative">
        <i
          className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-tng-marine-500"
          aria-hidden="true"
        />
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar site pelo nome ou URL…"
          className="w-full rounded-md border border-tng-marine-600 bg-tng-marine-900 py-2 pl-8 pr-3 text-sm text-tng-marine-50 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none"
        />
      </div>

      {erro && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-tng-marine-300">Carregando…</p>
      ) : sites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-tng-marine-600 p-8 text-center">
          <p className="text-sm text-tng-marine-300">
            Nenhum site conectado ainda.
          </p>
          <div className="mx-auto mt-4 max-w-lg text-left">
            <p className="mb-2 text-xs uppercase tracking-wider text-tng-marine-300">
              Como conectar
            </p>
            <ol className="space-y-1.5 text-sm text-tng-marine-100">
              <li className="flex gap-2">
                <span className="font-mono text-tng-orange-300">1.</span>
                <span>
                  Baixe o <b>.zip</b> do plugin no botão acima e instale no
                  WordPress do cliente.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-tng-orange-300">2.</span>
                <span>Ative o plugin.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-tng-orange-300">3.</span>
                <span>
                  Clique em <b>Conectar</b> no menu do plugin. O site aparece
                  aqui automaticamente.
                </span>
              </li>
            </ol>
          </div>
        </div>
      ) : sitesVisiveis.length === 0 ? (
        <p className="text-sm text-tng-marine-400">
          Nenhum site bate com "{busca}".
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sitesVisiveis.map((s) => {
            const ct = contadores[s.id] ?? { agendados: 0, publicados: 0 };
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setDrawerSite(s)}
                  className="w-full rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-4 text-left transition hover:border-tng-orange-400/60 hover:bg-tng-marine-800/60"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-tng-marine-50">
                        {s.nome ?? "(sem nome)"}
                      </p>
                      <p className="truncate text-[11px] text-tng-marine-400">
                        {s.url}
                      </p>
                    </div>
                    <span className="rounded-md bg-tng-marine-900/60 px-2 py-1 text-[11px] tabular-nums text-tng-marine-200">
                      <span className="text-tng-orange-300">
                        {ct.publicados}
                      </span>
                      /
                      <span className="text-tng-marine-100">
                        {ct.publicados + ct.agendados}
                      </span>
                      <span className="ml-1 text-[10px] text-tng-marine-500">
                        pub/total
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge ok={s.status === "conectado"} label="Conectado" />
                    <Badge ok={s.plugin} label="Plugin" />
                    <Badge ok={s.rankmath} label="RankMath" />
                    {ct.agendados > 0 && (
                      <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                        <i className="fa-solid fa-clock mr-1" aria-hidden="true" />
                        {ct.agendados} agendado{ct.agendados > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {drawerSite && (
        <SiteDrawer
          site={drawerSite}
          initialTab={drawerTabInicial}
          onClose={() => {
            setDrawerSite(null);
            setDrawerTabInicial("programacao");
          }}
          testing={testingId === drawerSite.id}
          removing={removingId === drawerSite.id}
          confirmandoRemocao={confirmandoRemocao === drawerSite.id}
          onTestar={() => void testar(drawerSite.id)}
          onEditarPrompt={() => setPromptEditingSite(drawerSite)}
          onEditarSite={() => setEditingSite(drawerSite)}
          onRemover={() => {
            if (confirmandoRemocao === drawerSite.id) {
              setConfirmandoRemocao(null);
              void removerSite(drawerSite.id).then(() => setDrawerSite(null));
            } else {
              setConfirmandoRemocao(drawerSite.id);
              setTimeout(() => {
                setConfirmandoRemocao((atual) =>
                  atual === drawerSite.id ? null : atual,
                );
              }, 4000);
            }
          }}
        />
      )}

      {promptEditingSite && (
        <PromptModal
          site={promptEditingSite}
          onClose={() => setPromptEditingSite(null)}
          onSaved={(next) => {
            setSites((prev) => prev.map((s) => (s.id === next.id ? next : s)));
            if (drawerSite?.id === next.id) setDrawerSite(next);
            setPromptEditingSite(null);
          }}
        />
      )}
      {editingSite && (
        <EditSiteModal
          site={editingSite}
          onClose={() => setEditingSite(null)}
          onSaved={(next) => {
            setSites((prev) => prev.map((s) => (s.id === next.id ? next : s)));
            if (drawerSite?.id === next.id) setDrawerSite(next);
            setEditingSite(null);
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// SiteDrawer — painel lateral com abas Programação / Histórico + ações
// -----------------------------------------------------------------------------
type DrawerTab = "programacao" | "historico";

function SiteDrawer({
  site,
  initialTab = "programacao",
  onClose,
  testing,
  removing,
  confirmandoRemocao,
  onTestar,
  onEditarPrompt,
  onEditarSite,
  onRemover,
}: {
  site: BlogSite;
  initialTab?: DrawerTab;
  onClose: () => void;
  testing: boolean;
  removing: boolean;
  confirmandoRemocao: boolean;
  onTestar: () => void;
  onEditarPrompt: () => void;
  onEditarSite: () => void;
  onRemover: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);

  useEffect(() => {
    // ESC fecha — captura antes do BlogPanel pra não fechar o painel inteiro.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/60"
      onClick={onClose}
    >
      <div className="flex-1" aria-hidden="true" />
      <aside
        className="flex w-full max-w-3xl flex-col border-l border-tng-marine-700 bg-tng-marine-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="border-b border-tng-marine-700 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-tng-marine-50">
                {site.nome ?? "(sem nome)"}
              </h3>
              <p className="mt-0.5 truncate text-xs text-tng-marine-400">
                {site.url}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge ok={site.status === "conectado"} label="Conectado" />
                <Badge ok={site.plugin} label="Plugin" />
                <Badge ok={site.rankmath} label="RankMath" />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>

          {/* Ações */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTestar}
              disabled={testing}
              className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-300 disabled:opacity-50"
            >
              {testing ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin mr-1" aria-hidden="true" />
                  Testando…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-plug mr-1" aria-hidden="true" />
                  Testar
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onEditarPrompt}
              className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-300"
            >
              <i className="fa-solid fa-pen mr-1" aria-hidden="true" />
              Prompt
            </button>
            <button
              type="button"
              onClick={onEditarSite}
              className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-300"
            >
              <i className="fa-solid fa-pen-to-square mr-1" aria-hidden="true" />
              Editar
            </button>
            <button
              type="button"
              onClick={onRemover}
              disabled={removing}
              className={`rounded-md border px-2.5 py-1 text-xs transition disabled:opacity-50 ${
                confirmandoRemocao
                  ? "border-red-400 bg-red-500/20 text-red-100"
                  : "border-red-500/40 text-red-300 hover:bg-red-500/10"
              }`}
            >
              {removing ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin mr-1" aria-hidden="true" />
                  Removendo…
                </>
              ) : confirmandoRemocao ? (
                <>
                  <i className="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true" />
                  Confirmar
                </>
              ) : (
                <>
                  <i className="fa-solid fa-trash mr-1" aria-hidden="true" />
                  Remover
                </>
              )}
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex border-b border-tng-marine-700 px-6">
          <TabButton
            active={tab === "programacao"}
            onClick={() => setTab("programacao")}
            icon="fa-calendar-days"
            label="Programação"
          />
          <TabButton
            active={tab === "historico"}
            onClick={() => setTab("historico")}
            icon="fa-clock-rotate-left"
            label="Histórico"
          />
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "programacao" && <ProgramacaoView fixedSiteId={site.id} />}
          {tab === "historico" && <HistoricoView fixedSiteId={site.id} />}
        </div>
      </aside>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition ${
        active
          ? "border-tng-orange-400 text-tng-orange-200"
          : "border-transparent text-tng-marine-300 hover:text-tng-marine-100"
      }`}
    >
      <i className={`fa-solid ${icon} text-xs`} aria-hidden="true" />
      {label}
    </button>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        ok
          ? "bg-emerald-500/20 text-emerald-300"
          : "bg-tng-marine-700 text-tng-marine-400"
      }`}
    >
      <i
        className={`fa-solid ${ok ? "fa-check" : "fa-xmark"} text-[9px]`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

// Modal pra editar nome/URL de um site. Fecha com ESC + backdrop. Equivalente
// ao `#modal-site` do painel Python. Não permite editar o `token` (que é
// definido só pelo callback do plugin WordPress — segurança do endpoint PUT).
function EditSiteModal({
  site,
  onClose,
  onSaved,
}: {
  site: BlogSite;
  onClose: () => void;
  onSaved: (next: BlogSite) => void;
}) {
  const [nome, setNome] = useState<string>(site.nome ?? "");
  const [url, setUrl] = useState<string>(site.url);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function salvar() {
    const nomeLimpo = nome.trim();
    const urlLimpo = url.trim().replace(/\/+$/, "");
    if (!nomeLimpo) {
      setErro("Nome é obrigatório.");
      return;
    }
    if (!urlLimpo) {
      setErro("URL é obrigatória.");
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      // O backend só aceita { nome, prompt, responsavel, plugin, rankmath } —
      // NÃO aceita `url` no PUT (segurança). Isso é intencional: a URL vem do
      // callback do plugin WP e não deve ser mudada pelo painel. Se o usuário
      // mudou a URL aqui, ignoramos com um aviso.
      if (urlLimpo !== site.url) {
        setErro(
          "Alterar a URL não é permitido pelo sidecar — reconecte o site pelo plugin do WordPress se a URL mudou.",
        );
        setSaving(false);
        return;
      }
      const resposta = await blogFetch<{ site: BlogSite }>(
        `/api/sites/${site.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ nome: nomeLimpo }),
        },
      );
      onSaved(resposta.site);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-tng-marine-700 bg-tng-marine-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-tng-marine-50">
            Editar site
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-tng-marine-300 hover:text-tng-marine-100"
            aria-label="Fechar"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-tng-marine-300">
              Nome
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Blog do Cliente Exemplo"
              className="w-full rounded-md border border-tng-marine-600 bg-tng-marine-800 px-3 py-2 text-sm text-tng-marine-50 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-tng-marine-300">
              URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              readOnly
              className="w-full rounded-md border border-tng-marine-700 bg-tng-marine-900 px-3 py-2 text-sm text-tng-marine-400 cursor-not-allowed"
            />
            <p className="mt-1 text-[10.5px] text-tng-marine-500">
              A URL não pode ser editada — vem do plugin do WordPress. Se o
              endereço do site mudou, reconecte pelo botão do plugin.
            </p>
          </div>
        </div>
        {erro && <p className="mt-3 text-xs text-red-300">{erro}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-tng-marine-600 px-3 py-1.5 text-sm text-tng-marine-200 hover:border-tng-marine-400 hover:text-tng-marine-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={saving}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-sm font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal minimalista pro prompt do site. Fecha com ESC + backdrop.
function PromptModal({
  site,
  onClose,
  onSaved,
}: {
  site: BlogSite;
  onClose: () => void;
  onSaved: (next: BlogSite) => void;
}) {
  const [prompt, setPrompt] = useState<string>(site.prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Consome o ESC antes que o BlogPanel o veja — o painel também escuta
    // com listener global, então usamos capture=true e stopPropagation.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function salvar() {
    setSaving(true);
    setErro(null);
    try {
      // Backend devolve envelope `{site: ...}` (não `BlogSite` direto).
      // Antes o tipo estava errado — `next` virava `{site: ...}` e o state
      // recebia um objeto sem `.id`/`.url`, corrompendo a lista.
      const resposta = await blogFetch<{ site: BlogSite }>(
        `/api/sites/${site.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ prompt }),
        },
      );
      onSaved(resposta.site);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-tng-marine-700 bg-tng-marine-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-tng-marine-50">
            Prompt do site — {site.nome ?? site.url}
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-tng-marine-300 hover:text-tng-marine-100"
            aria-label="Fechar"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          placeholder="Instruções específicas de estilo, tom e regras para este site. Herda do prompt geral quando vazio."
          className="w-full resize-y rounded-md border border-tng-marine-600 bg-tng-marine-800 px-3 py-2 text-sm text-tng-marine-50 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none"
        />
        {erro && (
          <p className="mt-2 text-xs text-red-300">{erro}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-tng-marine-600 px-3 py-1.5 text-sm text-tng-marine-200 hover:border-tng-marine-400 hover:text-tng-marine-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={saving}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-sm font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
