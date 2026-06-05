import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { listDemands, subscribeToDemands } from "../lib/demands";
import { DemandDetailDrawer } from "../components/DemandDetailDrawer";
import type { Demand, DemandPriority, DemandStatus } from "../types/database";
import logoDark from "../assets/brand/logo-dark.png";

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

export function DashboardScreen() {
  const { user, signOut } = useAuth();
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);

  // Carrega lista inicial
  useEffect(() => {
    (async () => {
      const { data, error } = await listDemands();
      if (error) setError(error);
      else setDemands(data);
      setLoading(false);
    })();
  }, []);

  // Subscreve realtime
  useEffect(() => {
    const unsubscribe = subscribeToDemands((event, demand) => {
      setDemands((prev) => {
        if (event === "INSERT") {
          if (prev.some((d) => d.id === demand.id)) return prev;
          return [demand, ...prev];
        }
        if (event === "UPDATE") {
          return prev.map((d) => (d.id === demand.id ? demand : d));
        }
        if (event === "DELETE") {
          return prev.filter((d) => d.id !== demand.id);
        }
        return prev;
      });
    });
    setRealtimeConnected(true);
    return () => {
      setRealtimeConnected(false);
      unsubscribe();
    };
  }, []);

  const selectedDemand = useMemo(
    () => demands.find((d) => d.id === selectedDemandId) ?? null,
    [demands, selectedDemandId],
  );

  const stats = useMemo(() => {
    const total = demands.length;
    const todo = demands.filter((d) => d.status === "todo").length;
    const doing = demands.filter((d) => d.status === "doing").length;
    const today = demands.filter((d) => {
      const today = new Date();
      const created = new Date(d.created_at);
      return (
        created.getDate() === today.getDate() &&
        created.getMonth() === today.getMonth() &&
        created.getFullYear() === today.getFullYear()
      );
    }).length;
    return { total, todo, doing, today };
  }, [demands]);

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen flex-col bg-tng-marine-900"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-3">
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

      {/* Lista */}
      <main className="flex-1 overflow-y-auto px-6 py-5">
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
        ) : (
          <ul className="space-y-2">
            {demands.map((demand) => (
              <DemandCard
                key={demand.id}
                demand={demand}
                onSelect={() => setSelectedDemandId(demand.id)}
              />
            ))}
          </ul>
        )}
      </main>

      <DemandDetailDrawer
        demand={selectedDemand}
        onClose={() => setSelectedDemandId(null)}
      />
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
