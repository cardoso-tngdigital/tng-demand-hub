import { describe, expect, it } from "vitest";
import { applyRules, type AppliedDemand } from "./classificationRules";
import type { ClassificationRule } from "../types/database";

function rule(over: Partial<ClassificationRule> = {}): ClassificationRule {
  return {
    id: over.id ?? "r1",
    name: over.name ?? "regra-teste",
    match_field: over.match_field ?? "description",
    match_operator: over.match_operator ?? "contains",
    match_value: over.match_value ?? "bug",
    set_field: over.set_field ?? "priority",
    set_value: over.set_value ?? "urgente",
    active: over.active ?? true,
    created_by: over.created_by ?? null,
    created_at: over.created_at ?? "2026-06-01T00:00:00Z",
    updated_at: over.updated_at ?? "2026-06-01T00:00:00Z",
  };
}

function base(over: Partial<AppliedDemand> = {}): AppliedDemand {
  return {
    descricao: over.descricao ?? "Tarefa qualquer",
    cliente: over.cliente ?? null,
    clientId: over.clientId ?? null,
    responsavel: over.responsavel ?? null,
    assigneeId: over.assigneeId ?? null,
    prioridade: over.prioridade ?? "media",
    tags: over.tags ?? [],
  };
}

describe("applyRules", () => {
  it("não muda nada quando não há regras", () => {
    const b = base();
    const { result, applied } = applyRules(b, [], []);
    expect(result).toEqual(b);
    expect(applied).toEqual([]);
  });

  it("ignora regras inativas", () => {
    const r = rule({ active: false });
    const { result, applied } = applyRules(base(), [r], []);
    expect(result.prioridade).toBe("media");
    expect(applied).toEqual([]);
  });

  it("match em description seta prioridade", () => {
    const r = rule({
      match_field: "description",
      match_operator: "contains",
      match_value: "urgente",
      set_field: "priority",
      set_value: "urgente",
    });
    const { result, applied } = applyRules(
      base({ descricao: "Cliente disse que é urgente" }),
      [r],
      [],
    );
    expect(result.prioridade).toBe("urgente");
    expect(applied).toHaveLength(1);
    expect(applied[0].ruleName).toBe("regra-teste");
  });

  it("ignora prioridade inválida", () => {
    const r = rule({ set_field: "priority", set_value: "explosiva" });
    const { result } = applyRules(base({ descricao: "bug crítico" }), [r], []);
    expect(result.prioridade).toBe("media");
  });

  it("match em client usa alias quando existe", () => {
    const clients = [{ id: "c1", name: "Acme Inc", alias: "ACME" }];
    const r = rule({
      match_field: "client",
      match_operator: "equals",
      match_value: "acme",
      set_field: "assignee_id",
      set_value: "user-1",
    });
    const { result } = applyRules(base({ clientId: "c1" }), [r], clients);
    expect(result.assigneeId).toBe("user-1");
  });

  it("set_field tag adiciona tag sem duplicar", () => {
    const r = rule({
      match_field: "description",
      match_value: "design",
      set_field: "tag",
      set_value: "design-system",
    });
    const out1 = applyRules(base({ descricao: "ajuste de design no header", tags: [] }), [r], []);
    expect(out1.result.tags).toEqual(["design-system"]);

    const out2 = applyRules(
      base({ descricao: "ajuste de design no header", tags: ["design-system"] }),
      [r],
      [],
    );
    expect(out2.result.tags).toEqual(["design-system"]);
  });

  it("base imutável: regra altera cópia, não objeto recebido", () => {
    const original = base({ descricao: "bug crítico" });
    applyRules(original, [rule()], []);
    expect(original.prioridade).toBe("media");
    expect(original.tags).toEqual([]);
  });

  it("match em tag funciona", () => {
    const r = rule({
      match_field: "tag",
      match_operator: "equals",
      match_value: "backend",
      set_field: "priority",
      set_value: "alta",
    });
    const { result } = applyRules(base({ tags: ["frontend", "backend"] }), [r], []);
    expect(result.prioridade).toBe("alta");
  });

  it("operator equals exige match exato", () => {
    const r = rule({
      match_field: "description",
      match_operator: "equals",
      match_value: "bug",
    });
    const partial = applyRules(base({ descricao: "tem um bug aqui" }), [r], []);
    expect(partial.applied).toEqual([]);

    const exact = applyRules(base({ descricao: "BUG" }), [r], []);
    expect(exact.applied).toHaveLength(1);
  });
});
