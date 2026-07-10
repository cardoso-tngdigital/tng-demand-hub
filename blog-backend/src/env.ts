/**
 * env.ts — leitura tipada das variáveis de ambiente do sidecar.
 *
 * Em dev lemos `.env.local` (carregado automaticamente pelo Bun via `Bun.env`);
 * em produção vem do ambiente do processo. Se faltar uma variável obrigatória
 * (SUPABASE_URL, SUPABASE_ANON_KEY) o processo aborta com código 1 e mensagem
 * clara em pt-BR — nunca sobe com fallback "placeholder".
 */

/** Formato da configuração exposto ao resto do backend. */
export interface Env {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  /**
   * Chave `service_role` do Supabase — OPCIONAL.
   * Só é usada pelo scheduler (Sprint 24) e pelo POST /api/conectar (callback do
   * plugin WordPress), ambos casos onde não há sessão de usuário disponível.
   * Se ausente, o scheduler não sobe e a conexão automática de site é desligada.
   * NUNCA é enviada ao React nem loggada — vive só no ambiente do sidecar.
   */
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  /** Opcional na Fase 1: chamadas ao Gemini ainda não estão implementadas. */
  readonly GEMINI_API_KEY: string;
  readonly GEMINI_MODEL: string;
  readonly MAGNIFIC_MCP_URL: string;
  readonly PORT: number;
  readonly DATA_DIR: string;
}

/** Lê a variável, aplica trim e trata string vazia como ausente. */
function readVar(name: string): string | undefined {
  const raw = Bun.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Aborta com mensagem em pt-BR e código 1 — usado só para segredos obrigatórios. */
function abortarSemVariavel(nome: string): never {
  // eslint-disable-next-line no-console
  console.error(
    `[env] Variável obrigatória "${nome}" não está definida. ` +
      `Preencha em blog-backend/.env.local (dev) ou no ambiente do processo (prod). ` +
      `Veja blog-backend/.env.example.`,
  );
  process.exit(1);
}

/** Converte a variável de porta para inteiro, com validação de faixa. */
function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    // eslint-disable-next-line no-console
    console.error(
      `[env] PORT="${raw}" inválida — deve ser um inteiro entre 1 e 65535. Abortando.`,
    );
    process.exit(1);
  }
  return n;
}

const SUPABASE_URL = readVar("SUPABASE_URL") ?? abortarSemVariavel("SUPABASE_URL");
const SUPABASE_ANON_KEY =
  readVar("SUPABASE_ANON_KEY") ?? abortarSemVariavel("SUPABASE_ANON_KEY");

/** Config imutável — importe daqui, nunca leia `Bun.env` direto. */
export const env: Env = Object.freeze({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: readVar("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  // Opcional na Fase 1 — a Sprint 22 vai plugar o cliente Gemini.
  GEMINI_API_KEY: readVar("GEMINI_API_KEY") ?? "",
  GEMINI_MODEL: readVar("GEMINI_MODEL") ?? "gemini-2.5-flash",
  MAGNIFIC_MCP_URL: readVar("MAGNIFIC_MCP_URL") ?? "https://mcp.magnific.com/mcp",
  PORT: parsePort(readVar("PORT"), 8000),
  DATA_DIR: readVar("DATA_DIR") ?? "./data",
});
