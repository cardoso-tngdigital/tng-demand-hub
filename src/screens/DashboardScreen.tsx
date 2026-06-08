import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { listDemands, subscribeToDemands, updateDemand } from "../lib/demands";
import { subscribeToAllCommentInserts } from "../lib/comments";
import {
  ensureNotificationPermission,
  notifyAboutDemand,
  subscribeToNotificationClick,
  wasLocalChange,
} from "../lib/notifications";
import {
  decideCommentNotification,
  decideDemandNotification,
} from "../lib/notificationDecider";
import { setTrayBadge } from "../lib/tray";
import { htmlToPlainText, legacyToHtml } from "../lib/htmlContent";
import { listActiveClients, listActiveProfiles, type ClientOption, type ProfileOption } from "../lib/lookups";
import { DemandDetailDrawer } from "../components/DemandDetailDrawer";
import { KanbanBoard } from "../components/KanbanBoard";
import { SearchPalette } from "../components/SearchPalette";
import { ClientsAdmin } from "../components/ClientsAdmin";
import { MembersAdmin } from "../components/MembersAdmin";
import { AiUsageAdmin } from "../components/AiUsageAdmin";
import { RulesAdmin } from "../components/RulesAdmin";
import { HotkeySettings } from "../components/HotkeySettings";
import { UpdateBanner } from "../components/UpdateBanner";
import { OnboardingTour } from "../components/OnboardingTour";
import { listAllProfiles } from "../lib/profiles";
import { displayHotkey, getStoredHotkey } from "../lib/hotkey";
import type {
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

export function DashboardScreen() {
  const { user, signOut } = useAuth();
  const currentUserId = user?.id ?? null;
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [clientFilter, setClientFilter] = useState<RefFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<RefFilter>("all");
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [clientsAdminOpen, setClientsAdminOpen] = useState(false);
  const [membersAdminOpen, setMembersAdminOpen] = useState(false);
  const [aiUsageOpen, setAiUsageOpen] = useState(false);
  const [rulesAdminOpen, setRulesAdminOpen] = useState(false);
  const [hotkeySettingsOpen, setHotkeySettingsOpen] = useState(false);
  const [currentHotkey, setCurrentHotkey] = useState<string>(() =>
    getStoredHotkey(),
  );
  const [isAdmin, setIsAdmin] = useState(false);
  // Nome de exibição do user atual — preferimos full_name a email no header
  // e em qualquer outro lugar do app. Email só aparece como tooltip.
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

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
  }, [currentUserId, membersAdminOpen]);

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

  // Clique em notificação nativa → abre o drawer da demanda correspondente.
  // O macOS não entrega o click como evento JS no body da notificação; usamos
  // foco recente da janela main como proxy (ver notifications.ts).
  useEffect(() => {
    return subscribeToNotificationClick((demandId) => {
      setSelectedDemandId(demandId);
    });
  }, []);

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

  // Referência sempre atualizada de demandas + user atual, usadas dentro
  // dos callbacks de realtime (que rodam fora do ciclo de render).
  const demandsRef = useRef<Demand[]>([]);
  useEffect(() => {
    demandsRef.current = demands;
  }, [demands]);
  const currentUserIdRef = useRef<string | null>(currentUserId);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);
  // Refs também pra isAdmin, clients e profiles — usadas nos callbacks de
  // realtime (notificationDecider) sem precisar reassinar as subscriptions
  // a cada mudança.
  const isAdminRef = useRef<boolean>(isAdmin);
  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);
  const clientsRef = useRef<ClientOption[]>(clients);
  useEffect(() => {
    clientsRef.current = clients;
  }, [clients]);
  const profilesRef = useRef<ProfileOption[]>(profiles);
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  // Subscreve realtime de demandas + decide notificação por role via decider.
  // Admin recebe TUDO (exceto suas próprias ações); membro só o que envolve
  // ele (assignee/created_by). Toda a matriz de decisão fica em
  // notificationDecider.ts (testada à parte).
  useEffect(() => {
    const unsubscribe = subscribeToDemands((event, change) => {
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

      const notif = decideDemandNotification({
        event,
        change,
        me: currentUserIdRef.current,
        role: isAdminRef.current ? "admin" : "member",
        wasLocalChange,
        ctx: {
          clientName: (id) =>
            id
              ? clientsRef.current.find((c) => c.id === id)?.name
              : undefined,
          profileName: (id) =>
            id
              ? profilesRef.current.find((p) => p.id === id)?.full_name
              : undefined,
        },
      });
      if (notif) {
        void notifyAboutDemand(notif.title, notif.body, notif.demandId);
      }
    });
    setRealtimeConnected(true);
    return () => {
      setRealtimeConnected(false);
      unsubscribe();
    };
  }, []);

  // Subscreve INSERTs de comentários em qualquer demanda — decisão de
  // notificar fica no decider (admin vê tudo; membro só sobre demandas dele).
  useEffect(() => {
    const unsubscribe = subscribeToAllCommentInserts((comment) => {
      const notif = decideCommentNotification({
        comment,
        demand:
          demandsRef.current.find((d) => d.id === comment.demand_id) ?? null,
        me: currentUserIdRef.current,
        role: isAdminRef.current ? "admin" : "member",
      });
      if (notif) {
        void notifyAboutDemand(notif.title, notif.body, notif.demandId);
      }
    });
    return unsubscribe;
  }, []);

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
      return true;
    });
  }, [demands, statusFilter, priorityFilter, clientFilter, assigneeFilter, isOverdue]);

  // Versão da lista — segue 3 modos:
  //   - statusFilter !== "all"  → só o que o filtro pediu (incluindo overdue)
  //   - statusFilter === "all" && !showClosed → só abertas (todo+doing)
  //   - statusFilter === "all" && showClosed  → SÓ concluídas/arquivadas
  //     (o toggle vira filtro exclusivo: o user quer revisar quais foram
  //     fechadas, não ver tudo misturado).
  const demandsForList = useMemo(() => {
    if (statusFilter !== "all") return baseFiltered;
    if (showClosed) {
      return baseFiltered.filter((d) => d.status === "done" || d.status === "archived");
    }
    return baseFiltered.filter((d) => d.status !== "done" && d.status !== "archived");
  }, [baseFiltered, statusFilter, showClosed]);

  // Versão do Kanban: usa só os filtros explícitos, sem esconder concluídas.
  const kanbanDemands = baseFiltered;

  const filtersActive =
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    clientFilter !== "all" ||
    assigneeFilter !== "all";

  function clearFilters() {
    setStatusFilter("all");
    setPriorityFilter("all");
    setClientFilter("all");
    setAssigneeFilter("all");
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

      {/* Header */}
      <header
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-3"
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
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <button
            type="button"
            onClick={() => setClientsAdminOpen(true)}
            className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-[11px] text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
            title="Gerenciar clientes"
          >
            Clientes
          </button>
          <button
            type="button"
            onClick={() => setMembersAdminOpen(true)}
            className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-[11px] text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
            title="Gerenciar membros"
          >
            Membros
          </button>
          <button
            type="button"
            onClick={() => setAiUsageOpen(true)}
            className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-[11px] text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
            title="Consumo de IA do mês"
          >
            Uso IA
          </button>
          <button
            type="button"
            onClick={() => setRulesAdminOpen(true)}
            className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-[11px] text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
            title="Regras de auto-classificação"
          >
            Regras
          </button>
          <button
            type="button"
            onClick={() => setHotkeySettingsOpen(true)}
            className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-[11px] text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
            title="Configurar atalho da captura"
          >
            <i className="fa-solid fa-keyboard mr-1.5" aria-hidden="true" />
            <span className="font-mono">{displayHotkey(currentHotkey)}</span>
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
        onPriorityChange={setPriorityFilter}
        onClientChange={setClientFilter}
        onAssigneeChange={setAssigneeFilter}
        onShowClosedChange={setShowClosed}
        active={filtersActive}
        onClear={clearFilters}
      />

      {/* Lista ou Kanban */}
      <main
        className={
          viewMode === "list"
            ? "flex-1 overflow-y-auto px-6 py-5"
            : "flex-1 overflow-hidden px-6 py-5"
        }
      >
        {loading ? (
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

      <DemandDetailDrawer
        demand={selectedDemand}
        clients={clients}
        profiles={profiles}
        isAdmin={isAdmin}
        onClose={() => setSelectedDemandId(null)}
      />

      <SearchPalette
        open={searchOpen}
        demands={demands}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => setSelectedDemandId(id)}
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
          setCurrentHotkey(getStoredHotkey());
        }}
      />

      <OnboardingTour />
    </div>
  );
}

