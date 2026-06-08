import { describe, expect, it } from "vitest";
import {
  decideCommentNotification,
  decideDemandNotification,
  summarizeDemandChanges,
} from "./notificationDecider";
import { makeComment, makeDemand } from "../test/factories";

const ME = "me";
const OTHER = "other";

const neverLocal = () => false;
const alwaysLocal = () => true;

describe("decideDemandNotification — INSERT", () => {
  it("admin: notifica nova demanda criada por outro", () => {
    const out = decideDemandNotification({
      event: "INSERT",
      change: { new: makeDemand({ created_by: OTHER, title: "Landing" }), old: null },
      me: ME,
      role: "admin",
      wasLocalChange: neverLocal,
    });
    expect(out?.title).toBe("Nova demanda criada");
    expect(out?.body).toBe("Landing");
  });

  it("admin: NÃO notifica nova demanda criada por mim mesmo", () => {
    const out = decideDemandNotification({
      event: "INSERT",
      change: { new: makeDemand({ created_by: ME }), old: null },
      me: ME,
      role: "admin",
      wasLocalChange: neverLocal,
    });
    expect(out).toBeNull();
  });

  it("membro: NÃO notifica nova demanda atribuída a outro", () => {
    const out = decideDemandNotification({
      event: "INSERT",
      change: {
        new: makeDemand({ created_by: OTHER, assignee_id: OTHER }),
        old: null,
      },
      me: ME,
      role: "member",
      wasLocalChange: neverLocal,
    });
    expect(out).toBeNull();
  });

  it("membro: notifica nova demanda atribuída a mim", () => {
    const out = decideDemandNotification({
      event: "INSERT",
      change: {
        new: makeDemand({ created_by: OTHER, assignee_id: ME, title: "X" }),
        old: null,
      },
      me: ME,
      role: "member",
      wasLocalChange: neverLocal,
    });
    expect(out?.title).toBe("Demanda atribuída a você");
  });
});

describe("decideDemandNotification — UPDATE", () => {
  it("admin: notifica qualquer update (diff genérico)", () => {
    const old = makeDemand({ priority: "media" });
    const next = makeDemand({ priority: "urgente" });
    const out = decideDemandNotification({
      event: "UPDATE",
      change: { new: next, old },
      me: ME,
      role: "admin",
      wasLocalChange: neverLocal,
    });
    expect(out?.title).toContain("Atualizada");
    expect(out?.body).toContain("Prioridade");
    expect(out?.body).toContain("Urgente");
  });

  it("admin: suprime quando wasLocalChange retorna true", () => {
    const out = decideDemandNotification({
      event: "UPDATE",
      change: {
        new: makeDemand({ priority: "urgente" }),
        old: makeDemand({ priority: "media" }),
      },
      me: ME,
      role: "admin",
      wasLocalChange: alwaysLocal,
    });
    expect(out).toBeNull();
  });

  it("membro: ignora update em demanda alheia", () => {
    const old = makeDemand({ assignee_id: OTHER, created_by: OTHER });
    const next = makeDemand({
      assignee_id: OTHER,
      created_by: OTHER,
      priority: "urgente",
    });
    const out = decideDemandNotification({
      event: "UPDATE",
      change: { new: next, old },
      me: ME,
      role: "member",
      wasLocalChange: neverLocal,
    });
    expect(out).toBeNull();
  });

  it("membro: notifica reatribuição com mensagem dedicada", () => {
    const old = makeDemand({ assignee_id: OTHER });
    const next = makeDemand({ assignee_id: ME });
    const out = decideDemandNotification({
      event: "UPDATE",
      change: { new: next, old },
      me: ME,
      role: "member",
      wasLocalChange: neverLocal,
    });
    expect(out?.title).toBe("Demanda atribuída a você");
  });

  it("membro: notifica quando uma demanda que era minha some da minha atribuição", () => {
    const old = makeDemand({ assignee_id: ME });
    const next = makeDemand({ assignee_id: OTHER });
    const out = decideDemandNotification({
      event: "UPDATE",
      change: { new: next, old },
      me: ME,
      role: "member",
      wasLocalChange: neverLocal,
    });
    expect(out).not.toBeNull();
  });

  it("conclusão: ambos os roles recebem 'Demanda concluída'", () => {
    const old = makeDemand({ status: "doing", assignee_id: ME });
    const next = makeDemand({ status: "done", assignee_id: ME });

    expect(
      decideDemandNotification({
        event: "UPDATE",
        change: { new: next, old },
        me: ME,
        role: "admin",
        wasLocalChange: neverLocal,
      })?.title,
    ).toBe("Demanda concluída");

    expect(
      decideDemandNotification({
        event: "UPDATE",
        change: { new: next, old },
        me: ME,
        role: "member",
        wasLocalChange: neverLocal,
      })?.title,
    ).toBe("Demanda concluída");
  });

  it("retorna null se nenhum campo notificável mudou (ex.: só updated_at)", () => {
    const old = makeDemand({ comments_count: 5 });
    const next = makeDemand({ comments_count: 6 });
    const out = decideDemandNotification({
      event: "UPDATE",
      change: { new: next, old },
      me: ME,
      role: "admin",
      wasLocalChange: neverLocal,
    });
    expect(out).toBeNull();
  });
});

