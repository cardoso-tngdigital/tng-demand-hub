import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../hooks/useAuth";
import { BlogPanel } from "../components/blog/BlogPanel";
import { setBlogPort } from "../lib/blogClient";
import {
  listDemands,
  subscribeToDemands,
  updateDemand,
  type ClientDemandCount,
} from "../lib/demands";
import { listAllClients } from "../lib/clients";
import {
  ensureNotificationPermission,
  notifyAboutDemand,
  subscribeToNotificationClick,
} from "../lib/notifications";
import {
  clearReadNotifications,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToMyNotifications,
  type AppNotification,
} from "../lib/notificationsCenter";
import { NotificationsBell } from "../components/NotificationsBell";
import { setTrayBadge } from "../lib/tray";
import { htmlToPlainText, legacyToHtml } from "../lib/htmlContent";
import { listActiveClients, listActiveProfiles, type ClientOption, type ProfileOption } from "../lib/lookups";
import { DemandDetailDrawer } from "../components/DemandDetailDrawer";
import { KanbanBoard } from "../components/KanbanBoard";
import { SearchPalette } from "../components/SearchPalette";
import { ClientsAdmin } from "../components/ClientsAdmin";
import { ClientsPanelView } from "../components/ClientsPanelView";
import { ClientDetailDrawer } from "../components/ClientDetailDrawer";
import { SettingsPanel, type SettingsPanelKey } from "../components/SettingsPanel";
import { MembersAdmin } from "../components/MembersAdmin";
import { AiUsageAdmin } from "../components/AiUsageAdmin";
import { RulesAdmin } from "../components/RulesAdmin";
import { HotkeySettings } from "../components/HotkeySettings";
import { NotificationSettings } from "../components/NotificationSettings";
import { PerformancePanel } from "../components/PerformancePanel";
import { UpdateBanner } from "../components/UpdateBanner";
import { OnboardingTour } from "../components/OnboardingTour";
import { listAllProfiles } from "../lib/profiles";
import { getCurrentHotkeyDisplay } from "../lib/hotkey";
import { formatDueDate, DUE_TONE_CLASSES } from "../lib/dates";
import type {
  Client,
  Demand,
  DemandInfrastructure,
  DemandPriority,
  DemandStatus,
} from "../types/database";
import logoDark from "../assets/brand/logo-dark.png";

// "overdue" não é um status real do banco — é um filtro composto (prazo
// passou e a demanda ainda está aberta). Tratado dentro de filteredDemands.
type StatusFilter = DemandStatus | "all" | "overdue";
type PriorityFilter = DemandPriority | "all";
type RefFilter = string | "all" | "none";

// Paleta de prioridade. Status agora usa só verdes (teal/emerald),
// liberando azul e laranja-amarelo pra prioridade.
const PRIORITY_DOT: Record<DemandPriority, string> = {
  baixa: "bg-tng-marine-400",
  media: "bg-sky-400",
  alta: "bg-amber-400",
  urgente: "bg-red-500",
};