function ViewToggle({
  mode,
  onChange,
}: {
  mode: "list" | "kanban";
  onChange: (m: "list" | "kanban") => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-tng-marine-600">
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`px-2.5 py-1 text-[11px] transition ${
          mode === "list"
            ? "bg-tng-marine-600 text-tng-marine-50"
            : "text-tng-marine-300 hover:bg-tng-marine-700/60 hover:text-tng-marine-100"
        }`}
      >
        Lista
      </button>
      <button
        type="button"
        onClick={() => onChange("kanban")}
        className={`px-2.5 py-1 text-[11px] transition ${
          mode === "kanban"
            ? "bg-tng-marine-600 text-tng-marine-50"
            : "text-tng-marine-300 hover:bg-tng-marine-700/60 hover:text-tng-marine-100"
        }`}
      >
        Kanban
      </button>
    </div>
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
  onPriorityChange: (v: PriorityFilter) => void;
  onClientChange: (v: RefFilter) => void;
  onAssigneeChange: (v: RefFilter) => void;
  onShowClosedChange: (v: boolean) => void;
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

        {/* Toggle só faz sentido quando estamos na vista "todas em aberto"
            (statusFilter=all). Se já filtra por todo/doing/overdue, esse
            switch não tem efeito. */}
        {props.statusFilter === "all" && (
          <button
            type="button"
            onClick={() => props.onShowClosedChange(!props.showClosed)}
            aria-pressed={props.showClosed}
            className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] transition ${
              props.showClosed
                ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
                : "border-tng-marine-600 text-tng-marine-300 hover:border-tng-marine-400 hover:text-tng-marine-100"
            }`}
          >
            {props.showClosed ? "Voltar às abertas" : "Ver concluídas"}
          </button>
        )}
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
  // demorar a destacar até o realtime confirmar. wasLocalChange continua
  // suprimindo eco de notificação.
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
        </div>
      </div>
    </li>
  );
}

function EmptyState({ hotkey }: { hotkey: string }) {
  const display = displayHotkey(hotkey);
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="rounded-full border border-tng-marine-600 bg-tng-marine-800/40 px-3 py-1.5 font-mono text-xs text-tng-marine-200">
        {display}
      </div>
      <h2 className="mt-4 font-sans text-lg font-semibold text-tng-marine-50">
        Nenhuma demanda ainda
      </h2>
      <p className="mt-2 max-w-sm text-sm text-tng-marine-300">
        Pressione <span className="font-mono text-tng-orange-400">{display}</span>{" "}
        em qualquer lugar para registrar a primeira captura da equipe.
      </p>
    </div>
  );
}
