/**
 * main.ts — entry point do sidecar HTTP local do TNG Blog Backend.
 *
 * Servidor Hono rodando em 127.0.0.1 (nunca 0.0.0.0 — sidecar local, sem rede).
 * Fallback automático de porta (8000 → 8010), CORS restrito às origens do Tauri,
 * log de requests, health público e `/api/me` autenticado. Fase 1 do Sprint 21.
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { env } from "./env";
import { requireAuth, type AuthEnv } from "./middleware/auth";
import { sondarSchema } from "./supabase";
import { sitesRouter, conectarPublicRouter } from "./routes/sites";
import { historicoRouter } from "./routes/historico";
import { configRouter } from "./routes/config";
import { artigosRouter, agendamentosRouter } from "./routes/artigos";
import { notificacoesRouter } from "./routes/notificacoes";
import { pluginRouter } from "./routes/plugin";
import { iniciarAgendador } from "./scheduler";
import { closeMagnific } from "./magnific/singleton";

/** Versão do backend — mantida em sincronia com package.json. */
const VERSION = "0.2.0";

/** Momento em que o processo subiu — usado no health check. */
const STARTED_AT = Date.now();

/** Faixa de portas onde o sidecar procura um slot livre (inclusive). */
const PORT_FALLBACK_LIMIT = env.PORT + 10;

/** Origens que podem falar com o sidecar. Nunca abrir pra `*`. */
const CORS_ORIGINS: readonly string[] = [
  "tauri://localhost",
  // Dev do Tauri v2: Vite deste projeto roda em 5173 (ver `vite.config.ts`
  // e `tauri.conf.json.build.devUrl`). 1420 é o default do template Tauri —
  // mantemos por compat caso alguém rode o template puro.
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const app = new Hono<AuthEnv>();

// ------------------------------- Middlewares --------------------------------

/** Log simples: método, path, status, duração. Sem PII (não loga headers). */
app.use("*", async (c, next) => {
  const inicio = performance.now();
  await next();
  const dur = Math.round(performance.now() - inicio);
  // eslint-disable-next-line no-console
  console.log(`[${c.req.method}] ${c.req.path} ${c.res.status} ${dur}ms`);
});

/** CORS restrito às origens do Tauri (produção e dev). */
app.use(
  "*",
  cors({
    origin: CORS_ORIGINS as string[],
    allowHeaders: ["Content-Type", "Authorization", "X-Supabase-Token"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  }),
);

// --------------------------------- Rotas ------------------------------------

/** Health check público — usado pelo Tauri pra detectar quando o sidecar subiu.
 *  `scheduler` avisa o painel se agendamentos vão rodar neste sidecar (2026-07-09).
 *  Referencia a const `scheduler` declarada no bootstrap — seguro porque o
 *  handler só executa depois que o script terminou de rodar. */
app.get("/api/health", (c) => {
  const uptime_sec = Math.floor((Date.now() - STARTED_AT) / 1000);
  return c.json({
    status: "ok",
    version: VERSION,
    uptime_sec,
    scheduler: scheduler.ativo,
  });
});

/** Retorna dados do usuário autenticado + status do schema `blog`. */
app.get("/api/me", requireAuth, async (c: Context<AuthEnv>) => {
  const user = c.get("user");
  const token = c.req.header("X-Supabase-Token")?.trim()
    ?? (c.req.header("Authorization")?.trim() ?? "").replace(/^Bearer\s+/i, "");
  const sonda = await sondarSchema(token);
  return c.json({
    user_id: user.id,
    email: user.email ?? null,
    schema_ok: sonda.ok,
  });
});

// ---------------------------- Rotas públicas --------------------------------
// Ficam ANTES das autenticadas — não passam por requireAuth.

/** POST /api/conectar — callback do plugin WP v2 (form auto-submit). */
app.route("/api", conectarPublicRouter);

/** GET /api/plugin/download — link do painel pro .zip. */
app.route("/api/plugin", pluginRouter);

// --------------------------- Rotas autenticadas -----------------------------
// Cada router usa `requireAuth` internamente em cada handler.

app.route("/api/sites", sitesRouter);
app.route("/api/historico", historicoRouter);
app.route("/api", configRouter);           // /api/prompt, /api/config/*
app.route("/api/artigos", artigosRouter);
app.route("/api/agendamentos", agendamentosRouter);
app.route("/api/notificacoes", notificacoesRouter);

// -------------------------- Tratamento de erros -----------------------------

/** Handler global — qualquer exception vira 500 com mensagem em pt-BR. */
app.onError((err, c) => {
  const detalhe = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[erro] ${c.req.method} ${c.req.path}:`, detalhe);
  return c.json(
    { error: "Erro interno no sidecar do blog.", details: detalhe },
    500,
  );
});

/** 404 padronizado (para não vazar HTML default do Hono). */
app.notFound((c) => c.json({ error: "Rota não encontrada." }, 404));

// -------------------------- Bootstrap do servidor ---------------------------

/**
 * Tenta subir o servidor em `porta`; se `EADDRINUSE`, sobe uma. Fora dessas
 * duas condições, propaga o erro pra cima (que aborta com log).
 */
function tentarSubir(porta: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1", // Nunca 0.0.0.0 — sidecar local, sem exposição de rede.
    port: porta,
    fetch: app.fetch,
    error(err) {
      // eslint-disable-next-line no-console
      console.error("[bun.serve] erro:", err);
      return new Response(
        JSON.stringify({ error: "Erro interno no servidor.", details: err.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    },
  });
}

/** Testa portas em sequência até achar uma livre ou estourar o limite. */
function iniciarComFallback(): ReturnType<typeof Bun.serve> {
  let ultimoErro: unknown = null;
  for (let porta = env.PORT; porta <= PORT_FALLBACK_LIMIT; porta++) {
    try {
      return tentarSubir(porta);
    } catch (err) {
      ultimoErro = err;
      // `Bun.serve` lança sincronamente com code "EADDRINUSE" quando ocupada.
      const codigo = (err as { code?: string })?.code;
      if (codigo !== "EADDRINUSE") {
        throw err;
      }
      // eslint-disable-next-line no-console
      console.warn(`[porta] ${porta} ocupada, tentando próxima...`);
    }
  }
  // eslint-disable-next-line no-console
  console.error(
    `[fatal] Nenhuma porta livre entre ${env.PORT} e ${PORT_FALLBACK_LIMIT}. ` +
      `Feche outro processo ou defina PORT no .env.local.`,
    ultimoErro,
  );
  process.exit(1);
}

const server = iniciarComFallback();

// eslint-disable-next-line no-console
console.log(`TNG Blog Backend rodando em http://127.0.0.1:${server.port}`);

// --------------------------- Boot do scheduler ------------------------------
// Só sobe se SUPABASE_SERVICE_ROLE_KEY existir — senão fica silencioso (com
// log de warning) e agendamentos programados não rodam neste sidecar.

const scheduler = iniciarAgendador({});

// ---------------------------- Graceful shutdown -----------------------------

/** Fecha o servidor, o scheduler, a conexão MCP e encerra com código 0. */
function encerrar(): void {
  scheduler.stop();
  void closeMagnific();
  server.stop(true);
  // eslint-disable-next-line no-console
  console.log("Encerrado.");
  process.exit(0);
}

process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
