import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiUsageAdmin } from "./AiUsageAdmin";
import type { AiUsageRow } from "../lib/aiUsage";
import { makeProfile } from "../test/factories";

// Mock parcial: preserva summarize/bucketByDay/microToUsd e só substitui o
// fetch — assim o componente usa aiUsage real, mas controlamos o data set.
vi.mock("../lib/aiUsage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/aiUsage")>();
  return {
    ...actual,
    listUsageBetween: vi.fn(),
  };
});

import { listUsageBetween } from "../lib/aiUsage";

function aiRow(over: Partial<AiUsageRow> = {}): AiUsageRow {
  return {
    id: "row-1",
    created_at: "2026-06-05T14:00:00Z",
    user_id: "user-1",
    operation: "extract",
    model: "gemini-2.5-flash",
    input_tokens: 100,
    output_tokens: 50,
    cost_micro: 30,
    latency_ms: 800,
    status: "success",
    error_message: null,
    ...over,
  };
}

const profiles = [makeProfile({ id: "user-1", full_name: "Cardoso" })];

describe("AiUsageAdmin", () => {
  it("não renderiza nada quando fechado", () => {
    const { container } = render(
      <AiUsageAdmin open={false} profiles={profiles} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra summary cards com os totais", async () => {
    vi.mocked(listUsageBetween).mockResolvedValueOnce({
      data: [
        aiRow({ id: "1", input_tokens: 100, output_tokens: 50, cost_micro: 30 }),
        aiRow({ id: "2", input_tokens: 200, output_tokens: 100, cost_micro: 60, status: "error" }),
      ],
      error: null,
    });

    render(<AiUsageAdmin open={true} profiles={profiles} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("300")).toBeInTheDocument(); // input tokens
      expect(screen.getByText("150")).toBeInTheDocument(); // output tokens
    });
    expect(screen.getByText(/1 ok · 1 erro/i)).toBeInTheDocument();
  });

  it("linha de erro abre drawer com mensagem completa", async () => {
    const longError = "Erro: gemini 429 — quota excedida pra projeto X. " + "x".repeat(200);
    vi.mocked(listUsageBetween).mockResolvedValueOnce({
      data: [aiRow({ id: "err-1", status: "error", error_message: longError })],
      error: null,
    });

    const user = userEvent.setup();
    render(<AiUsageAdmin open={true} profiles={profiles} onClose={() => {}} />);

    // Espera a linha aparecer
    const row = await screen.findByRole("button", { name: /error/i });
    await user.click(row);

    // Drawer aberto: mensagem completa em <pre>
    expect(screen.getByText(/Mensagem de erro/i)).toBeInTheDocument();
    const pre = screen.getByText(longError);
    expect(pre.tagName).toBe("PRE");

    // Botão de copiar visível
    expect(screen.getByRole("button", { name: /Copiar/i })).toBeInTheDocument();
  });

  it("Esc fecha o admin (chama onClose)", async () => {
    vi.mocked(listUsageBetween).mockResolvedValueOnce({ data: [], error: null });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AiUsageAdmin open={true} profiles={profiles} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/Uso da IA/i)).toBeInTheDocument());
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
