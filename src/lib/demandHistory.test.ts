import { describe, expect, it } from "vitest";
import { describeEvent, fieldLabel, formatFieldValue } from "./demandHistory";
import type { DemandHistoryRow } from "../types/database";

function row(over: Partial<DemandHistoryRow> = {}): DemandHistoryRow {
  return {
    id: "h1",
    demand_id: "d1",
    event_type: "field_changed",
    field: "status",
    old_value: "todo",
    new_value: "doing",
    actor_id: "u1",
    created_at: "2026-06-07T10:00:00Z",
    ...over,
  };
}

describe("fieldLabel", () => {
  it("traduz campos conhecidos", () => {
    expect(fieldLabel("status")).toBe("Status");
    expect(fieldLabel("priority")).toBe("Prioridade");
    expect(fieldLabel("due_date")).toBe("Prazo");
    expect(fieldLabel("infrastructure")).toBe("Infraestrutura");
  });

  it("devolve o próprio campo quando não há tradução", () => {
    expect(fieldLabel("custom_field")).toBe("custom_field");
  });

  it("null/undefined vira 'Campo'", () => {
    expect(fieldLabel(null)).toBe("Campo");
    expect(fieldLabel(undefined)).toBe("Campo");
  });
});

describe("formatFieldValue", () => {
  it("status: id vira label", () => {
    expect(formatFieldValue("status", "todo")).toBe("A fazer");
    expect(formatFieldValue("status", "done")).toBe("Concluída");
  });

  it("priority: id vira label", () => {
    expect(formatFieldValue("priority", "urgente")).toBe("Urgente");
  });

  it("infrastructure: id vira label", () => {
    expect(formatFieldValue("infrastructure", "site_ia")).toBe("Site com IA");
  });

  it("client_id usa o nome quando vem no ctx", () => {
    expect(
      formatFieldValue("client_id", "abc-123", { clientName: "Acme" }),
    ).toBe("Acme");
  });

  it("client_id sem ctx mostra o id cru (fallback)", () => {
    expect(formatFieldValue("client_id", "abc-123")).toBe("abc-123");
  });

  it("description: strip de tags + truncamento", () => {
    expect(
      formatFieldValue("description", "<p>oi <strong>tudo bem</strong></p>"),
    ).toBe('"oi tudo bem"');

    const longo = formatFieldValue("description", "<p>" + "a".repeat(100) + "</p>");
    expect(longo).toMatch(/^".{40}…"$/);
  });

  it("due_date formata em pt-BR", () => {
    expect(formatFieldValue("due_date", "2026-06-15")).toMatch(/15\/06\/2026/);
  });

  it("null vira em traço", () => {
    expect(formatFieldValue("status", null)).toBe("—");
  });
});

describe("describeEvent", () => {
  it("created", () => {
    expect(describeEvent(row({ event_type: "created", field: null }))).toBe(
      "criou a demanda",
    );
  });

  it("comment_added", () => {
    expect(describeEvent(row({ event_type: "comment_added", field: null }))).toBe(
      "comentou",
    );
  });

  it("attachment_added inclui nome do arquivo", () => {
    expect(
      describeEvent(
        row({ event_type: "attachment_added", field: null, new_value: "foto.png" }),
      ),
    ).toBe("anexou foto.png");
  });

  it("attachment_added sem nome cai pra fallback", () => {
    expect(
      describeEvent(
        row({ event_type: "attachment_added", field: null, new_value: null }),
      ),
    ).toBe("anexou arquivo");
  });

  it("field_changed em status descreve transição com labels", () => {
    const r = row({
      event_type: "field_changed",
      field: "status",
      old_value: "todo",
      new_value: "doing",
    });
    expect(describeEvent(r)).toBe("mudou Status de A fazer para Em andamento");
  });

  it("field_changed em assignee resolve via ctx", () => {
    const r = row({
      event_type: "field_changed",
      field: "assignee_id",
      old_value: "u1",
      new_value: "u2",
    });
    expect(
      describeEvent(r, { oldProfileName: "Ana", newProfileName: "Bia" }),
    ).toBe("mudou Responsável de Ana para Bia");
  });
});
