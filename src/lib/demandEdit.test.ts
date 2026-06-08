import { describe, expect, it } from "vitest";
import { diffDemand, diffsToPatch } from "./demandEdit";
import { makeDemand } from "../test/factories";
import type { ExtractedDemand } from "./ai";

function makeExtracted(over: Partial<ExtractedDemand> = {}): ExtractedDemand {
  return {
    intencao: "editar",
    titulo: "Demanda X",
    cliente: null,
    responsavel: null,
    prioridade: "media",
    prazo: null,
    descricao: "",
    tags: [],
    infraestrutura: null,
    confianca: {
      cliente: 0.5,
      responsavel: 0.5,
      prioridade: 0.5,
      prazo: 0.5,
      intencao: 0.9,
    },
    ...over,
  };
}

describe("diffDemand", () => {
  it("retorna lista vazia quando nada mudou", () => {
    const current = makeDemand({
      title: "Demanda X",
      priority: "media",
      due_date: null,
    });
    const proposed = makeExtracted({ titulo: "Demanda X" });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out).toEqual([]);
  });

  it("detecta mudança de título", () => {
    const current = makeDemand({ title: "Antigo" });
    const proposed = makeExtracted({ titulo: "Novo" });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "title",
      oldValue: "Antigo",
      newValue: "Novo",
    });
  });

  it("detecta mudança de prazo quando IA propôs explícito", () => {
    const current = makeDemand({ due_date: "2026-06-15" });
    const proposed = makeExtracted({ prazo: "2026-06-10" });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "due_date")).toMatchObject({
      oldValue: "2026-06-15",
      newValue: "2026-06-10",
    });
  });

  it("ignora prazo se IA não propôs (null)", () => {
    const current = makeDemand({ due_date: "2026-06-15" });
    const proposed = makeExtracted({ prazo: null });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "due_date")).toBeUndefined();
  });

  it("ignora prioridade quando confiança < 0.5 (provável default)", () => {
    const current = makeDemand({ priority: "alta" });
    const proposed = makeExtracted({
      prioridade: "media",
      confianca: {
        cliente: 0,
        responsavel: 0,
        prioridade: 0.3,
        prazo: 0,
        intencao: 0.9,
      },
    });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "priority")).toBeUndefined();
  });

  it("detecta mudança de prioridade quando confiança >= 0.5", () => {
    const current = makeDemand({ priority: "media" });
    const proposed = makeExtracted({
      prioridade: "urgente",
      confianca: {
        cliente: 0,
        responsavel: 0,
        prioridade: 0.9,
        prazo: 0,
        intencao: 0.9,
      },
    });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "priority")?.newValue).toBe("urgente");
  });

  it("detecta mudança de cliente quando proposedClientId difere", () => {
    const current = makeDemand({ client_id: "acme" });
    const proposed = makeExtracted();
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: "bruning",
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "client_id")?.newValue).toBe("bruning");
  });

  it("ignora cliente quando proposedClientId é null", () => {
    const current = makeDemand({ client_id: "acme" });
    const proposed = makeExtracted();
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "client_id")).toBeUndefined();
  });

  it("detecta mudança de tags quando lista difere", () => {
    const current = makeDemand({ tags: ["a", "b"] });
    const proposed = makeExtracted({ tags: ["a", "c"] });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "tags")?.newValue).toEqual(["a", "c"]);
  });
});

describe("diffsToPatch", () => {
  it("monta DemandPatch a partir só dos diffs marcados", () => {
    const diffs = [
      { field: "priority" as const, label: "P", oldValue: "media", newValue: "urgente" },
      { field: "due_date" as const, label: "D", oldValue: null, newValue: "2026-06-10" },
    ];
    expect(diffsToPatch(diffs)).toEqual({
      priority: "urgente",
      due_date: "2026-06-10",
    });
  });

  it("lista vazia gera patch vazio", () => {
    expect(diffsToPatch([])).toEqual({});
  });
});
