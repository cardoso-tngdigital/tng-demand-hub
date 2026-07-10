/**
 * routes/config.ts — prompt geral, config Gemini, config Magnific.
 *
 * NUNCA devolve segredos (gemini_api_key, tokens) pro cliente — só flags e
 * modelos. Chaves só entram via PUT e ficam no `settings.json`.
 */

import { Hono, type Context } from "hono";
import { join, resolve } from "node:path";
import { env } from "../env";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { getMagnific } from "../magnific/singleton";
import { FileTokenStorage } from "../magnific/tokenStorage";
import { getPrompt, savePrompt } from "../prompt";
import {
  loadSettings,
  updateSettings,
  MODELOS_GEMINI,
  MODELO_IA_MAGNIFIC_PADRAO,
} from "../settings";

export const configRouter = new Hono<AuthEnv>();

// -------- /api/prompt ------------------------------------------------------

configRouter.get("/prompt", requireAuth, async (c: Context<AuthEnv>) => {
  const prompt = await getPrompt();
  return c.json({ prompt });
});

configRouter.put("/prompt", requireAuth, async (c: Context<AuthEnv>) => {
  const body = await c.req.json().catch(() => null) as { prompt?: string } | null;
  if (body === null || typeof body.prompt !== "string") {
    return c.json({ error: "Corpo JSON inválido — envie {prompt: string}." }, 400);
  }
  await savePrompt(body.prompt);
  return c.json({ ok: true });
});

// -------- /api/config/gemini ----------------------------------------------

configRouter.get("/config/gemini", requireAuth, async (c: Context<AuthEnv>) => {
  const s = await loadSettings();
  return c.json({
    modelo: s.gemini_model ?? env.GEMINI_MODEL,
    modelos_disponiveis: MODELOS_GEMINI,
    api_key_configurada: (s.gemini_api_key ?? "").length > 0 || env.GEMINI_API_KEY.length > 0,
  });
});

configRouter.put("/config/gemini", requireAuth, async (c: Context<AuthEnv>) => {
  const body = await c.req.json().catch(() => null) as
    | { api_key?: string; modelo?: string }
    | null;
  if (body === null) return c.json({ error: "Corpo JSON inválido." }, 400);
  const patch: { gemini_api_key?: string; gemini_model?: string } = {};
  if (typeof body.api_key === "string" && body.api_key.trim().length > 0) {
    patch.gemini_api_key = body.api_key.trim();
  }
  if (typeof body.modelo === "string" && body.modelo.trim().length > 0) {
    patch.gemini_model = body.modelo.trim();
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: "Nada pra atualizar." }, 400);
  }
  await updateSettings(patch);
  return c.json({ ok: true });
});

configRouter.put("/config/gemini/modelo", requireAuth, async (c: Context<AuthEnv>) => {
  const body = await c.req.json().catch(() => null) as { modelo?: string } | null;
  if (body === null || typeof body.modelo !== "string") {
    return c.json({ error: "Envie {modelo: string}." }, 400);
  }
  await updateSettings({ gemini_model: body.modelo.trim() });
  return c.json({ ok: true });
});

// -------- /api/config/magnific --------------------------------------------

configRouter.get("/config/magnific", requireAuth, async (c: Context<AuthEnv>) => {
  // Verificar existência do arquivo NÃO é suficiente — o SDK MCP cria o
  // arquivo durante o DCR (client_info) e o PKCE (code_verifier) mesmo sem
  // ter recebido tokens ainda. Precisamos checar se o payload tem `tokens`
  // com `access_token` presente.
  const tokenPath = join(resolve(env.DATA_DIR), "magnific_token.json");
  const storage = new FileTokenStorage(tokenPath);
  const tokens = await storage.getTokens();
  const conectado = tokens?.access_token != null && tokens.access_token.length > 0;
  const s = await loadSettings();
  return c.json({
    conectado,
    modelo_ia: s.magnific_modelo_ia ?? MODELO_IA_MAGNIFIC_PADRAO,
  });
});

