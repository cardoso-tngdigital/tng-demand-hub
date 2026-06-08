import { describe, expect, it } from "vitest";
import { findCandidateDemands } from "./demandSearch";
import { makeDemand } from "../test/factories";

describe("findCandidateDemands", () => {
  it("filtra duro por clientId quando fornecido", () => {
    const d1 = makeDemand({ id: "1", client_id: "acme", title: "X" });
    const d2 = makeDemand({ id: "2", client_id: "bruning", title: "X" });
    const out = findCandidateDemands("texto qualquer", "acme", [d1, d2]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1");
  });

  it("retorna todas do cliente mesmo sem palavra-match (score=0 vale com clientId)", () => {
    const d1 = makeDemand({
      id: "1",
      client_id: "acme",
      title: "Banner header",
      created_at: "2026-06-05T10:00:00Z",
    });
    const d2 = makeDemand({
      id: "2",
      client_id: "acme",
      title: "Footer",
      created_at: "2026-06-07T10:00:00Z",
    });
    const out = findCandidateDemands("alterar prazo urgente", "acme", [d1, d2]);
    expect(out).toHaveLength(2);
    // Mais recente primeiro quando score empata
    expect(out[0].id).toBe("2");
  });

  it("sem clientId, só retorna candidatas com match textual", () => {
    const d1 = makeDemand({ id: "1", client_id: null, title: "Banner Acme" });
    const d2 = makeDemand({ id: "2", client_id: null, title: "Footer Bruning" });
    const out = findCandidateDemands("alterar prazo do banner", null, [d1, d2]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1");
  });

  it("ignora demandas archived sempre", () => {
    const d1 = makeDemand({ id: "1", status: "archived", client_id: "acme" });
    const d2 = makeDemand({ id: "2", status: "todo", client_id: "acme" });
    const out = findCandidateDemands("qualquer", "acme", [d1, d2]);
    expect(out.map((d) => d.id)).toEqual(["2"]);
  });

  it("mantém demandas done (caso 'reabrir/comentar' é comum)", () => {
    const d1 = makeDemand({ id: "1", status: "done", client_id: "acme" });
    const out = findCandidateDemands("comentar", "acme", [d1]);
    expect(out).toHaveLength(1);
  });

  it("normaliza diacríticos na busca (descrição com 'serviço' bate 'servico')", () => {
    const d = makeDemand({
      id: "1",
      client_id: null,
      title: "Páginas de serviço",
    });
    const out = findCandidateDemands("paginas de servico", null, [d]);
    expect(out).toHaveLength(1);
  });

  it("respeita o limit", () => {
    const all = Array.from({ length: 15 }, (_, i) =>
      makeDemand({ id: String(i), client_id: "acme" }),
    );
    const out = findCandidateDemands("x", "acme", all, 5);
    expect(out).toHaveLength(5);
  });
});
