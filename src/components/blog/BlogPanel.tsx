// =============================================================================
// BlogPanel — wrapper overlay do módulo Blog (Sprint 27)
// =============================================================================
// Segue o mesmo padrão de tela cheia usado pelo SettingsPanel do Demand Hub:
// overlay fixo z-40, header com título+X, corpo com sidebar de navegação
// à esquerda e view ativa à direita. Isolamento total do app principal —
// nada aqui interfere com clientes/demandas/etc.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { NovoArtigoView } from "./views/NovoArtigoView";
import { SitesView } from "./views/SitesView";
import { PromptView } from "./views/PromptView";
import { UsoIAView } from "./views/UsoIAView";
import { ConfigView } from "./views/ConfigView";
import { NotificacoesView } from "./views/NotificacoesView";
import { ToastHost } from "./ToastHost";
import { blogFetch } from "../../lib/blogClient";
import { showToast } from "../../lib/toast";
import { subscribeBlogNav, type BlogNavRequest } from "../../lib/blogNav";
import type { BlogNotificacao } from "../../types/blog";

// Reorg 2026-07-04: Programação e Histórico saíram do menu lateral principal
// e viraram abas dentro do drawer de cada site (SitesView). Prompt e Uso de IA
// eram cards do ConfigView e viraram tabs próprias — mais fácil de achar.
// Notificações é nova (Sprint 31): persistência de eventos do scheduler.
type BlogTab =
  | "novo"
  | "sites"
  | "prompt"
  | "uso"
  | "notificacoes"
  | "config";

type TabDef = {
  key: BlogTab;
  label: string;
  icon: string;
};

const TABS: TabDef[] = [
  { key: "novo", label: "Novo artigo", icon: "fa-pen-nib" },
  { key: "sites", label: "Sites", icon: "fa-globe" },
  { key: "prompt", label: "Prompt", icon: "fa-file-lines" },
  { key: "uso", label: "Uso de IA", icon: "fa-chart-column" },
  { key: "notificacoes", label: "Notificações", icon: "fa-bell" },
  { key: "config", label: "Configurações", icon: "fa-gear" },
];

