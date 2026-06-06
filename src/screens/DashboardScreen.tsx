import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { listDemands, subscribeToDemands } from "../lib/demands";
import { subscribeToAllCommentInserts } from "../lib/comments";
import { ensureNotificationPermission, notify } from "../lib/notifications";
import { setTrayBadge } from "../lib/tray";
import { listActiveClients, listActiveProfiles, type ClientOption, type ProfileOption } from "../lib/lookups";
import { DemandDetailDrawer } from "../components/DemandDetailDrawer";
import { KanbanBoard } from "../components/KanbanBoard";
import { SearchPalette } from "../components/SearchPalette";
import { ClientsAdmin } from "../components/ClientsAdmin";
import { MembersAdmin } from "../components/MembersAdmin";
import { AiUsageAdmin } from "../components/AiUsageAdmin";
import { RulesAdmin } from "../components/RulesAdmin";
import { UpdateBanner } from "../components/UpdateBanner";
import { listAllProfiles } from "../lib/profiles";
import type { Demand, DemandPriority, DemandStatus } from "../types/database";
import logoDark from "../assets/brand/logo-dark.png";

type StatusFilter = DemandStatus | "all";
type PriorityFilter = DemandPriority | "all";
type RefFilter = string | "all" | "none";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos os status" },
  { value: "todo", label: "A fazer" },
  { value: "doing", label: "Em andamento" },
  { value: "done", label: "Concluída" },
  { value: "archived", label: "Arquivada" },
];

const PRIORITY_FILTER_OPTIONS: { value: PriorityFilter; label: string }[] = [
  { value: "all", label: "Toda prioridade" },
  { value: "urgente", label: "Urgente" },
  { value: "alta", label: "Alta" },
  { value: "media", label: "Média" },
  { value: "baixa", label: "Baixa" },
];

const STATUS_LABEL: Record<DemandStatus, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  done: "Concluída",
  archived: "Arquivada",
};

const STATUS_STYLE: Record<DemandStatus, string> = {
  todo: "bg-tng-marine-600/60 text-tng-marine-100",
  doing: "bg-tng-orange-400/15 text-tng-orange-300",
  done: "bg-emerald-500/15 text-emerald-300",
  archived: "bg-tng-marine-700 text-tng-marine-300",
};

const PRIORITY_DOT: Record<DemandPriority, string> = {
  baixa: "bg-tng-marine-400",
  media: "bg-sky-400",
  alta: "bg-tng-orange-400",
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

function demandLabel(d: { title: string; description: string }): string {
  return d.title || d.description.slice(0, 80);
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
  const [isAdmin, setIsAdmin] = useState(false);

  // Detecta papel admin do usuário atual para liberar gestão de regras.
  useEffect(() => {
    if (!currentUserId) return;
    (async () => {
      const all = await listAllProfiles();
      const me = all.data.find((p) => p.id === currentUserId);
      setIsAdmin(me?.role === "admin");
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

  // Subscreve realtime de demandas
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

      // Notifica reatribuição para o usuário atual
      const me = currentUserIdRef.current;
      if (
        event === "UPDATE" &&
        change.new &&
        me &&
        change.new.assignee_id === me &&
        change.old?.assignee_id !== me
      ) {
        void notify(
          "Demanda atribuída a você",
          demandLabel(change.new),
        );
      }
    });
    setRealtimeConnected(true);
    return () => {
      setRealtimeConnected(false);
      unsubscribe();
    };
  }, []);

  // Subscreve INSERTs de comentários em qualquer demanda e notifica os que
  // chegam em demandas em que sou responsável ou criador (e que não foram
  // feitos por mim).
  useEffect(() => {
    const unsubscribe = subscribeToAllCommentInserts((comment) => {
      const me = currentUserIdRef.current;
      if (!me) return;
      if (comment.author_id === me) return;
      const demand = demandsRef.current.find((d) => d.id === comment.demand_id);
      if (!demand) return;
      if (demand.assignee_id !== me && demand.created_by !== me) return;
      void notify(
        `Novo comentário em "${demandLabel(demand)}"`,
        comment.content.slice(0, 140),
      );
    });
    return unsubscribe;
  }, []);

  const selectedDemand = useMemo(
    () => demands.find((d) => d.id === selectedDemandId) ?? null,
    [demands, selectedDemandId],
  );

  const filteredDemands = useMemo(() => {
    return demands.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (priorityFilter !== "all" && d.priority !== priorityFilter) return false;
      if (clientFilter === "none" && d.client_id !== null) return false;
      if (clientFilter !== "all" && clientFilter !== "none" && d.client_id !== clientFilter) return false;
      if (assigneeFilter === "none" && d.assignee_id !== null) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "none" && d.assignee_id !== assigneeFilter) return false;
      return true;
    });
  }, [demands, statusFilter, priorityFilter, clientFilter, assigneeFilter]);

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

  const stats = useMemo(() => {
    const total = filteredDemands.length;
    const todo = filteredDemands.filter((d) => d.status === "todo").length;
    const doing = filteredDemands.filter((d) => d.status === "doing").length;
    const today = filteredDemands.filter((d) => {
      const now = new Date();
      const created = new Date(d.created_at);
      return (
        created.getDate() === now.getDate() &&
        created.getMonth() === now.getMonth() &&
        created.getFullYear() === now.getFullYear()
      );
    }).length;
    return { total, todo, doing, today };
  }, [filteredDemands]);

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
          <span className="text-sm text-tng-marine-200">Demand Hub</span>
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
          <span className="text-xs text-tng-marine-300">{user?.email}</span>
          <button
            onClick={signOut}
            className="rounded-md border border-tng-marine-600 px-3 py-1.5 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-4 gap-3 border-b border-tng-marine-700 px-6 py-4">
        <Stat label="Total" value={stats.total} />
        <Stat label="A fazer" value={stats.todo} accent="text-sky-400" />
        <Stat label="Em andamento" value={stats.doing} accent="text-tng-orange-400" />
        <Stat label="Hoje" value={stats.today} accent="text-emerald-400" />
      </section>

      {/* Filtros */}
      <FilterBar
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        clientFilter={clientFilter}
        assigneeFilter={assigneeFilter}
        clients={clients}
        profiles={profiles}
        onStatusChange={setStatusFilter}
        onPriorityChange={setPriorityFilter}
        onClientChange={setClientFilter}
        onAssigneeChange={setAssigneeFilter}
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
          <EmptyState />
        ) : viewMode === "list" ? (
          filteredDemands.length === 0 ? (
            <FilteredEmptyState onClear={clearFilters} />
          ) : (
            <ul className="space-y-2">
              {filteredDemands.map((demand) => (
                <DemandCard
                  key={demand.id}
                  demand={demand}
                  onSelect={() => setSelectedDemandId(demand.id)}
                />
              ))}
            </ul>
          )
        ) : (
          <KanbanBoard
            demands={filteredDemands}
            onSelectDemand={setSelectedDemandId}
          />
        )}
      </main>

      <DemandDetailDrawer
        demand={selectedDemand}
        clients={clients}
        profiles={profiles}
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

