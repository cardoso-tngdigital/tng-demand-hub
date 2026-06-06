import { supabase } from "./supabase/client";

export type AiUsageRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  operation: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_micro: number;
  latency_ms: number | null;
  status: "success" | "error" | "timeout" | "invalid_response";
  error_message: string | null;
};

export async function listUsageBetween(
  fromIso: string,
  toIso: string,
): Promise<{ data: AiUsageRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("ai_usage_log")
    .select(
      "id, created_at, user_id, operation, model, input_tokens, output_tokens, cost_micro, latency_ms, status, error_message",
    )
    .gte("created_at", fromIso)
    .lt("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("[ai_usage] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as AiUsageRow[]) ?? [], error: null };
}

export function monthBounds(year: number, month1to12: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month1to12 - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, month1to12, 1)).toISOString();
  return { from, to };
}

export type UsageSummary = {
  total: number;
  success: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  costMicroTotal: number;
  avgLatencyMs: number;
};

export function summarize(rows: AiUsageRow[]): UsageSummary {
  let success = 0;
  let errors = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costMicroTotal = 0;
  let latencySum = 0;
  let latencyCount = 0;
  for (const r of rows) {
    if (r.status === "success") success++;
    else errors++;
    inputTokens += r.input_tokens;
    outputTokens += r.output_tokens;
    costMicroTotal += r.cost_micro;
    if (typeof r.latency_ms === "number") {
      latencySum += r.latency_ms;
      latencyCount++;
    }
  }
  return {
    total: rows.length,
    success,
    errors,
    inputTokens,
    outputTokens,
    costMicroTotal,
    avgLatencyMs: latencyCount === 0 ? 0 : Math.round(latencySum / latencyCount),
  };
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}

export type DailyBucket = { date: string; count: number; costMicro: number };

export function bucketByDay(rows: AiUsageRow[]): DailyBucket[] {
  const map = new Map<string, DailyBucket>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    const existing = map.get(day) ?? { date: day, count: 0, costMicro: 0 };
    existing.count++;
    existing.costMicro += r.cost_micro;
    map.set(day, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export type UserUsage = { userId: string | null; count: number; costMicro: number };

export function bucketByUser(rows: AiUsageRow[]): UserUsage[] {
  const map = new Map<string, UserUsage>();
  for (const r of rows) {
    const key = r.user_id ?? "(desconhecido)";
    const existing = map.get(key) ?? { userId: r.user_id, count: 0, costMicro: 0 };
    existing.count++;
    existing.costMicro += r.cost_micro;
    map.set(key, existing);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
