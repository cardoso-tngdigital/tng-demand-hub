/**
 * supabase.ts — fábrica de clientes Supabase para o sidecar.
 *
 * O sidecar é sem-estado quanto a auth: cada request do front chega com o
 * `access_token` do usuário logado e a gente monta um client por request,
 * apontando pro schema `blog` (não `public`). Os RLS do banco cuidam do resto.
 * `sondarSchema()` faz uma leitura barata pra confirmar que o schema está
 * exposto e o token é válido — usado no health check.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/** Nome do schema onde vivem `sites`, `historico`, `agendamentos` etc. */
export const BLOG_SCHEMA = "blog" as const;

/**
 * Cria um client Supabase com sessão do usuário embutida (JWT no header).
 * Nunca persiste a sessão em disco — o sidecar é volátil.
 * O tipo é inferido do `createClient` — vem parametrizado como
 * `SupabaseClient<any, any, "blog", ...>` porque configuramos o schema.
 */
export function makeSupabaseForUser(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    db: { schema: BLOG_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Tipo do client retornado por `makeSupabaseForUser` — usado no middleware. */
export type BlogSupabaseClient = ReturnType<typeof makeSupabaseForUser>;

/**
 * Cria um cliente Supabase com `service_role` — ignora RLS. É usado apenas
 * pelo scheduler e pelo callback do plugin WordPress (POST /api/conectar),
 * onde não há sessão de usuário. O caller PRECISA verificar que
 * `env.SUPABASE_SERVICE_ROLE_KEY` está definido antes de invocar — se estiver
 * vazio, a função lança pra deixar o problema evidente em vez de fazer
 * fallback silencioso.
 */
export function makeSupabaseAdmin() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não está configurada — não é possível " +
        "criar um client administrativo. Defina no .env.local do sidecar.",
    );
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: BLOG_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resultado da sondagem do schema — usado no health check. */
export interface SondaSchemaResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Verifica se o schema `blog` está exposto na Data API do Supabase e se o
 * token do usuário atende o RLS mínimo. Faz um SELECT `head` em `sites` com
 * limit=1 (barato, não trafega dados).
 */
export async function sondarSchema(accessToken: string): Promise<SondaSchemaResult> {
  const client = makeSupabaseForUser(accessToken);
  try {
    const { error } = await client
      .from("sites")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (error === null) {
      return { ok: true, message: "Schema blog acessível." };
    }
    // Erros de exposição do schema aparecem como PGRST106 ou mensagem específica.
    const msg = error.message ?? "";
    if (/schema/i.test(msg) && /blog/i.test(msg)) {
      return {
        ok: false,
        message:
          "O schema 'blog' ainda não está exposto na Data API do Supabase " +
          "(Project Settings → Data API → Exposed schemas).",
      };
    }
    return { ok: false, message: `Falha ao acessar schema blog: ${msg}` };
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Erro inesperado ao sondar schema: ${detalhe}` };
  }
}