const PRIORITY_LABEL: Record<DemandPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d atrás`;
  return date.toLocaleDateString("pt-BR");
}

// Detectado uma vez no boot — true em macOS (atalho usa ⌘), false no
// Windows/Linux (usa Ctrl). userAgent é confiável o bastante pro nosso
// propósito; userAgentData ainda não é amplo o suficiente.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function DashboardScreen() {
  const { user, signOut } = useAuth();
  const currentUserId = user?.id ?? null;
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  // Bump força a subscription de realtime a se recriar do zero (recuperação
  // quando o canal cai e fica preso em "offline" — ver efeito de recuperação).
  const [realtimeNonce, setRealtimeNonce] = useState(0);
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [clientFilter, setClientFilter] = useState<RefFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<RefFilter>("all");
  const [viewMode, setViewMode] = useState<"list" | "kanban" | "clients">("list");
  // Carregamos clientes completos (com email, phone, project_phase, notes)
  // sob demanda quando o user entra no modo "clients" — `ClientOption` em
  // `clients` é só pros selects de filtro/captura.
  const [fullClients, setFullClients] = useState<Client[] | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [clientsAdminOpen, setClientsAdminOpen] = useState(false);
  const [membersAdminOpen, setMembersAdminOpen] = useState(false);
  const [aiUsageOpen, setAiUsageOpen] = useState(false);
  const [rulesAdminOpen, setRulesAdminOpen] = useState(false);
  const [hotkeySettingsOpen, setHotkeySettingsOpen] = useState(false);
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false);
  const [performancePanelOpen, setPerformancePanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Painel Blog (Sprint 27): sidecar Node sobe on-demand na 1ª abertura.
  // `blogStarting` cobre o gap entre invoke e o health responder pra evitar
  // que o user clique no botão duas vezes.
  const [blogOpen, setBlogOpen] = useState(false);
  const [blogStarting, setBlogStarting] = useState(false);

  const handleOpenBlog = useCallback(async () => {
    if (blogOpen) return;
    setBlogStarting(true);
    try {
      const status = await invoke<{ running: boolean; port: number }>(
        "blog_sidecar_start_lazy",
        {
          args: {
            supabase_url: import.meta.env.VITE_SUPABASE_URL,
            supabase_anon_key: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        },
      );
      setBlogPort(status.port);
      // Sidecar demora ~1s pra ligar depois do fork; espera o /api/health
      // responder antes de mostrar o painel pra não bater em rota morta.
      for (let i = 0; i < 20; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${status.port}/api/health`);
          if (r.ok) break;
        } catch {
          // Sidecar ainda não subiu — tenta de novo.
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      setBlogOpen(true);
    } catch (err) {
      console.error("[blog] Falha ao iniciar sidecar:", err);
      window.alert("Não consegui iniciar o motor do Blog. Detalhes no console.");
    } finally {
      setBlogStarting(false);
    }
  }, [blogOpen]);

  // Sprint 20: o header consolidado abre o SettingsPanel; clicar num cartão
  // de lá chama esta função, que aciona o setter individual do admin
  // correspondente. Assim mantemos a lógica de refresh (useEffects que
  // observam clientsAdminOpen/membersAdminOpen fechando) sem refatorar
  // cada componente admin.
  function handleOpenSettingsItem(key: SettingsPanelKey) {
    switch (key) {
      case "clients":
        setClientsAdminOpen(true);
        break;
      case "members":
        setMembersAdminOpen(true);
        break;
      case "ai_usage":
        setAiUsageOpen(true);
        break;
      case "rules":
        setRulesAdminOpen(true);
        break;
      case "performance":
        setPerformancePanelOpen(true);
        break;
      case "notifications":
        setNotificationSettingsOpen(true);
        break;
      case "hotkey":
        setHotkeySettingsOpen(true);
        break;
    }
  }
  const [currentHotkey, setCurrentHotkey] = useState<string>(() =>
    getCurrentHotkeyDisplay(),
  );
  const [isAdmin, setIsAdmin] = useState(false);
  // Nome de exibição do user atual — preferimos full_name a email no header
  // e em qualquer outro lugar do app. Email só aparece como tooltip.
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  // Centro de notificações in-app. As notificações são criadas server-side
  // (triggers no banco); aqui só lemos/assinamos/marcamos como lida.
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifAutoOpenedRef = useRef(false);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  // Marca UMA notificação como lida: otimista no estado local + persiste no
  // banco (o realtime UPDATE sincroniza as outras sessões). Só o clique NA
  // NOTIFICAÇÃO (popup ou banner do SO) marca — abrir a demanda por navegação
  // normal (lista/kanban/busca) não mexe no "lida".
  const markNotifRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    void markNotificationRead(id);
  }, []);

  const handleSelectNotification = useCallback(
    (demandId: string | null, notificationId: string) => {
      if (demandId) setSelectedDemandId(demandId);
      markNotifRead(notificationId);
      setNotifOpen(false);
    },
    [markNotifRead],
  );

  const handleMarkAllNotificationsRead = useCallback(() => {
    if (!currentUserId) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    void markAllNotificationsRead(currentUserId);
  }, [currentUserId]);

  const handleClearReadNotifications = useCallback(() => {
    if (!currentUserId) return;
    setNotifications((prev) => prev.filter((n) => !n.read));
    void clearReadNotifications(currentUserId);
  }, [currentUserId]);

  // Detecta papel admin do usuário atual para liberar gestão de regras e
  // carrega o nome de exibição.
  useEffect(() => {
    if (!currentUserId) return;
    (async () => {
      const all = await listAllProfiles();
      const me = all.data.find((p) => p.id === currentUserId);
      setIsAdmin(me?.role === "admin");
      setCurrentUserName(me?.full_name ?? null);
    })();
  }, [currentUserId, membersAdminOpen, notificationSettingsOpen]);

  // Recarrega a lista de clientes quando o admin é fechado (pra refletir
  // mudanças nos filtros e selects do drawer/captura).
  useEffect(() => {
    if (clientsAdminOpen) return;
    (async () => {
      const c = await listActiveClients();
      setClients(c);
    })();
  }, [clientsAdminOpen]);

  // Idem para membros: recarrega a lista quando o admin fecha.
  useEffect(() => {
    if (membersAdminOpen) return;
    (async () => {
      const p = await listActiveProfiles();
      setProfiles(p);
    })();
  }, [membersAdminOpen]);

  // Atalho global Cmd/Ctrl+K abre a busca
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Carrega lookups uma vez
  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([listActiveClients(), listActiveProfiles()]);
      setClients(c);
      setProfiles(p);
    })();
  }, []);

  // Carrega lista inicial
  useEffect(() => {
    (async () => {
      const { data, error } = await listDemands();
      if (error) setError(error);
      else setDemands(data);
      setLoading(false);
    })();
  }, []);

  // Pede permissão de notificação uma vez por sessão
  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  // Clique na notificação do SO → abre o drawer da demanda E marca ESSA
  // notificação como lida. Só o clique na notificação marca; abrir a demanda
  // por navegação normal não. Detecção via foco (ver notifications.ts).
  useEffect(() => {
    return subscribeToNotificationClick((demandId, notificationId) => {
      setSelectedDemandId(demandId);
      if (notificationId) markNotifRead(notificationId);
    });
  }, [markNotifRead]);

  // Limpa o badge ao desmontar (sair do Dashboard / signOut)
  useEffect(() => {
    return () => {
      void setTrayBadge(0);
    };
  }, []);

  // Conta minhas demandas pendentes (atribuídas a mim, abertas) e propaga
  // pro tray icon. O contador se atualiza em tempo real via subscribe.
  const pendingForMeCount = useMemo(() => {
    if (!currentUserId) return 0;
    return demands.filter(
      (d) =>
        d.assignee_id === currentUserId &&
        (d.status === "todo" || d.status === "doing"),
    ).length;
  }, [demands, currentUserId]);

  useEffect(() => {
    void setTrayBadge(pendingForMeCount);
  }, [pendingForMeCount]);

  // Ref do status do realtime — usado pelo efeito de recuperação (que roda em
  // listeners de foco/rede, fora do ciclo de render).
  const realtimeConnectedRef = useRef<boolean>(realtimeConnected);
  useEffect(() => {
    realtimeConnectedRef.current = realtimeConnected;
  }, [realtimeConnected]);

  // Subscreve realtime de demandas SÓ para manter a LISTA atualizada ao vivo.
  // A decisão/criação de notificações agora é 100% server-side (triggers no
  // banco); o banner nativo e o contador vêm da assinatura da tabela
  // `notifications` (efeito abaixo).
  useEffect(() => {
    const unsubscribe = subscribeToDemands(
      (event, change) => {
        setDemands((prev) => {
          if (event === "INSERT" && change.new) {
            if (prev.some((d) => d.id === change.new!.id)) return prev;
            return [change.new, ...prev];
          }
          if (event === "UPDATE" && change.new) {
            return prev.map((d) => (d.id === change.new!.id ? change.new! : d));
          }
          if (event === "DELETE" && change.old) {
            return prev.filter((d) => d.id !== change.old!.id);
          }
          return prev;
        });
      },
      (connected) => {
        // Status REAL do canal (SUBSCRIBED vs caiu). Quando o realtime cai e a
        // reautenticação/reconexão do client.ts o traz de volta, o indicador
        // volta pra "ao vivo" sozinho — sem depender de reload.
        setRealtimeConnected(connected);
      },
    );
    return () => {
      setRealtimeConnected(false);
      unsubscribe();
    };
  }, [realtimeNonce]);

  // Recuperação do realtime: se o canal caiu (indicador "offline") e o app
  // volta ao foco / a rede volta / a aba fica visível, recria a subscription do
  // zero (bump no nonce). A reautenticação do socket (client.ts) reempurra o
  // JWT, mas um canal já travado em erro não re-assina sozinho — sem isto o
  // indicador ficava preso em "offline" e a lista parava de atualizar até um
  // reload. Só age quando está offline (evita churn quando já está "ao vivo").
  useEffect(() => {
    function recoverIfDown() {
      if (!realtimeConnectedRef.current) setRealtimeNonce((n) => n + 1);
    }
    function onVisible() {
      if (document.visibilityState === "visible") recoverIfDown();
    }
    window.addEventListener("focus", recoverIfDown);
    window.addEventListener("online", recoverIfDown);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", recoverIfDown);
      window.removeEventListener("online", recoverIfDown);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Centro de notificações: carrega as do usuário, assina em tempo real e, em
  // cada nova (INSERT), dispara o banner nativo do SO. Abre o popup no 1º load
  // se houver não lidas. As notificações já vêm prontas do servidor (uma linha
  // por destinatário; admin recebe de tudo), então aqui não há decisão nenhuma.
  useEffect(() => {
    if (!currentUserId) return;
    let activeLoad = true;
    (async () => {
      const { data } = await listMyNotifications();
      if (!activeLoad) return;
      setNotifications(data);
      if (!notifAutoOpenedRef.current && data.some((n) => !n.read)) {
        notifAutoOpenedRef.current = true;
        setNotifOpen(true);
      }
    })();
    const unsub = subscribeToMyNotifications(currentUserId, {
      onInsert: (n) => {
        setNotifications((prev) =>
          prev.some((x) => x.id === n.id) ? prev : [n, ...prev],
        );
        // Banner nativo do SO. Passa o notificationId pro proxy conseguir
        // marcar ESTA notificação como lida quando o banner for clicado.
        if (n.demand_id) {
          void notifyAboutDemand(n.title, n.body, n.demand_id, n.id);
        }
      },
      onUpdate: (n) =>
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? n : x))),
      onDelete: (id) =>
        setNotifications((prev) => prev.filter((x) => x.id !== id)),
    });
    return () => {
      activeLoad = false;
      unsub();
    };
  }, [currentUserId]);

  const selectedDemand = useMemo(
    () => demands.find((d) => d.id === selectedDemandId) ?? null,
    [demands, selectedDemandId],
  );

  // Lookup name por id para badges nos cards e drawer — calculado uma única
  // vez aqui em vez de em cada card.
  const profileNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name);
    return m;
  }, [profiles]);

  // Demanda atrasada = tem prazo, prazo já passou, e ainda está aberta.
  // Aplica tanto pro filtro "Atrasadas" quanto pra contagem do card.
  const isOverdue = useCallback((d: Demand): boolean => {
    if (!d.due_date) return false;
    if (d.status === "done" || d.status === "archived") return false;
    return d.due_date < new Date().toISOString().slice(0, 10);
  }, []);

  // Mostra demandas concluídas e arquivadas NA LISTA. Por padrão a lista
  // esconde (foco no que está em aberto). No Kanban as colunas done /
  // archived ficam visíveis sempre — o Kanban é a visão de fluxo completo.
  const [showClosed, setShowClosed] = useState(false);

  // Filtro de prazo: data específica em formato "YYYY-MM-DD". null = sem filtro.
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  // Ordenação por prazo. "none" mantém ordem natural (mais recentes primeiro).
  const [sortOrder, setSortOrder] = useState<"none" | "due_asc" | "due_desc">("none");

  // Filtro base — comum à lista e ao Kanban. Inclui status filter explícito
  // (todo/doing/overdue) mas não a regra de "esconder concluídas em all":
  // essa é exclusiva da lista.
  const baseFiltered = useMemo(() => {
    return demands.filter((d) => {
      if (statusFilter === "overdue") {
        if (!isOverdue(d)) return false;
      } else if (statusFilter !== "all" && d.status !== statusFilter) {
        return false;
      }
      if (priorityFilter !== "all" && d.priority !== priorityFilter) return false;
      if (clientFilter === "none" && d.client_id !== null) return false;
      if (clientFilter !== "all" && clientFilter !== "none" && d.client_id !== clientFilter) return false;
      if (assigneeFilter === "none" && d.assignee_id !== null) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "none" && d.assignee_id !== assigneeFilter) return false;
      // Filtro de data: due_date salvo é "YYYY-MM-DD" (postgres `date`), igual ao
      // valor do <input type="date">, então comparação direta basta.
      if (dateFilter && d.due_date !== dateFilter) return false;
      return true;
    });
  }, [demands, statusFilter, priorityFilter, clientFilter, assigneeFilter, dateFilter, isOverdue]);

  // Versão da lista — segue 3 modos:
  //   - statusFilter !== "all"  → só o que o filtro pediu (incluindo overdue)
  //   - statusFilter === "all" && !showClosed → só abertas (todo+doing)
  //   - statusFilter === "all" && showClosed  → SÓ concluídas/arquivadas
  //     (o toggle vira filtro exclusivo: o user quer revisar quais foram
  //     fechadas, não ver tudo misturado).
  const demandsForList = useMemo(() => {
    let result: Demand[];
    if (statusFilter !== "all") result = baseFiltered;
    else if (showClosed)
      result = baseFiltered.filter((d) => d.status === "done" || d.status === "archived");
    else
      result = baseFiltered.filter((d) => d.status !== "done" && d.status !== "archived");

    if (sortOrder === "none") return result;
    // Demandas sem prazo vão pro fim independente da direção, pra que o user
    // sempre veja primeiro o que tem prazo definido (informação útil > ruído).
    const dir = sortOrder === "due_asc" ? 1 : -1;
    return [...result].sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      if (a.due_date === b.due_date) return 0;
      return a.due_date < b.due_date ? -dir : dir;
    });
  }, [baseFiltered, statusFilter, showClosed, sortOrder]);

  // Versão do Kanban: usa só os filtros explícitos, sem esconder concluídas.
  const kanbanDemands = baseFiltered;

  // Painel "Por cliente": deriva counts a partir das demandas locais.
  // Sprint 20 — listDemands tem limite de 100; pra clientes com >100 demandas
  // total a contagem ficaria inexata, mas o caso é raro hoje e o realtime
  // mantém o painel reativo a mudanças.
  const clientCounts = useMemo(() => {
    const out: Record<string, ClientDemandCount> = {};
    for (const d of demands) {
      if (!d.client_id) continue;
      const entry = (out[d.client_id] ||= { open: 0, total: 0 });
      entry.total += 1;
      if (d.status === "todo" || d.status === "doing") entry.open += 1;
    }
    return out;
  }, [demands]);

  const selectedClient = useMemo(() => {
    if (!selectedClientId || !fullClients) return null;
    return fullClients.find((c) => c.id === selectedClientId) ?? null;
  }, [selectedClientId, fullClients]);

  // Carrega clientes completos sob demanda. Quando ClientsAdmin grava
  // mudanças, ele lida com a própria lista — aqui só carregamos quando o
  // user entra no modo `clients` pela 1a vez. Refetch manual via
  // `refreshFullClients` quando o user faz patch via drawer.
  const refreshFullClients = useCallback(async () => {
    const { data } = await listAllClients();
    setFullClients(data);
  }, []);

  useEffect(() => {
    if (viewMode !== "clients") return;
    if (fullClients !== null) return;
    void refreshFullClients();
  }, [viewMode, fullClients, refreshFullClients]);

  // Carrega clientes completos quando o user abre a busca também — a
  // SearchPalette inclui clientes como categoria desde Sprint 20. Sem
  // isso, abrir Cmd+K antes de entrar no painel "Por cliente" não
  // listaria clientes.
  useEffect(() => {
    if (!searchOpen) return;
    if (fullClients !== null) return;
    void refreshFullClients();
  }, [searchOpen, fullClients, refreshFullClients]);

  const filtersActive =
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    clientFilter !== "all" ||
    assigneeFilter !== "all" ||
    dateFilter !== null;

  function clearFilters() {
    setStatusFilter("all");
    setPriorityFilter("all");
    setClientFilter("all");
    setAssigneeFilter("all");
    setDateFilter(null);
  }

  // Stats são calculadas sobre o conjunto TOTAL (não filtrado) — assim cada
  // card mostra o universo do filtro que ele representa, não a contagem
  // intersectada com filtros atuais. "Total" deliberadamente exclui
  // concluídas e arquivadas: o time olha pra "o que está em aberto", não
  // pra um histórico que só cresce.
  const stats = useMemo(() => {
    const todo = demands.filter((d) => d.status === "todo").length;
    const doing = demands.filter((d) => d.status === "doing").length;
    const overdue = demands.filter(isOverdue).length;
    const total = todo + doing;
    return { total, todo, doing, overdue };
  }, [demands, isOverdue]);

  return (
    <div className="flex h-screen flex-col bg-tng-marine-900">
      <UpdateBanner />

      {/* Header em 3 colunas (esquerda/centro/direita) pra que o ViewToggle
          fique perfeitamente centralizado em relação à janela, não ao
          espaço restante depois do conteúdo lateral. */}
      <header
        data-tauri-drag-region
        className="relative grid grid-cols-[1fr_auto_1fr] items-center border-b border-tng-marine-700 px-6 py-3"
      >
        <div className="flex items-center gap-3">
          <img src={logoDark} alt="TNG Digital" className="h-8 w-auto" draggable={false} />
          <span className="text-sm text-tng-marine-200">Sites — Demandas</span>
          <span
            className={`ml-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider ${
              realtimeConnected ? "text-emerald-400" : "text-tng-marine-300"
            }`}
            title={realtimeConnected ? "Conectado em tempo real" : "Sem conexão realtime"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                realtimeConnected ? "bg-emerald-400 animate-pulse" : "bg-tng-marine-500"
              }`}
            />
            {realtimeConnected ? "ao vivo" : "offline"}
          </span>
          <NotificationsBell
            notifications={notifications}
            unreadCount={unreadCount}
            open={notifOpen}
            onToggle={() => setNotifOpen((v) => !v)}
            onClose={() => setNotifOpen(false)}
            onSelect={handleSelectNotification}
            onMarkAllRead={handleMarkAllNotificationsRead}
            onClearRead={handleClearReadNotifications}
          />
        </div>
        <div className="flex justify-center">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-md border border-tng-marine-700 bg-tng-marine-800/40 px-2.5 py-1 text-[11px] text-tng-marine-300 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
            title={`Buscar (${IS_MAC ? "⌘" : "Ctrl"} + K)`}
          >
            <i className="fa-solid fa-magnifying-glass text-[11px]" aria-hidden="true" />
            <span className="hidden sm:inline">Buscar</span>
            <kbd className="rounded bg-tng-marine-700 px-1.5 py-0.5 font-mono text-[10px] text-tng-marine-200">
              {IS_MAC ? "⌘" : "Ctrl"} K
            </kbd>
          </button>
          <button
            type="button"
            onClick={handleOpenBlog}
            disabled={blogStarting}
            className="rounded-md px-3 py-1.5 text-sm text-tng-marine-200 transition hover:bg-tng-marine-700 hover:text-tng-orange-300 disabled:opacity-50"
            aria-label="Abrir Blog"
          >
            <i
              className={`fa-solid ${blogStarting ? "fa-spinner fa-spin" : "fa-newspaper"} mr-1.5`}
              aria-hidden="true"
            />
            Blog
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-md p-1 text-tng-marine-300 transition hover:bg-tng-marine-700/60 hover:text-tng-orange-400"
            title="Configurações"
            aria-label="Configurações"
          >
            <i className="fa-solid fa-gear text-sm" aria-hidden="true" />
          </button>
          <span
            className="text-xs text-tng-marine-300"
            title={user?.email ?? undefined}
          >
            {currentUserName ?? user?.email}
          </span>
          <button
            onClick={signOut}
            className="rounded-md border border-tng-marine-600 px-3 py-1.5 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Stats clicáveis — funcionam como filtro por status. Cada card
          alterna entre "filtrar por este status" e "todos". Números em
          branco (neutros) pra não competir visualmente com os badges /
          botões de status do card. Atrasadas leva ícone de atenção. */}
      <section className="grid grid-cols-4 gap-3 border-b border-tng-marine-700 px-6 py-4">
        <StatFilterCard
          label="Total"
          value={stats.total}
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <StatFilterCard
          label="A fazer"
          value={stats.todo}
          active={statusFilter === "todo"}
          onClick={() => setStatusFilter(statusFilter === "todo" ? "all" : "todo")}
        />
        <StatFilterCard
          label="Em andamento"
          value={stats.doing}
          active={statusFilter === "doing"}
          onClick={() => setStatusFilter(statusFilter === "doing" ? "all" : "doing")}
        />
        <StatFilterCard
          label="Atrasadas"
          value={stats.overdue}
          active={statusFilter === "overdue"}
          icon={<i className="fa-solid fa-triangle-exclamation text-red-400" aria-hidden="true" />}
          onClick={() => setStatusFilter(statusFilter === "overdue" ? "all" : "overdue")}
        />
      </section>

      {/* Filtros */}
      <FilterBar
        priorityFilter={priorityFilter}
        clientFilter={clientFilter}
        assigneeFilter={assigneeFilter}
        clients={clients}
        profiles={profiles}
        showClosed={showClosed}
        statusFilter={statusFilter}
        dateFilter={dateFilter}
        sortOrder={sortOrder}
        onPriorityChange={setPriorityFilter}
        onClientChange={setClientFilter}
        onAssigneeChange={setAssigneeFilter}
        onShowClosedChange={setShowClosed}
        onDateFilterChange={setDateFilter}
        onSortOrderChange={setSortOrder}
        active={filtersActive}
        onClear={clearFilters}
      />

      {/* Lista, Kanban ou Por cliente */}
      <main
        className={
          viewMode === "list" || viewMode === "clients"
            ? "flex-1 overflow-y-auto px-6 py-5"
            : "flex-1 overflow-hidden px-6 py-5"
        }
      >
        {viewMode === "clients" ? (
          fullClients === null ? (
            <div className="flex h-full items-center justify-center text-sm text-tng-marine-300">
              Carregando clientes…
            </div>
          ) : (
            <ClientsPanelView
              clients={fullClients}
              demandCounts={clientCounts}
              onSelectClient={setSelectedClientId}
            />
          )
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-tng-marine-300">
            Carregando demandas…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : demands.length === 0 ? (
          <EmptyState hotkey={currentHotkey} />
        ) : viewMode === "list" ? (
          demandsForList.length === 0 ? (
            <FilteredEmptyState onClear={clearFilters} />
          ) : (
            <ul className="space-y-2">
              {demandsForList.map((demand) => (
                <DemandCard
                  key={demand.id}
                  demand={demand}
                  assigneeName={
                    demand.assignee_id ? profileNameById.get(demand.assignee_id) ?? null : null
                  }
                  onSelect={() => setSelectedDemandId(demand.id)}
                />
              ))}
            </ul>
          )
        ) : (
          <KanbanBoard
            demands={kanbanDemands}
            profileNameById={profileNameById}
            onSelectDemand={setSelectedDemandId}
          />
        )}
      </main>

      <ClientDetailDrawer
        client={selectedClient}
        profiles={profiles}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        escDisabled={selectedDemandId !== null}
        onClose={() => setSelectedClientId(null)}
        onSelectDemand={setSelectedDemandId}
        onPatchClient={(next) => {
          setFullClients((prev) =>
            prev ? prev.map((c) => (c.id === next.id ? next : c)) : prev,
          );
        }}
      />

      <DemandDetailDrawer
        demand={selectedDemand}
        clients={clients}
        profiles={profiles}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        onClose={() => setSelectedDemandId(null)}
      />

      <SearchPalette
        open={searchOpen}
        demands={demands}
        clients={fullClients}
        onClose={() => setSearchOpen(false)}
        onSelectDemand={(id) => setSelectedDemandId(id)}
        onSelectClient={(id) => setSelectedClientId(id)}
      />

      <ClientsAdmin
        open={clientsAdminOpen}
        onClose={() => setClientsAdminOpen(false)}
      />

      <MembersAdmin
        open={membersAdminOpen}
        currentUserId={currentUserId}
        onClose={() => setMembersAdminOpen(false)}
      />

      <AiUsageAdmin
        open={aiUsageOpen}
        profiles={profiles}
        onClose={() => setAiUsageOpen(false)}
      />

      <RulesAdmin
        open={rulesAdminOpen}
        isAdmin={isAdmin}
        clients={clients}
        profiles={profiles}
        onClose={() => setRulesAdminOpen(false)}
      />

      <HotkeySettings
        open={hotkeySettingsOpen}
        onClose={() => {
          setHotkeySettingsOpen(false);
          setCurrentHotkey(getCurrentHotkeyDisplay());
        }}
      />

      <NotificationSettings
        open={notificationSettingsOpen}
        onClose={() => setNotificationSettingsOpen(false)}
      />

      <PerformancePanel
        open={performancePanelOpen}
        onClose={() => setPerformancePanelOpen(false)}
      />

      <SettingsPanel
        open={settingsOpen}
        isAdmin={isAdmin}
        onClose={() => setSettingsOpen(false)}
        onOpen={handleOpenSettingsItem}
      />

      <BlogPanel open={blogOpen} onClose={() => setBlogOpen(false)} />

      <OnboardingTour />
    </div>
  );
}

type ViewMode = "list" | "kanban" | "clients";

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-tng-marine-600">
      <ViewToggleButton active={mode === "list"} onClick={() => onChange("list")}>
        Lista
      </ViewToggleButton>
      <ViewToggleButton active={mode === "kanban"} onClick={() => onChange("kanban")}>
        Kanban
      </ViewToggleButton>
      <ViewToggleButton
        active={mode === "clients"}
        onClick={() => onChange("clients")}
        title="Visualizar por cliente"
      >
        Por cliente
      </ViewToggleButton>
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2.5 py-1 text-[11px] transition ${
        active
          ? "bg-tng-marine-600 text-tng-marine-50"
          : "text-tng-marine-300 hover:bg-tng-marine-700/60 hover:text-tng-marine-100"
      }`}
    >
      {children}
    </button>
  );
}

