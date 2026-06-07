import { describe, expect, it } from "vitest";
import {
  bucketByDay,
  bucketByUser,
  microToUsd,
  monthBounds,
  summarize,
  type AiUsageRow,
} from "./aiUsage";

function row(overrides: Partial<AiUsageRow> = {}): AiUsageRow {
  // Spread + defaults — usar ?? aqui mascararia `null` (que é um valor
  // legítimo pra user_id e latency_ms nos testes de borda).
  return {
    id: "id-1",
    created_at: "2026-06-05T12:00:00.000Z",
    user_id: "u1",
    operation: "extract",
    model: "gemini-2.5-flash",
    input_tokens: 100,
    output_tokens: 50,
    cost_micro: 30,
    latency_ms: 800,
    status: "success",
    error_message: null,
    ...overrides,
  };
}

describe("monthBounds", () => {
  it("ISOs do começo do mês e do primeiro instante do próximo", () => {
    const { from, to } = monthBounds(2026, 6);
    expect(from).toBe("2026-06-01T00:00:00.000Z");
    expect(to).toBe("2026-07-01T00:00:00.000Z");
  });

  it("respeita virada de ano em dezembro", () => {
    const { to } = monthBounds(2026, 12);
    expect(to).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("summarize", () => {
  it("conta sucesso, erros e soma tokens", () => {
    const rows = [
      row({ id: "1", status: "success", input_tokens: 100, output_tokens: 50, cost_micro: 20 }),
      row({ id: "2", status: "error", input_tokens: 0, output_tokens: 0, cost_micro: 0, latency_ms: null }),
      row({ id: "3", status: "success", input_tokens: 200, output_tokens: 100, cost_micro: 40 }),
    ];
    const s = summarize(rows);
    expect(s.total).toBe(3);
    expect(s.success).toBe(2);
    expect(s.errors).toBe(1);
    expect(s.inputTokens).toBe(300);
    expect(s.outputTokens).toBe(150);
    expect(s.costMicroTotal).toBe(60);
  });

  it("avgLatencyMs ignora linhas sem latência", () => {
    const rows = [
      row({ id: "1", latency_ms: 1000 }),
      row({ id: "2", latency_ms: null }),
      row({ id: "3", latency_ms: 500 }),
    ];
    expect(summarize(rows).avgLatencyMs).toBe(750);
  });

  it("lista vazia devolve zeros", () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.avgLatencyMs).toBe(0);
  });
});

describe("microToUsd", () => {
  it("converte micro-dólares em dólares", () => {
    expect(microToUsd(1_000_000)).toBe(1);
    expect(microToUsd(2_500_000)).toBe(2.5);
    expect(microToUsd(0)).toBe(0);
  });
});

describe("bucketByDay", () => {
  it("agrupa pelo prefixo YYYY-MM-DD e ordena ascendente", () => {
    const rows = [
      row({ id: "1", created_at: "2026-06-05T09:00:00Z", cost_micro: 10 }),
      row({ id: "2", created_at: "2026-06-05T18:00:00Z", cost_micro: 20 }),
      row({ id: "3", created_at: "2026-06-03T10:00:00Z", cost_micro: 5 }),
    ];
    const buckets = bucketByDay(rows);
    expect(buckets).toEqual([
      { date: "2026-06-03", count: 1, costMicro: 5 },
      { date: "2026-06-05", count: 2, costMicro: 30 },
    ]);
  });
});

describe("bucketByUser", () => {
  it("agrupa por user_id e ordena por count desc", () => {
    const rows = [
      row({ id: "1", user_id: "a", cost_micro: 10 }),
      row({ id: "2", user_id: "b", cost_micro: 5 }),
      row({ id: "3", user_id: "a", cost_micro: 15 }),
      row({ id: "4", user_id: "a", cost_micro: 5 }),
    ];
    const out = bucketByUser(rows);
    expect(out[0]).toEqual({ userId: "a", count: 3, costMicro: 30 });
    expect(out[1]).toEqual({ userId: "b", count: 1, costMicro: 5 });
  });

  it("trata user_id null como bucket próprio", () => {
    const rows = [
      row({ id: "1", user_id: null, cost_micro: 10 }),
      row({ id: "2", user_id: null, cost_micro: 5 }),
    ];
    expect(bucketByUser(rows)).toEqual([
      { userId: null, count: 2, costMicro: 15 },
    ]);
  });
});
