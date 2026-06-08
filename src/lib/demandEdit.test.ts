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

  it("NUNCA propõe mudança de título em edição (preserva o original)", () => {
    // A IA gera novo título descrevendo o pedido do user ("Atualizar prazo
    // da demanda X"), mas em edição o título da demanda deve permanecer.
    const current = makeDemand({ title: "Páginas de serviço da Acme" });
    const proposed = makeExtracted({
      titulo: "Atualizar prazo das páginas da Acme",
    });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "title")).toBeUndefined();
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

  it("NUNCA propõe mudança de tags em edição", () => {
    // Tags da IA refletem o verbo do pedido ("atualizacao", "prazo"), não
    // as tags semânticas da demanda original.
    const current = makeDemand({ tags: ["wordpress", "design"] });
    const proposed = makeExtracted({ tags: ["prazo", "atualizacao"] });
    const out = diffDemand({
      current,
      proposed,
      proposedClientId: null,
      proposedAssigneeId: null,
    });
    expect(out.find((d) => d.field === "tags")).toBeUndefined();
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
