/**
 * routes/notificacoes.ts — CRUD de notificações do Blog (2026-07-04).
 *
 * Persiste eventos do Blog (agendamento concluído, falha na publicação, etc.)
 * na tabela `blog.notificacoes`. RLS garante que cada usuário só vê as
 * próprias. Endpoints:
 *   - GET  /api/notificacoes                 → lista (com ?nao_lidas=1)
 *   - POST /api/notificacoes/:id/lida        → marca como lida
 *   - POST /api/notificacoes/lidas           → marca todas como lidas
 *   - DELETE /api/notificacoes/:id           → apaga uma
 *   - DELETE /api/notificacoes/lidas         → apaga todas as lidas
 */

import { Hono, type Context } from "hono";
import { requireAuth, type AuthEnv } from "../middleware/auth";

export const notificacoesRouter = new Hono<AuthEnv>();

/** Lista notificações do usuário. `?nao_lidas=1` filtra só as pendentes. */
notificacoesRouter.get("/", requireAuth, async (c: Context<AuthEnv>) => {
  const supabase = c.get("supabase");
  const somenteNaoLidas = c.req.query("nao_lidas") === "1";
  const limite = Number.parseInt(c.req.query("limite") ?? "100", 10);

  let query = supabase
    .from("notificacoes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limite, 1), 500));

  if (somenteNaoLidas) query = query.eq("lida", false);

  const { data, error } = await query;
  if (error !== null) {
    return c.json(
      { error: "Não foi possível listar notificações.", details: error.message },
      500,
    );
  }
  return c.json({ notificacoes: data ?? [] });
});

/** GET /api/notificacoes/nao-lidas/count — só o número (leve, pra badge). */
notificacoesRouter.get(
  "/nao-lidas/count",
  requireAuth,
  async (c: Context<AuthEnv>) => {
    const supabase = c.get("supabase");
    const { count, error } = await supabase
      .from("notificacoes")
      .select("id", { head: true, count: "exact" })
      .eq("lida", false);
    if (error !== null) {
      return c.json(
        { error: "Falha na contagem.", details: error.message },
        500,
      );
    }
    return c.json({ nao_lidas: count ?? 0 });
  },
);

/** Marca uma notificação como lida. */
notificacoesRouter.post(
  "/:id/lida",
  requireAuth,
  async (c: Context<AuthEnv>) => {
    const id = c.req.param("id");
    const supabase = c.get("supabase");
    const { error } = await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("id", id);
    if (error !== null) {
      return c.json({ error: "Falha ao marcar como lida." }, 500);
    }
    return c.json({ ok: true });
  },
);

/** Marca todas as notificações do usuário como lidas. */
notificacoesRouter.post("/lidas", requireAuth, async (c: Context<AuthEnv>) => {
  const supabase = c.get("supabase");
  const { error } = await supabase
    .from("notificacoes")
    .update({ lida: true })
    .eq("lida", false);
  if (error !== null) {
    return c.json({ error: "Falha ao marcar todas como lidas." }, 500);
  }
  return c.json({ ok: true });
});

/** Apaga uma notificação. */
notificacoesRouter.delete("/:id", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const supabase = c.get("supabase");
  const { error } = await supabase.from("notificacoes").delete().eq("id", id);
  if (error !== null) {
    return c.json({ error: "Falha ao apagar." }, 500);
  }
  return c.json({ ok: true });
});

/** Apaga todas as lidas do usuário. */
notificacoesRouter.delete(
  "/lidas",
  requireAuth,
  async (c: Context<AuthEnv>) => {
    const supabase = c.get("supabase");
    const { error } = await supabase
      .from("notificacoes")
      .delete()
      .eq("lida", true);
    if (error !== null) {
      return c.json({ error: "Falha ao limpar lidas." }, 500);
    }
    return c.json({ ok: true });
  },
);
