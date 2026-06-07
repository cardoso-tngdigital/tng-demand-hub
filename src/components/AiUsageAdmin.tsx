import { Fragment, useEffect, useMemo, useState } from "react";
import {
  bucketByDay,
  bucketByUser,
  listUsageBetween,
  microToUsd,
  monthBounds,
  summarize,
  type AiUsageRow,
} from "../lib/aiUsage";
import type { ProfileOption } from "../lib/lookups";

function monthLabel(year: number, month: number): string {
  const months = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${months[month - 1]}/${year}`;
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AiUsageAdmin({
  open,
  profiles,
  onClose,
}: {
  open: boolean;
  profiles: ProfileOption[];
  onClose: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [rows, setRows] = useState<AiUsageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<AiUsageRow | null>(null);

  useEffect(() => {
    if (!open) return;
    const { from, to } = monthBounds(year, month);
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error } = await listUsageBetween(from, to);
      if (error) setError(error);
      else setRows(data);
      setLoading(false);
    })();
  }, [open, year, month]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const profileNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name);
    return m;
  }, [profiles]);

  const summary = useMemo(() => summarize(rows), [rows]);
  const byDay = useMemo(() => bucketByDay(rows), [rows]);
  const byUser = useMemo(() => bucketByUser(rows), [rows]);
  const maxDailyCount = useMemo(
    () => byDay.reduce((m, b) => Math.max(m, b.count), 0),
    [byDay],
  );

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-tng-marine-900/95 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-sans text-base font-semibold text-tng-marine-50">Uso da IA</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-md border border-tng-marine-600 px-2 py-0.5 text-[10px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-400"
            >
              ←
            </button>
            <span className="min-w-[80px] text-center text-xs text-tng-marine-100">
              {monthLabel(year, month)}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-md border border-tng-marine-600 px-2 py-0.5 text-[10px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-400"
            >
              →
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Cards de stats */}
        <section className="grid grid-cols-5 gap-3">
          <SummaryCard label="Chamadas" value={summary.total.toString()} sub={`${summary.success} ok · ${summary.errors} erro`} />
          <SummaryCard
            label="Tokens entrada"
            value={summary.inputTokens.toLocaleString("pt-BR")}
          />
          <SummaryCard
            label="Tokens saída"
            value={summary.outputTokens.toLocaleString("pt-BR")}
          />
          <SummaryCard
            label="Custo estimado"
            value={formatUsd(microToUsd(summary.costMicroTotal))}
            sub="Gemini 2.5 Flash"
            accent="text-tng-orange-400"
          />
          <SummaryCard
            label="Latência média"
            value={`${summary.avgLatencyMs} ms`}
          />
        </section>

        {/* Histograma diário */}
        <section>
          <h3 className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-300">
            Por dia
          </h3>
          {loading ? (
            <p className="text-xs text-tng-marine-400">Carregando…</p>
          ) : byDay.length === 0 ? (
            <p className="text-xs text-tng-marine-400">Sem chamadas neste mês.</p>
          ) : (
            <ul className="space-y-1">
              {byDay.map((b) => (
                <li key={b.date} className="flex items-center gap-3 text-[11px]">
                  <span className="w-20 shrink-0 text-tng-marine-300">{b.date}</span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-tng-marine-800/60">
                    <div
                      className="h-full rounded-sm bg-tng-orange-400/60"
                      style={{ width: `${maxDailyCount === 0 ? 0 : (b.count / maxDailyCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-tng-marine-100">{b.count}</span>
                  <span className="w-20 shrink-0 text-right text-tng-marine-300">
                    {formatUsd(microToUsd(b.costMicro))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Por usuário */}
        <section>
          <h3 className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-300">
            Por usuário
          </h3>
          {byUser.length === 0 ? (
            <p className="text-xs text-tng-marine-400">Sem dados.</p>
          ) : (
            <ul className="space-y-1">
              {byUser.map((u) => (
                <li
                  key={u.userId ?? "anon"}
                  className="flex items-center gap-3 rounded-md bg-tng-marine-800/40 px-3 py-1.5 text-[11px]"
                >
                  <span className="flex-1 truncate text-tng-marine-100">
                    {u.userId ? (profileNameById.get(u.userId) ?? u.userId) : "(desconhecido)"}
                  </span>
                  <span className="w-12 text-right text-tng-marine-200">{u.count}</span>
                  <span className="w-20 text-right text-tng-marine-300">
                    {formatUsd(microToUsd(u.costMicro))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Últimas chamadas */}
        <section>
          <h3 className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-300">
            Últimas chamadas
          </h3>
          {rows.length === 0 ? (
            <p className="text-xs text-tng-marine-400">Nenhuma chamada no período.</p>
          ) : (
            <ul className="space-y-1">
              {rows.slice(0, 30).map((r) => (
                <UsageItem
                  key={r.id}
                  row={r}
                  userName={r.user_id ? profileNameById.get(r.user_id) ?? null : null}
                  onInspect={() => setInspecting(r)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <UsageDetailDrawer
        row={inspecting}
        userName={
          inspecting?.user_id ? profileNameById.get(inspecting.user_id) ?? null : null
        }
        onClose={() => setInspecting(null)}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent = "text-tng-marine-50",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 px-4 py-3">
      <div className={`font-sans text-xl font-semibold ${accent}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-tng-marine-300">{label}</div>
      {sub && <div className="mt-1 text-[10px] text-tng-marine-400">{sub}</div>}
    </div>
  );
}

function UsageItem({
  row,
  userName,
  onInspect,
}: {
  row: AiUsageRow;
  userName: string | null;
  onInspect: () => void;
}) {
  const isError = row.status !== "success";
  return (
    <li>
      <button
        type="button"
        onClick={onInspect}
        className={`flex w-full items-center gap-3 rounded-md bg-tng-marine-800/40 px-3 py-1.5 text-left text-[11px] transition hover:bg-tng-marine-800/80 hover:ring-1 hover:ring-tng-orange-400/40 ${
          isError ? "border-l-2 border-red-500/60" : ""
        }`}
      >
        <span className="w-24 shrink-0 text-tng-marine-400">{formatTime(row.created_at)}</span>
        <span
          className={`w-14 shrink-0 text-[9px] uppercase tracking-wider ${
            isError ? "text-red-300" : "text-emerald-300"
          }`}
        >
          {row.status}
        </span>
        <span className="w-32 shrink-0 truncate text-tng-marine-200">{userName ?? "—"}</span>
        <span className="w-24 shrink-0 truncate text-tng-marine-300">{row.model}</span>
        <span className="flex-1 truncate text-tng-marine-400">
          {row.input_tokens}↓ · {row.output_tokens}↑
          {row.error_message && ` · ${row.error_message.slice(0, 60)}`}
        </span>
        <span className="w-16 shrink-0 text-right text-tng-marine-200">
          {row.latency_ms ?? "—"} ms
        </span>
        <span className="w-16 shrink-0 text-right text-tng-marine-300">
          {formatUsd(microToUsd(row.cost_micro))}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Drawer de detalhes — abre na lateral ao clicar numa linha de "Últimas
// chamadas". Mostra error_message completo (com botão de copiar) e metadados
// que não cabem na linha. Tooltip era a única forma antes; não dava pra
// copiar nem ler erros longos.
// ---------------------------------------------------------------------------

function UsageDetailDrawer({
  row,
  userName,
  onClose,
}: {
  row: AiUsageRow | null;
  userName: string | null;
  onClose: () => void;
}) {
  const open = row !== null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[ai-usage] copy failed:", err);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[60] transition-opacity ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-tng-marine-700 bg-tng-marine-800 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        {row && (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-tng-marine-700 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      row.status === "success"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {row.status}
                  </span>
                  <span className="text-[11px] text-tng-marine-300">
                    {formatTime(row.created_at)}
                  </span>
                </div>
                <p className="mt-2 truncate font-sans text-sm font-semibold text-tng-marine-50">
                  {row.model}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
              <DetailGrid
                items={[
                  ["Usuário", userName ?? row.user_id ?? "—"],
                  ["Tokens entrada", row.input_tokens.toLocaleString("pt-BR")],
                  ["Tokens saída", row.output_tokens.toLocaleString("pt-BR")],
                  ["Latência", `${row.latency_ms ?? "—"} ms`],
                  ["Custo estimado", formatUsd(microToUsd(row.cost_micro))],
                ]}
              />

              {row.error_message ? (
                <section>
                  <div className="mb-1.5 flex items-center justify-between">
                    <h4 className="text-[10px] uppercase tracking-wider text-tng-marine-300">
                      Mensagem de erro
                    </h4>
                    <button
                      type="button"
                      onClick={() => handleCopy(row.error_message ?? "")}
                      className="rounded-md border border-tng-marine-600 px-2 py-0.5 text-[10px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-400"
                    >
                      {copied ? "Copiado!" : "Copiar"}
                    </button>
                  </div>
                  <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-200">
                    {row.error_message}
                  </pre>
                </section>
              ) : (
                <p className="text-[11px] text-tng-marine-400">Chamada sem erros.</p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function DetailGrid({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[11px]">
      {items.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-tng-marine-300">{k}</dt>
          <dd className="truncate text-tng-marine-100">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