const PRIORITY_CHIPS: { value: DemandPriority; label: string; dot: string }[] = [
  { value: "urgente", label: "Urgente", dot: PRIORITY_DOT.urgente },
  { value: "alta", label: "Alta", dot: PRIORITY_DOT.alta },
  { value: "media", label: "Média", dot: PRIORITY_DOT.media },
  { value: "baixa", label: "Baixa", dot: PRIORITY_DOT.baixa },
];

function FilterBar(props: {
  priorityFilter: PriorityFilter;
  clientFilter: RefFilter;
  assigneeFilter: RefFilter;
  clients: ClientOption[];
  profiles: ProfileOption[];
  // Para esconder o toggle quando o user está filtrando por status
  // específico (ele já decidiu o que ver).
  statusFilter: StatusFilter;
  showClosed: boolean;
  dateFilter: string | null;
  sortOrder: "none" | "due_asc" | "due_desc";
  onPriorityChange: (v: PriorityFilter) => void;
  onClientChange: (v: RefFilter) => void;
  onAssigneeChange: (v: RefFilter) => void;
  onShowClosedChange: (v: boolean) => void;
  onDateFilterChange: (v: string | null) => void;
  onSortOrderChange: (v: "none" | "due_asc" | "due_desc") => void;
  active: boolean;
  onClear: () => void;
}) {
  function togglePriority(p: DemandPriority) {
    props.onPriorityChange(props.priorityFilter === p ? "all" : p);
  }
  function toggleAssignee(v: string) {
    props.onAssigneeChange(props.assigneeFilter === v ? "all" : v);
  }

  return (
    <section className="space-y-1.5 border-b border-tng-marine-700 bg-tng-marine-800/30 px-6 py-2.5">
      {/* Linha 1: cliente (select compacto, há potencialmente muitos) +
          prioridade em chips (apenas 4 opções). */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={props.clientFilter}
          onChange={(v) => props.onClientChange(v as RefFilter)}
          active={props.clientFilter !== "all"}
        >
          <option value="all" className="bg-tng-marine-800">Todos os clientes</option>
          <option value="none" className="bg-tng-marine-800">Sem cliente</option>
          {props.clients.map((c) => (
            <option key={c.id} value={c.id} className="bg-tng-marine-800">
              {c.alias || c.name}
            </option>
          ))}
        </FilterSelect>

        <div className="flex flex-wrap items-center gap-1">
          {PRIORITY_CHIPS.map((p) => (
            <Chip
              key={p.value}
              active={props.priorityFilter === p.value}
              onClick={() => togglePriority(p.value)}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.dot}`} />
              {p.label}
            </Chip>
          ))}
        </div>

        {props.active && (
          <button
            type="button"
            onClick={props.onClear}
            className="ml-auto text-[11px] text-tng-marine-300 hover:text-tng-orange-400"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Linha 2: responsáveis em chips — um por membro ativo + "Sem
          responsável". A linha se expande automaticamente conforme o time
          cresce; equipe atual cabe em 1 linha sem rolar. */}
      <div className="flex flex-wrap items-center gap-1">
        <Chip
          active={props.assigneeFilter === "none"}
          onClick={() => toggleAssignee("none")}
        >
          Sem responsável
        </Chip>
        {props.profiles.map((p) => (
          <Chip
            key={p.id}
            active={props.assigneeFilter === p.id}
            onClick={() => toggleAssignee(p.id)}
          >
            {p.full_name}
          </Chip>
        ))}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Ordenação por prazo: 3 estados (none/asc/desc), togglados pelos
              dois botões. Clicar no já-ativo volta pra "none". */}
          <div className="flex items-center overflow-hidden rounded-full border border-tng-marine-600">
            <button
              type="button"
              onClick={() =>
                props.onSortOrderChange(props.sortOrder === "due_asc" ? "none" : "due_asc")
              }
              aria-pressed={props.sortOrder === "due_asc"}
              title="Ordenar por prazo (mais próximo primeiro)"
              className={`px-2 py-0.5 text-[11px] transition ${
                props.sortOrder === "due_asc"
                  ? "bg-tng-orange-400/15 text-tng-orange-200"
                  : "text-tng-marine-300 hover:bg-tng-marine-700/40 hover:text-tng-marine-100"
              }`}
            >
              <i className="fa-solid fa-arrow-up text-[10px]" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() =>
                props.onSortOrderChange(props.sortOrder === "due_desc" ? "none" : "due_desc")
              }
              aria-pressed={props.sortOrder === "due_desc"}
              title="Ordenar por prazo (mais distante primeiro)"
              className={`border-l border-tng-marine-600 px-2 py-0.5 text-[11px] transition ${
                props.sortOrder === "due_desc"
                  ? "bg-tng-orange-400/15 text-tng-orange-200"
                  : "text-tng-marine-300 hover:bg-tng-marine-700/40 hover:text-tng-marine-100"
              }`}
            >
              <i className="fa-solid fa-arrow-down text-[10px]" aria-hidden="true" />
            </button>
          </div>

          {/* Filtro de data: input nativo type=date. Limpa com botão dedicado
              quando ativo. */}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={props.dateFilter ?? ""}
              onChange={(e) => props.onDateFilterChange(e.target.value || null)}
              className={`rounded-full border bg-tng-marine-800 px-2.5 py-0.5 text-[11px] text-tng-marine-100 transition focus:border-tng-orange-400 focus:outline-none ${
                props.dateFilter
                  ? "border-tng-orange-400/60"
                  : "border-tng-marine-600"
              }`}
              title="Filtrar por data de prazo"
            />
            {props.dateFilter && (
              <button
                type="button"
                onClick={() => props.onDateFilterChange(null)}
                className="text-[11px] text-tng-marine-400 hover:text-tng-orange-400"
                title="Limpar filtro de data"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Toggle só faz sentido quando estamos na vista "todas em aberto"
              (statusFilter=all). Se já filtra por todo/doing/overdue, esse
              switch não tem efeito. */}
          {props.statusFilter === "all" && (
            <button
              type="button"
              onClick={() => props.onShowClosedChange(!props.showClosed)}
              aria-pressed={props.showClosed}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                props.showClosed
                  ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
                  : "border-tng-marine-600 text-tng-marine-300 hover:border-tng-marine-400 hover:text-tng-marine-100"
              }`}
            >
              {props.showClosed ? "Voltar às abertas" : "Ver concluídas"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition ${
        active
          ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
          : "border-tng-marine-600 text-tng-marine-200 hover:border-tng-marine-400 hover:text-tng-marine-50"
      }`}
    >
      {children}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  active,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`tng-select rounded-md border bg-tng-marine-800 px-2.5 py-1 text-xs text-tng-marine-100 transition focus:border-tng-orange-400 focus:outline-none ${
        active ? "border-tng-orange-400/60" : "border-tng-marine-600"
      }`}
    >
      {children}
    </select>
  );
}

function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="text-sm text-tng-marine-200">
        Nenhuma demanda corresponde aos filtros.
      </p>
      <button
        onClick={onClear}
        className="mt-2 text-xs text-tng-orange-400 hover:underline"
      >
        Limpar filtros
      </button>
    </div>
  );
}

// Badges compartilhados entre DemandCard (lista) e KanbanCard. Separados
// em "primary" (status + responsável — sempre presentes) e "secondary"
// (metadados — só aparecem quando aplicáveis). Layout em duas linhas no
// canto direito do card.
const INFRASTRUCTURE_BADGE: Record<DemandInfrastructure, { label: string; cls: string }> = {
  wordpress: { label: "WP", cls: "bg-sky-500/15 text-sky-300" },
  site_ia: { label: "Site IA", cls: "bg-violet-500/15 text-violet-300" },
};

// Renderiza os badges secundários do card numa única linha, ancorada à
// direita. Ordem visual (direita → esquerda): Responsável, Anexos,
// Comentários, Infraestrutura. Usamos flex-row-reverse pra que a ordem
// natural do JSX (primeiro = mais à direita) deixe o responsável fixo no
// canto direito enquanto badges opcionais aparecem ao seu lado esquerdo.
// O badge de status saiu — agora o status é mudado via StatusButtons.
export function DueBadge({ dueDate }: { dueDate: string | null | undefined }) {
  const info = formatDueDate(dueDate);
  if (!info) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${DUE_TONE_CLASSES[info.tone]}`}
      title={info.fullLabel}
    >
      Prazo: {info.dateLabel} ({info.relativeLabel})
    </span>
  );
}

export function CardBadges({
  demand,
  assigneeName,
}: {
  demand: Demand;
  assigneeName: string | null;
}) {
  const infra = demand.infrastructure ? INFRASTRUCTURE_BADGE[demand.infrastructure] : null;
  const anything =
    assigneeName ||
    infra ||
    demand.attachments_count > 0 ||
    demand.comments_count > 0;
  if (!anything) return null;
  return (
    <div className="flex flex-row-reverse flex-wrap items-center gap-1.5">
      {assigneeName && (
        <span
          className="flex items-center gap-1 rounded-full bg-tng-marine-700/80 px-1.5 py-0.5 text-[10px] text-tng-marine-100"
          title={`Responsável: ${assigneeName}`}
        >
          <i className="fa-solid fa-user text-[9px]" aria-hidden="true" />
          {assigneeName}
        </span>
      )}
      {demand.attachments_count > 0 && (
        <span
          className="flex items-center gap-1 rounded-full bg-tng-marine-700/80 px-1.5 py-0.5 text-[10px] text-tng-marine-200"
          title={`${demand.attachments_count} anexo${demand.attachments_count === 1 ? "" : "s"}`}
        >
          <i className="fa-solid fa-paperclip text-[9px]" aria-hidden="true" />
          {demand.attachments_count}
        </span>
      )}
      {demand.comments_count > 0 && (
        <span
          className="flex items-center gap-1 rounded-full bg-tng-marine-700/80 px-1.5 py-0.5 text-[10px] text-tng-marine-200"
          title={`${demand.comments_count} comentário${demand.comments_count === 1 ? "" : "s"}`}
        >
          <i className="fa-solid fa-comment text-[9px]" aria-hidden="true" />
          {demand.comments_count}
        </span>
      )}
      {infra && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${infra.cls}`}
          title="Infraestrutura"
        >
          {infra.label}
        </span>
      )}
    </div>
  );
}

// Trilha rápida de status — clicar atualiza direto sem abrir drawer.
// Usado no card da lista (com filtro de "está aberta") e no header do
// drawer (com select removido).
//
// Paleta separada da prioridade pra não confundir:
//   - A fazer:      teal (verde-água)  — neutro, "em fila"
//   - Em andamento: emerald borda+texto, sem bg — "trabalho ativo"
//   - Concluída:    emerald com bg só no hover/ativo — "fechado"
// Antes "Em andamento" era laranja, que conflitava com prioridade Alta.
const STATUS_TRACK: {
  value: DemandStatus;
  label: string;
  active: string;
  inactive: string;
}[] = [
  {
    value: "todo",
    label: "A fazer",
    active: "bg-transparent text-teal-300 border-teal-400",
    inactive: "text-tng-marine-300 border-tng-marine-600 hover:border-teal-400/60 hover:text-teal-300",
  },
  {
    value: "doing",
    label: "Em andamento",
    active: "bg-transparent text-emerald-300 border-emerald-400",
    inactive: "text-tng-marine-300 border-tng-marine-600 hover:border-emerald-400/60 hover:text-emerald-300",
  },
  {
    value: "done",
    label: "Concluída",
    active: "bg-emerald-500/30 text-emerald-100 border-emerald-400",
    inactive: "text-tng-marine-300 border-tng-marine-600 hover:bg-emerald-500/15 hover:border-emerald-400/60 hover:text-emerald-200",
  },
];

export function StatusButtons({
  current,
  onChange,
  saving = false,
  size = "sm",
  stopPropagation = false,
}: {
  current: DemandStatus;
  onChange: (s: DemandStatus) => void;
  saving?: boolean;
  size?: "sm" | "md";
  // Cards da lista são clicáveis e abrem o drawer; precisamos parar o evento
  // pra esses botões não fazerem ambas as coisas.
  stopPropagation?: boolean;
}) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <div className="flex items-center gap-1">
      {STATUS_TRACK.map((s) => {
        const isActive = current === s.value;
        return (
          <button
            key={s.value}
            type="button"
            disabled={saving || isActive}
            onClick={(e) => {
              if (stopPropagation) e.stopPropagation();
              onChange(s.value);
            }}
            aria-pressed={isActive}
            className={`rounded-md border font-medium transition disabled:cursor-default ${pad} ${
              isActive ? s.active : s.inactive
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function StatFilterCard({
  label,
  value,
  active,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  // Ícone opcional ao lado do número (usado em "Atrasadas").
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border bg-tng-marine-800/40 px-4 py-3 text-left transition ${
        active
          ? "border-tng-orange-400 bg-tng-marine-800/80"
          : "border-tng-marine-700 hover:border-tng-marine-500 hover:bg-tng-marine-800/60"
      }`}
    >
      <div className="flex items-center gap-2 font-sans text-2xl font-semibold text-tng-marine-50">
        <span>{value}</span>
        {icon}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-tng-marine-300">{label}</div>
    </button>
  );
}

function DemandCard({
  demand,
  assigneeName,
  onSelect,
}: {
  demand: Demand;
  assigneeName: string | null;
  onSelect: () => void;
}) {
  const previewText = htmlToPlainText(legacyToHtml(demand.description));
  const title = demand.title || previewText.slice(0, 80);
  const showPreview =
    previewText.length > title.length && previewText.slice(0, title.length) !== title;

  // Status fica em estado otimista local pra UX imediata quando o user
  // clica num dos botões — sem isso, ele veria o botão "Em andamento"
  // demorar a destacar até o realtime confirmar. (A supressão de auto-notificação
  // agora é server-side: os triggers não notificam quem fez a ação.)
  const [optimisticStatus, setOptimisticStatus] = useState<DemandStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const currentStatus = optimisticStatus ?? demand.status;
  // Quando a prop muda (realtime confirmou), libera o estado otimista.
  useEffect(() => {
    if (optimisticStatus && demand.status === optimisticStatus) {
      setOptimisticStatus(null);
    }
  }, [demand.status, optimisticStatus]);

  async function handleStatus(s: DemandStatus) {
    if (saving || s === currentStatus) return;
    setOptimisticStatus(s);
    setSaving(true);
    const { error } = await updateDemand(demand.id, { status: s });
    setSaving(false);
    if (error) {
      setOptimisticStatus(null);
      window.alert(`Falha ao atualizar status: ${error}`);
    }
  }

  return (
    <li
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 px-4 py-3 transition hover:border-tng-orange-400/50 focus:border-tng-orange-400 focus:outline-none"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[demand.priority]}`}
              title={`Prioridade: ${PRIORITY_LABEL[demand.priority]}`}
            />
            <h3 className="truncate text-sm font-medium text-tng-marine-50">{title}</h3>
          </div>
          {showPreview && (
            <p className="mt-1 line-clamp-2 text-xs text-tng-marine-300">{previewText}</p>
          )}
          <p className="mt-1.5 text-[10px] text-tng-marine-400">
            {formatRelative(demand.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <CardBadges demand={demand} assigneeName={assigneeName} />
          <StatusButtons
            current={currentStatus}
            onChange={handleStatus}
            saving={saving}
            stopPropagation
          />
          <DueBadge dueDate={demand.due_date} />
        </div>
      </div>
    </li>
  );
}

function EmptyState({ hotkey }: { hotkey: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="rounded-full border border-tng-marine-600 bg-tng-marine-800/40 px-3 py-1.5 font-mono text-xs text-tng-marine-200">
        {hotkey}
      </div>
      <h2 className="mt-4 font-sans text-lg font-semibold text-tng-marine-50">
        Nenhuma demanda ainda
      </h2>
      <p className="mt-2 max-w-sm text-sm text-tng-marine-300">
        Pressione <span className="font-mono text-tng-orange-400">{hotkey}</span>{" "}
        em qualquer lugar para registrar a primeira captura da equipe.
      </p>
    </div>
  );
}
