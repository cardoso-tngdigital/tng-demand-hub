/**
 * middleware/auth.ts — protege rotas do sidecar com o JWT do usuário.
 *
 * O front do Tauri manda o `access_token` do Supabase em cada request,
 * seja pelo header customizado `X-Supabase-Token`, seja como Bearer no
 * `Authorization`.
 *
 * VALIDAÇÃO LOCAL (2026-07-09): validamos a ASSINATURA do JWT localmente
 * com a chave pública do projeto (JWKS), SEM ir à rede. A versão anterior
 * chamava `auth.getUser(token)` — uma ida a `/auth/v1/user` do Supabase EM
 * CADA request. Com o painel pollando (progresso de job a cada 2s, contador
 * de notificações, etc.) + 2 pipelines simultâneos, isso virou uma tempestade
 * de chamadas que estourou o rate limit de auth do Supabase; o cliente
 * auth-js entrou em retry de ~75s por request, saturou o Bun.serve e o app
 * inteiro CONGELOU (diagnóstico em registros-terminal.txt, 2026-07-09).
 *
 * O projeto assina com ES256 (chave assimétrica) e expõe a chave PÚBLICA no
 * JWKS — validar com ela não exige segredo nenhum. A `jose` busca o JWKS uma
 * única vez, cacheia, e re-busca sozinha se aparecer um `kid` novo (rotação).
 *
 * Trade-off consciente: validação local aceita o token até ele EXPIRAR
 * (~1h). Um token revogado no servidor (logout/ban) seguiria válido aqui até
 * expirar. Pra um sidecar local do próprio usuário logado, é irrelevante.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import type { User } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env";
import { makeSupabaseForUser, type BlogSupabaseClient } from "../supabase";

/** Tipagem das variáveis que o middleware injeta no contexto Hono. */
export type AuthEnv = {
  Variables: {
    user: User;
    supabase: BlogSupabaseClient;
  };
};

/**
 * JWKS público do projeto — chaves de verificação. Buscado da URL uma vez e
 * cacheado internamente pela jose (com refetch automático em `kid` novo).
 * Nenhuma chamada de rede no caminho quente do request depois do 1º fetch.
 */
const JWKS = createRemoteJWKSet(
  new URL(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`),
);

/** Fallback pro campo `aud` do objeto User quando a claim não vier. */
const AUDIENCE_PADRAO = "authenticated";

/**
 * Extrai o token do request aceitando os dois formatos.
 * Retorna string vazia se nenhum estiver presente ou se estiver em branco.
 */
function extrairToken(c: Context): string {
  const custom = c.req.header("X-Supabase-Token")?.trim();
  if (custom) return custom;
  const bearer = c.req.header("Authorization")?.trim();
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return "";
}

/** Middleware Hono que valida o token e injeta `user` + `supabase` no contexto. */
export const requireAuth: MiddlewareHandler<AuthEnv> = async (
  c: Context<AuthEnv>,
  next: Next,
) => {
  const token = extrairToken(c);
  if (!token) {
    return c.json({ error: "Não autenticado" }, 401);
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    // Verifica ASSINATURA (contra o JWKS do projeto) + EXPIRAÇÃO (exp).
    // Não forçamos `issuer`/`audience`: a assinatura válida já prova que o
    // token foi emitido por ESTE projeto (só a chave privada dele gera uma
    // assinatura que valida no nosso JWKS). Enforcar iss/aud daria um risco
    // de hard-fail por diferença de formato — abordagem mínima e segura,
    // igual ao exemplo oficial do Supabase.
    ({ payload } = await jwtVerify(token, JWKS));
  } catch {
    return c.json({ error: "Sessão inválida ou expirada" }, 401);
  }

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) {
    return c.json({ error: "Token sem identificação de usuário." }, 401);
  }

  // Monta um `User` mínimo a partir das claims (downstream só usa id/email).
  const user = {
    id: userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    aud: typeof payload.aud === "string" ? payload.aud : AUDIENCE_PADRAO,
    role: typeof payload.role === "string" ? payload.role : undefined,
    app_metadata:
      (payload.app_metadata as Record<string, unknown> | undefined) ?? {},
    user_metadata:
      (payload.user_metadata as Record<string, unknown> | undefined) ?? {},
    created_at: "",
  } as unknown as User;

  c.set("user", user);
  c.set("supabase", makeSupabaseForUser(token));
  await next();
  // Retorno explícito exigido pelo `noImplicitReturns` — Hono aceita undefined
  // e usa o `c.res` construído pelo próximo handler.
  return;
};
