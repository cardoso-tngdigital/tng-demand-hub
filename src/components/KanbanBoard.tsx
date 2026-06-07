import { useRef, useState, type DragEvent } from "react";
import { updateDemand } from "../lib/demands";
import { htmlToPlainText, legacyToHtml } from "../lib/htmlContent";
import { CardBadges } from "../screens/DashboardScreen";
import type { Demand, DemandPriority, DemandStatus } from "../types/database";

const COLUMNS: { status: DemandStatus; label: string; accent: string }[] = [
  { status: "todo", label: "A fazer", accent: "border-sky-400/40" },
  { status: "doing", label: "Em andamento", accent: "border-tng-orange-400/40" },
  { status: "done", label: "Concluída", accent: "border-emerald-400/40" },
  { status: "archived", label: "Arquivada", accent: "border-tng-marine-500/40" },
];

const PRIORITY_DOT: Record<DemandPriority, string> = {
  baixa: "bg-tng-marine-400",
  media: "bg-sky-400",
  alta: "bg-tng-orange-400",
  urgente: "bg-red-500",
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}

export function KanbanBoard({
  demands,
  profileNameById,
  onSelectDemand,
}: {
  demands: Demand[];
  // Map id → nome do responsável. Carregado uma vez no Dashboard e passado
  // pra cá pra evitar lookup linear por card.
  profileNameById: Map<string, string>;
  onSelectDemand: (id: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<DemandStatus | null>(null);
  // Fonte da verdade do id sendo arrastado. Alguns webviews não preservam
  // os dados de `dataTransfer` durante o dragover, então usamos uma ref.
  const draggingIdRef = useRef<string | null>(null);

  async function handleDrop(targetStatus: DemandStatus) {
    const demandId = draggingIdRef.current;
    setDraggingId(null);
    setOverStatus(null);
    draggingIdRef.current = null;
    if (!demandId) return;
    const demand = demands.find((d) => d.id === demandId);
    if (!demand || demand.status === targetStatus) return;
    await updateDemand(demandId, { status: targetStatus });
  }

  return (
    <div className="grid h-full grid-cols-4 gap-3">
      {COLUMNS.map((col) => {
        const cards = demands.filter((d) => d.status === col.status);
        const isOver = overStatus === col.status;
        return (
          <div
            key={col.status}
            onDragOver={(e) => {
              if (!draggingIdRef.current) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overStatus !== col.status) setOverStatus(col.status);
            }}
            onDragEnter={(e) => {
              if (!draggingIdRef.current) return;
              e.preventDefault();
              setOverStatus(col.status);
            }}
            onDragLeave={(e: DragEvent<HTMLDivElement>) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setOverStatus((s) => (s === col.status ? null : s));
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              void handleDrop(col.status);
            }}
            className={`flex h-full min-h-0 flex-col rounded-lg border bg-tng-marine-800/30 transition ${
              isOver
                ? `border-tng-orange-400 bg-tng-marine-800/60`
                : `border-tng-marine-700 ${col.accent}`
            }`}
          >
            <header className="flex items-center justify-between border-b border-tng-marine-700/60 px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-tng-marine-200">
                {col.label}
              </span>
              <span className="rounded-full bg-tng-marine-700/80 px-1.5 py-0.5 text-[10px] text-tng-marine-200">
                {cards.length}
              </span>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {cards.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-tng-marine-400">Vazio</p>
              ) : (
                cards.map((d) => (
                  <KanbanCard
                    key={d.id}
                    demand={d}
                    assigneeName={
                      d.assignee_id ? profileNameById.get(d.assignee_id) ?? null : null
                    }
                    dragging={draggingId === d.id}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", d.id);
                      draggingIdRef.current = d.id;
                      setDraggingId(d.id);
                    }}
                    onDragEnd={() => {
                      draggingIdRef.current = null;
                      setDraggingId(null);
                      setOverStatus(null);
                    }}
                    onSelect={() => onSelectDemand(d.id)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  demand,
  assigneeName,
  dragging,
  onDragStart,
  onDragEnd,
  onSelect,
}: {
  demand: Demand;
  assigneeName: string | null;
  dragging: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      className={`cursor-grab rounded-md border border-tng-marine-700 bg-tng-marine-800 px-3 py-2 transition hover:border-tng-orange-400/60 focus:border-tng-orange-400 focus:outline-none active:cursor-grabbing ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[demand.priority]}`}
        />
        <p className="line-clamp-3 text-xs leading-snug text-tng-marine-50">
          {demand.title || htmlToPlainText(legacyToHtml(demand.description)).slice(0, 80)}
        </p>
      </div>
      <CardBadges demand={demand} assigneeName={assigneeName} className="mt-2" />
      <p className="mt-1.5 text-[10px] text-tng-marine-400">{formatRelative(demand.created_at)}</p>
    </div>
  );
}