export function BlogPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<BlogTab>("novo");
  const [naoLidas, setNaoLidas] = useState<number>(0);
  // Pedido pendente de abrir o drawer de um site (vem do bus blogNav — ex.:
  // botão "Ver programação" de um toast). Consumido pelo SitesView.
  const [siteDrawerReq, setSiteDrawerReq] = useState<{
    siteId: string;
    tab: "programacao" | "historico";
  } | null>(null);

  // Navegação interna via bus — troca de aba e, se pedido, agenda a abertura
  // do drawer do site.
  useEffect(() => {
    if (!open) return;
    return subscribeBlogNav((req: BlogNavRequest) => {
      setActiveTab(req.tab);
      if (req.tab === "sites" && req.siteId) {
        setSiteDrawerReq({
          siteId: req.siteId,
          tab: req.drawerTab ?? "programacao",
        });
      }
    });
  }, [open]);

  // IDs de notificações já vistas pelo poller — evita re-toastar o mesmo
  // evento a cada ciclo. `primed` fica false até o 1º poll: nesse primeiro
  // load só "semeamos" os ids existentes SEM toastar, pra não vomitar um
  // backlog de toasts quando o painel abre.
  const vistosRef = useRef<Set<string>>(new Set());
  const primedRef = useRef<boolean>(false);
  // Guard anti-empilhamento: não dispara um novo ciclo enquanto o anterior
  // ainda está no ar. Sem isso, se um poll ficar lento os `setInterval`
  // acumulavam requests (parte do congelamento de 2026-07-09).
  const pollandoRef = useRef<boolean>(false);

  // Poll periódico das notificações não lidas — atualiza o badge do menu e
  // dispara toast flutuante pros eventos do SCHEDULER (que rodam em segundo
  // plano; sem o toast o usuário não veria). Jobs "agora" NÃO entram aqui —
  // eles têm `agendamento_id` nulo e o NovoArtigoView já toasta na hora.
  // Só roda enquanto o painel está aberto.
  const atualizarContagem = useCallback(async () => {
    // Pula se a janela está oculta (minimizada / outra aba) ou se o ciclo
    // anterior ainda não terminou.
    if (typeof document !== "undefined" && document.hidden) return;
    if (pollandoRef.current) return;
    pollandoRef.current = true;
    try {
      const [count, lista] = await Promise.all([
        blogFetch<{ nao_lidas: number }>("/api/notificacoes/nao-lidas/count"),
        blogFetch<{ notificacoes: BlogNotificacao[] }>(
          "/api/notificacoes?nao_lidas=1&limite=15",
        ),
      ]);
      setNaoLidas(count.nao_lidas);

      const novos = lista.notificacoes.filter(
        (n) => !vistosRef.current.has(n.id),
      );
      for (const n of lista.notificacoes) vistosRef.current.add(n.id);

      if (primedRef.current) {
        // Só eventos de agendamento (scheduler) viram toast aqui.
        for (const n of novos) {
          if (n.agendamento_id === null) continue;
          const postUrl =
            typeof n.contexto?.["post_url"] === "string"
              ? (n.contexto["post_url"] as string)
              : undefined;
          showToast({
            tipo: n.tipo,
            titulo: n.titulo,
            mensagem: n.mensagem,
            ...(postUrl ? { postUrl } : {}),
          });
        }
      }
      primedRef.current = true;
    } catch {
      // silencioso — sidecar pode estar reiniciando
    } finally {
      pollandoRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void atualizarContagem();
    const id = setInterval(() => void atualizarContagem(), 20_000);
    return () => clearInterval(id);
  }, [open, atualizarContagem]);

  // Atualiza a contagem ao voltar de "Notificações" (quando o usuário
  // marca coisas como lida lá dentro).
  useEffect(() => {
    if (open && activeTab !== "notificacoes") void atualizarContagem();
  }, [activeTab, open, atualizarContagem]);

  // ESC fecha o painel — espelha o padrão do SettingsPanel. Modais internos
  // (se algum view abrir seu próprio) devem gerenciar seu próprio ESC e
  // usar stopPropagation pra não fechar o painel inteiro.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-tng-marine-900/95 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-4">
        <div className="flex items-center gap-3">
          <i
            className="fa-solid fa-newspaper text-tng-orange-400"
            aria-hidden="true"
          />
          <h2 className="font-sans text-base font-semibold text-tng-marine-50">
            Blog
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar vertical à esquerda: uma aba por vez ativa. */}
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-tng-marine-700 bg-tng-marine-900/40 px-3 py-4">
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            const mostraBadge =
              tab.key === "notificacoes" && naoLidas > 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                  isActive
                    ? "bg-tng-marine-700 text-tng-orange-300"
                    : "text-tng-marine-200 hover:bg-tng-marine-800 hover:text-tng-marine-50"
                }`}
              >
                <i
                  className={`fa-solid ${tab.icon} w-4 text-center text-[13px]`}
                  aria-hidden="true"
                />
                <span className="flex-1">{tab.label}</span>
                {mostraBadge && (
                  <span className="rounded-full bg-tng-orange-400 px-1.5 py-0.5 text-[10px] font-semibold text-tng-marine-900">
                    {naoLidas > 99 ? "99+" : naoLidas}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Área da view ativa: cada view carrega seus próprios dados. */}
        <main className="flex-1 overflow-y-auto px-6 py-6">
          {activeTab === "novo" && <NovoArtigoView />}
          {activeTab === "sites" && (
            <SitesView
              drawerRequest={siteDrawerReq}
              onDrawerRequestConsumed={() => setSiteDrawerReq(null)}
            />
          )}
          {activeTab === "prompt" && <PromptView />}
          {activeTab === "uso" && <UsoIAView />}
          {activeTab === "notificacoes" && <NotificacoesView />}
          {activeTab === "config" && <ConfigView />}
        </main>
      </div>

      {/* Toasts flutuantes (topo direito). Vive aqui pra ficar acima de tudo
          do painel. Disparados por showToast() de qualquer lugar. */}
      <ToastHost />
    </div>
  );
}
