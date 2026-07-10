// =============================================================================
// Cliente HTTP do sidecar Blog — Sprint 27
// =============================================================================
// Wrapper de `fetch` que injeta o `X-Supabase-Token` da sessão ativa em
// todas as chamadas autenticadas do sidecar Node. A porta é setada uma
// única vez, após o Tauri retornar o resultado de `blog_sidecar_start_lazy`.
//
// Este módulo NÃO importa nada do domínio Demand Hub (fora o cliente
// Supabase, que já é singleton). Isolamento total do resto do app.
// =============================================================================

import { supabase } from "./supabase/client";

// Porta padrão do sidecar; atualizada por `setBlogPort` assim que o Rust
// devolve o resultado do lazy start. Se ficar no default e o sidecar
// tiver caído numa porta diferente por conflito, as chamadas falham
// silenciosas (ECONNREFUSED) — por isso o Dashboard chama `setBlogPort`
// ANTES de renderizar o painel.
let SIDECAR_PORT = 8000;

/** Setar a porta que o sidecar retornou no start_lazy. */
export function setBlogPort(port: number): void {
  SIDECAR_PORT = port;
}

/** Porta atualmente configurada — útil pra montar links diretos (ex.: download). */
export function getBlogPort(): number {
  return SIDECAR_PORT;
}

/**
 * Timeout padrão das chamadas ao sidecar. Sem isso, um request travado (ex.:
 * sidecar saturado) fica pendurado indefinidamente e a UI "congela" — foi o
 * que aconteceu em 2026-07-09 (requests de 75s). Com AbortController, um
 * request lento aborta rápido e o poll simplesmente pula o ciclo.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Fetch autenticado. Puxa a sessão do Supabase e injeta o token via
 * header customizado (o sidecar rejeita 401 se ausente nas rotas
 * autenticadas). Serializa o body como JSON quando não vem tipado.
 * Erros do sidecar (ex.: `{ error: "..." }`) viram `Error(mensagem)`.
 *
 * `timeoutMs` limita quanto a chamada pode demorar (default 20s) — aborta
 * via AbortController pra nunca pendurar a UI.
 */
export async function blogFetch<T = unknown>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  const headers = new Headers(init?.headers);
  if (token) headers.set("X-Supabase-Token", token);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${SIDECAR_PORT}${path}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Tempo esgotado (${timeoutMs / 1000}s) chamando o Blog.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Corpo não-JSON — deixa `body` como null e cai no fallback abaixo.
    }
    const err = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res as unknown as T;
}

/**
 * Fetch autenticado que devolve um Blob (usado para download de .docx, .zip).
 * Mesma lógica de auth do `blogFetch`, mas retorna `res.blob()` em vez de JSON.
 * Corrige o bug onde `<a href="/api/historico/:id/docx">` disparava 401 por
 * não incluir o token Supabase (Sprint 28).
 */
export async function blogFetchBlob(
  path: string,
  init?: RequestInit,
  timeoutMs = 60_000,
): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  const headers = new Headers(init?.headers);
  if (token) headers.set("X-Supabase-Token", token);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${SIDECAR_PORT}${path}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Tempo esgotado (${timeoutMs / 1000}s) baixando do Blog.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignora
    }
    const err = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  return await res.blob();
}

/**
 * Polling utilitário — chama `fn` a cada `intervalMs` até `predicate(result)`
 * retornar `true` ou o timeout estourar. Usado pra acompanhar progresso de
 * jobs de artigo (etapa "concluido" ou "falhou").
 */
export async function poll<T>(
  fn: () => Promise<T>,
  predicate: (r: T) => boolean,
  intervalMs = 2000,
  timeoutMs = 300_000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (predicate(result)) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Tempo esgotado aguardando resultado.");
}