describe("decideDemandNotification — DELETE", () => {
  it("admin: notifica exclusão por outro", () => {
    const out = decideDemandNotification({
      event: "DELETE",
      change: { new: null, old: makeDemand({ created_by: OTHER }) },
      me: ME,
      role: "admin",
      wasLocalChange: neverLocal,
    });
    expect(out?.title).toBe("Demanda excluída");
  });

  it("admin: NÃO notifica exclusão de uma das minhas (eu cliquei excluir)", () => {
    const out = decideDemandNotification({
      event: "DELETE",
      change: { new: null, old: makeDemand({ created_by: ME }) },
      me: ME,
      role: "admin",
      wasLocalChange: neverLocal,
    });
    expect(out).toBeNull();
  });

  it("membro: notifica exclusão de demanda que era minha", () => {
    const out = decideDemandNotification({
      event: "DELETE",
      change: {
        new: null,
        old: makeDemand({ assignee_id: ME, created_by: OTHER }),
      },
      me: ME,
      role: "member",
      wasLocalChange: neverLocal,
    });
    expect(out?.title).toBe("Demanda excluída");
  });
});

describe("decideCommentNotification", () => {
  it("admin: notifica qualquer comentário (exceto próprio)", () => {
    const demand = makeDemand({
      assignee_id: OTHER,
      created_by: OTHER,
      title: "X",
    });
    const out = decideCommentNotification({
      comment: makeComment({ author_id: OTHER, content: "<p>oi</p>" }),
      demand,
      me: ME,
      role: "admin",
    });
    expect(out?.title).toBe('Comentário em "X"');
    expect(out?.body).toContain("oi");
  });

  it("admin: NÃO notifica meus próprios comentários", () => {
    const out = decideCommentNotification({
      comment: makeComment({ author_id: ME }),
      demand: makeDemand(),
      me: ME,
      role: "admin",
    });
    expect(out).toBeNull();
  });

  it("membro: ignora comentário em demanda alheia", () => {
    const out = decideCommentNotification({
      comment: makeComment({ author_id: OTHER }),
      demand: makeDemand({ assignee_id: OTHER, created_by: OTHER }),
      me: ME,
      role: "member",
    });
    expect(out).toBeNull();
  });

  it("membro: notifica comentário em demanda que sou assignee", () => {
    const out = decideCommentNotification({
      comment: makeComment({ author_id: OTHER }),
      demand: makeDemand({ assignee_id: ME }),
      me: ME,
      role: "member",
    });
    expect(out).not.toBeNull();
  });
});

describe("summarizeDemandChanges", () => {
  it("descreve mudança de status com label humano", () => {
    const out = summarizeDemandChanges(
      makeDemand({ status: "todo" }),
      makeDemand({ status: "doing" }),
    );
    expect(out).toEqual(["Status: A fazer → Em andamento"]);
  });

  it("usa lookup ctx pra nome de cliente quando disponível", () => {
    const out = summarizeDemandChanges(
      makeDemand({ client_id: null }),
      makeDemand({ client_id: "client-1" }),
      { clientName: (id) => (id === "client-1" ? "Acme" : undefined) },
    );
    expect(out[0]).toContain("Acme");
  });

  it("retorna lista vazia quando não há mudança notificável", () => {
    const out = summarizeDemandChanges(
      makeDemand({ comments_count: 1 }),
      makeDemand({ comments_count: 2 }),
    );
    expect(out).toEqual([]);
  });
});