configRouter.post("/config/magnific/conectar", requireAuth, async (c: Context<AuthEnv>) => {
  try {
    const magnific = getMagnific();
    await magnific.ensureAuth();
    return c.json({ status: "conectado" });
  } catch (err) {
    return c.json({ error: "Falha ao conectar no Magnific.", details: (err as Error).message }, 500);
  }
});

configRouter.put("/config/magnific/modelo", requireAuth, async (c: Context<AuthEnv>) => {
  const body = await c.req.json().catch(() => null) as { modelo?: string } | null;
  if (body === null || typeof body.modelo !== "string") {
    return c.json({ error: "Envie {modelo: string}." }, 400);
  }
  await updateSettings({ magnific_modelo_ia: body.modelo.trim() });
  return c.json({ ok: true });
});

// -------- /api/config/ai-usage --------------------------------------------

/**
 * Dashboard de consumo do Gemini pelo Blog (`blog.ai_usage`). Separado do
 * painel "Uso da IA" do app principal (que rastreia demandas).
 *
 * `?periodo=hoje|7d|30d|mes|tudo` (default `mes` = mês corrente).
 * Devolve totais agregados, quebra por modelo (input/output separados) e a
 * lista das execuções individuais (até 200, mais recentes primeiro) pra
 * tabela do painel. Reformulado em 2026-07-09 — antes só somava o mês.
 */
configRouter.get("/config/ai-usage", requireAuth, async (c: Context<AuthEnv>) => {
  const supabase = c.get("supabase");

  const periodo = c.req.query("periodo") ?? "mes";
  const agora = new Date();
  let inicio: Date | null = new Date(agora);
  switch (periodo) {
    case "hoje":
      inicio.setUTCHours(0, 0, 0, 0);
      break;
    case "7d":
      inicio.setUTCDate(inicio.getUTCDate() - 7);
      break;
    case "30d":
      inicio.setUTCDate(inicio.getUTCDate() - 30);
      break;
    case "tudo":
      inicio = null;
      break;
    case "mes":
    default:
      inicio.setUTCDate(1);
      inicio.setUTCHours(0, 0, 0, 0);
      break;
  }

  let q = supabase
    .from("ai_usage")
    .select(
      "id, modelo, input_tokens, output_tokens, total_tokens, custo_estimado, site_id, job_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (inicio !== null) q = q.gte("created_at", inicio.toISOString());

  const { data, error } = await q;
  if (error !== null) {
    return c.json({ error: "Erro consultando uso da IA.", details: error.message }, 500);
  }

  type Linha = {
    id: string;
    modelo: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    custo_estimado: number | null;
    site_id: string | null;
    job_id: string | null;
    created_at: string;
  };
  const linhas = (data ?? []) as Linha[];

  let input = 0;
  let output = 0;
  let custo = 0;
  const porModelo: Record<
    string,
    { input: number; output: number; total: number; execucoes: number }
  > = {};
  for (const r of linhas) {
    input += r.input_tokens ?? 0;
    output += r.output_tokens ?? 0;
    custo += Number(r.custo_estimado ?? 0);
    const m = (porModelo[r.modelo] ??= {
      input: 0,
      output: 0,
      total: 0,
      execucoes: 0,
    });
    m.input += r.input_tokens ?? 0;
    m.output += r.output_tokens ?? 0;
    m.total += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
    m.execucoes += 1;
  }

  return c.json({
    periodo,
    inicio: inicio?.toISOString() ?? null,
    totais: {
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
      execucoes: linhas.length,
      custo_estimado: custo,
    },
    por_modelo: Object.entries(porModelo)
      .map(([modelo, v]) => ({ modelo, ...v }))
      .sort((a, b) => b.total - a.total),
    execucoes: linhas,
  });
});
