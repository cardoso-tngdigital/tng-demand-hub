// =============================================================================
// PerformancePanel — Painel de desempenho dos membros (admin)
// =============================================================================
// Modal que consulta o RPC `member_performance_metrics` e exibe métricas
// agregadas por membro ativo: concluídas no período, em aberto, atrasadas,
// tempo médio total, tempo de resposta (todo→doing) e tempo de execução
// (doing→done). RLS no RPC garante acesso só pra admin.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase/client";

type MetricRow = {
  member_id: string;
  member_name: string;
  completed_count: number;
  open_count: number;
  overdue_count: number;
  avg_total_seconds: number | null;
  avg_response_seconds: number | null;
  avg_execution_seconds: number | null;
};

type Period = "7d" | "30d" | "90d" | "custom";

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const abs = Math.abs(seconds);
  if (abs < 60) return `${Math.round(abs)}s`;
  if (abs < 3600) return `${Math.round(abs / 60)} min`;
  if (abs < 86400) return `${(abs / 3600).toFixed(1)} h`;
  return `${(abs / 86400).toFixed(1)} d`;
}

export function PerformancePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>("30d");
  const [customStart, setCustomStart] = useState<string>(daysAgo(30));
  const [customEnd, setCustomEnd] = useState<string>(isoDate(new Date()));
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, endDate] = useMemo(() => {
    const today = isoDate(new Date());
    if (period === "7d") return [daysAgo(7), today];
    if (period === "30d") return [daysAgo(30), today];
    if (period === "90d") return [daysAgo(90), today];
    return [customStart, customEnd];
  }, [period, customStart, customEnd]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error } = await supabase.rpc(
        "member_performance_metrics",
        { start_date: startDate, end_date: endDate },
      );
      if (error) {
        console.error("[Performance] RPC failed:", error);
        setError(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as MetricRow[]);
      }
      setLoading(false);
    })();
  }, [open, startDate, endDate]);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-tng-marine-600 bg-tng-marine-800 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-tng-marine-700 px-5 py-3">
          <div>
            <h2 className="font-sans text-sm font-semibold text-tng-marine-50">
              Desempenho da equipe
            </h2>
            <p className="text-[10px] text-tng-marine-400">
              Métricas por membro. Atualizadas em tempo real.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-tng-marine-400 transition hover:text-tng-marine-100"
            aria-label="Fechar"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-tng-marine-700 bg-tng-marine-800/40 px-5 py-2.5">
          <PeriodChip active={period === "7d"} onClick={() => setPeriod("7d")}>
            7 dias
          </PeriodChip>
          <PeriodChip active={period === "30d"} onClick={() => setPeriod("30d")}>
            30 dias
          </PeriodChip>
          <PeriodChip active={period === "90d"} onClick={() => setPeriod("90d")}>
            90 dias
          </PeriodChip>
          <PeriodChip
            active={period === "custom"}
            onClick={() => setPeriod("custom")}
          >
            Customizado
          </PeriodChip>
          {period === "custom" && (
            <div className="ml-2 flex items-center gap-1.5 text-[11px] text-tng-marine-300">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2 py-0.5 text-tng-marine-100"
              />
              <span>até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2 py-0.5 text-tng-marine-100"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-xs text-tng-marine-300">Carregando métricas…</p>
          ) : error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-tng-marine-400">
              Nenhum membro com dados neste período.
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-tng-marine-400">
                <tr>
                  <th className="pb-2 pr-3">Membro</th>
                  <th className="pb-2 px-2 text-right" title="Concluídas no período">
                    Concluídas
                  </th>
                  <th className="pb-2 px-2 text-right" title="Demandas em aberto agora">
                    Em aberto
                  </th>
                  <th className="pb-2 px-2 text-right" title="Em aberto com prazo vencido">
                    Atrasadas
                  </th>
                  <th
                    className="pb-2 px-2 text-right"
                    title="Tempo médio entre criação e conclusão"
                  >
                    Médio total
                  </th>
                  <th
                    className="pb-2 px-2 text-right"
                    title="Tempo entre criação e início do trabalho (todo → em andamento)"
                  >
                    Resposta
                  </th>
                  <th
                    className="pb-2 px-2 text-right"
                    title="Tempo entre início e conclusão (em andamento → concluída)"
                  >
                    Execução
                  </th>
                </tr>
              </thead>
              <tbody className="text-tng-marine-100">
                {rows.map((r) => (
                  <tr
                    key={r.member_id}
                    className="border-t border-tng-marine-700"
                  >
                    <td className="py-2 pr-3">{r.member_name}</td>
                    <td className="py-2 px-2 text-right font-semibold text-emerald-300">
                      {r.completed_count}
                    </td>
                    <td className="py-2 px-2 text-right">{r.open_count}</td>
                    <td
                      className={`py-2 px-2 text-right ${
                        r.overdue_count > 0 ? "font-semibold text-red-300" : ""
                      }`}
                    >
                      {r.overdue_count}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {formatDuration(r.avg_total_seconds)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {formatDuration(r.avg_response_seconds)}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {formatDuration(r.avg_execution_seconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="border-t border-tng-marine-700 bg-tng-marine-800/60 px-5 py-2 text-[10px] text-tng-marine-400">
          Período: {startDate} a {endDate} · "Em aberto" e "Atrasadas" são
          snapshot do momento atual (não dependem do período).
        </footer>
      </div>
    </div>
  );
}

function PeriodChip({
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
      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
        active
          ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
          : "border-tng-marine-600 text-tng-marine-300 hover:border-tng-marine-400 hover:text-tng-marine-100"
      }`}
    >
      {children}
    </button>
  );
}
