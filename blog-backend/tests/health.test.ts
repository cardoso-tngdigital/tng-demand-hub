/**
 * health.test.ts — smoke test do sidecar.
 *
 * Sobe o servidor num processo filho apontando pra uma porta aleatória alta
 * (fora da faixa 8000–8010 que dev/prod usam), aguarda o health responder e
 * valida:
 *   1. GET /api/health → 200 + {status:"ok"}
 *   2. GET /api/me sem token → 401 + {error}
 * Encerra o processo com SIGTERM ao fim (o main.ts respeita graceful shutdown).
 */

import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";

/** Porta alta e aleatória — evita colidir com dev local ou outros testes. */
const TEST_PORT = 39000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${TEST_PORT}`;

/** Caminho absoluto pro main.ts — resolvido a partir da raiz do backend. */
const MAIN_PATH = resolve(import.meta.dir, "..", "src", "main.ts");

let server: ReturnType<typeof spawn> | null = null;

/**
 * Espera o health check ficar disponível ou desiste após `timeoutMs`.
 * O boot do Bun costuma ser <1s, mas damos folga generosa pra máquinas lentas.
 */
async function esperarSaude(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let ultimoErro: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch (err) {
      ultimoErro = err;
    }
    await Bun.sleep(150);
  }
  throw new Error(
    `Sidecar não respondeu em ${timeoutMs}ms. Último erro: ${String(ultimoErro)}`,
  );
}

beforeAll(async () => {
  // Injetamos SUPABASE_URL/ANON_KEY dummy — o health check não usa Supabase.
  // Também forçamos PORT pro teste isolado.
  server = spawn({
    cmd: ["bun", "run", MAIN_PATH],
    env: {
      ...process.env,
      SUPABASE_URL: process.env["SUPABASE_URL"] ?? "https://dummy.supabase.co",
      SUPABASE_ANON_KEY:
        process.env["SUPABASE_ANON_KEY"] ?? "dummy-anon-key-for-tests",
      PORT: String(TEST_PORT),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await esperarSaude();
});

afterAll(() => {
  if (server !== null && !server.killed) {
    server.kill("SIGTERM");
  }
});

describe("Sidecar do blog — smoke test", () => {
  it("GET /api/health responde 200 com status ok", async () => {
    const r = await fetch(`${BASE}/api/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      status: string;
      version: string;
      uptime_sec: number;
    };
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.uptime_sec).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/me sem token responde 401", async () => {
    const r = await fetch(`${BASE}/api/me`);
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("Não autenticado");
  });
});