function FilterBar(props: {
  statusFilter: StatusFilter;
  priorityFilter: PriorityFilter;
  clientFilter: RefFilter;
  assigneeFilter: RefFilter;
  clients: ClientOption[];
  profiles: ProfileOption[];
  onStatusChange: (v: StatusFilter) => void;
  onPriorityChange: (v: PriorityFilter) => void;
  onClientChange: (v: RefFilter) => void;
  onAssigneeChange: (v: RefFilter) => void;
  active: boolean;
  onClear: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-2 border-b border-tng-marine-700 bg-tng-marine-800/30 px-6 py-2">
      <FilterSelect
        value={props.statusFilter}
        onChange={(v) => props.onStatusChange(v as StatusFilter)}
        active={props.statusFilter !== "all"}
      >
        {STATUS_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} className="bg-tng-marine-800">
            {o.label}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        value={props.priorityFilter}
        onChange={(v) => props.onPriorityChange(v as PriorityFilter)}
        active={props.priorityFilter !== "all"}
      >
        {PRIORITY_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} className="bg-tng-marine-800">
            {o.label}
          </option>
        ))}
      </FilterSelect>

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

      <FilterSelect
        value={props.assigneeFilter}
        onChange={(v) => props.onAssigneeChange(v as RefFilter)}
        active={props.assigneeFilter !== "all"}
      >
        <option value="all" className="bg-tng-marine-800">Todos responsáveis</option>
        <option value="none" className="bg-tng-marine-800">Sem responsável</option>
        {props.profiles.map((p) => (
          <option key={p.id} value={p.id} className="bg-tng-marine-800">
            {p.full_name}
          </option>
        ))}
      </FilterSelect>

      {props.active && (
        <button
          type="button"
          onClick={props.onClear}
          className="ml-auto text-[11px] text-tng-marine-300 hover:text-tng-orange-400"
        >
          Limpar filtros
        </button>
      )}
    </section>
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
      className={`rounded-md border bg-tng-marine-800 px-2 py-1 text-xs text-tng-marine-100 transition focus:border-tng-orange-400 focus:outline-none ${
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

function Stat({
  label,
  value,
  accent = "text-tng-marine-50",
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 px-4 py-3">
      <div className={`font-sans text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-tng-marine-300">
        {label}
      </div>
    </div>
  );
}

function DemandCard({ demand, onSelect }: { demand: Demand; onSelect: () => void }) {
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
            <h3 className="truncate text-sm font-medium text-tng-marine-50">
              {demand.title || demand.description.slice(0, 80)}
            </h3>
          </div>
          {demand.description !== demand.title && demand.description.length > demand.title.length && (
            <p className="mt-1 line-clamp-2 text-xs text-tng-marine-300">
              {demand.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[demand.status]}`}
          >
            {STATUS_LABEL[demand.status]}
          </span>
          <span className="text-[10px] text-tng-marine-400">
            {formatRelative(demand.created_at)}
          </span>
        </div>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="rounded-full border border-tng-marine-600 bg-tng-marine-800/40 px-3 py-1.5 text-[10px] uppercase tracking-wider text-tng-marine-300">
        ⌘⇧D
      </div>
      <h2 className="mt-4 font-sans text-lg font-semibold text-tng-marine-50">
        Nenhuma demanda ainda
      </h2>
      <p className="mt-2 max-w-sm text-sm text-tng-marine-300">
        Pressione <span className="text-tng-orange-400">Cmd + Shift + D</span> em qualquer lugar para registrar a primeira captura da equipe.
      </p>
    </div>
  );
}
