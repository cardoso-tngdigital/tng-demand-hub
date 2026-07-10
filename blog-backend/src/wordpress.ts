/**
 * wordpress.ts — cliente HTTP compartilhado para a REST API do WordPress.
 *
 * Porte fiel de `app/wp_client.py`. Inclui o User-Agent de navegador real
 * (sites atrás de Cloudflare bloqueiam clientes que não parecem navegador —
 * observado no POC: erro 520). Suporta os 2 modos de autenticação:
 *  - novo (plugin v2): header `X-TNG-Blog-Token` com o token que o plugin gera;
 *  - legado: Application Password via `Authorization: Basic base64(user:pass)`.
 * Retry automático em 502/503/504 e mensagens de erro sempre em pt-BR.
 */

/** Ficha do site como vive no schema `blog.sites` do Supabase. */
export interface WPSite {
  readonly id: string;
  readonly url: string;
  readonly token?: string | null;
  readonly wp_user?: string | null;
  readonly wp_app_password?: string | null;
}

/** User-Agent copiado do Python — sem isso, Cloudflare devolve 520. */
export const WP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Códigos HTTP tratados como transitórios e refeitos com backoff. */
const RETRY_STATUS = new Set<number>([502, 503, 504]);

/** Espera entre tentativas — mantém o comportamento do POC (1s, 3s). */
const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

/** Timeout padrão do fetch — 60s cobre upload de imagens grandes. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Resposta serializada do wrapper de fetch — nunca lança em HTTP != 2xx. */
export interface WPResponse<T = unknown> {
  readonly status: number;
  readonly data: T;
  readonly error?: string;
}

/** Resultado do teste de conexão (equivalente a `wp_client.testar` no Python). */
export interface WPConnectionCheck {
  readonly connected: boolean;
  readonly plugin: boolean;
  readonly rankmath: boolean;
  readonly version?: string;
  readonly user?: string;
  readonly error?: string;
}

/** Payload aceito por `criarPost`. */
export interface WPCreatePostInput {
  readonly title: string;
  readonly slug: string;
  readonly content_html: string;
  readonly status: "publish" | "draft" | "future";
  readonly date_gmt?: string;
  readonly featured_media?: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Payload aceito por `gravarRankMath`. */
export interface WPRankMathInput {
  readonly rank_math_title?: string;
  readonly meta_description?: string;
  readonly rank_math_focus_keyword?: string;
}

/** Item de página/post retornado por `buscarPaginas`/`buscarPosts`. */
export interface WPListItem {
  readonly id: number;
  readonly slug: string;
  readonly link: string;
  readonly title: string;
}

/** Resposta do WordPress ao criar/consultar mídia. */
export interface WPMediaResponse {
  readonly id: number;
  readonly source_url: string;
}

/** Resposta do WordPress ao criar post. */
export interface WPPostResponse {
  readonly id: number;
  readonly link: string;
  readonly status: string;
}

/** Constrói os headers de autenticação seguindo o mesmo critério do Python. */
export function buildAuthHeaders(site: WPSite): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": WP_USER_AGENT };
  const token = site.token?.trim();
  if (token) {
    headers["X-TNG-Blog-Token"] = token;
    return headers;
  }
  const user = site.wp_user?.trim() ?? "";
  const pwd = site.wp_app_password ?? "";
  if (user || pwd) {
    // Sem depender de `btoa`: Buffer nativo funciona no Bun e no Node.
    const encoded = Buffer.from(`${user}:${pwd}`, "utf-8").toString("base64");
    headers["Authorization"] = `Basic ${encoded}`;
  }
  return headers;
}

/** Concatena base + path preservando barras. */
function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/** Sleep sem depender de `Bun.sleep` (mantém compat com Node). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Traduz status HTTP conhecidos em mensagens amigáveis (mesma tabela do Python). */
function explicarStatus(status: number): string {
  switch (status) {
    case 403:
      return "Acesso bloqueado (403) — pode ser plugin de segurança/firewall.";
    case 404:
      return "Endpoint REST não encontrado (404) — a REST API pode estar desativada.";
    case 520:
      return "Erro do Cloudflare (520) — verifique se a URL está correta e o site no ar.";
    case 522:
      return "Cloudflare não conseguiu conectar ao servidor do site (522).";
    default:
      return `O site respondeu com código ${status}.`;
  }
}

/** Faz uma tentativa isolada de fetch — sem retry — e devolve `Response`. */
async function fetchOnce(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Parseia o corpo da resposta — JSON quando possível, texto como fallback. */
async function parseBody(r: Response): Promise<unknown> {
  const text = await r.text();
  if (text.length === 0) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  // Muito plugin WP devolve JSON sem content-type correto — tenta parse assim mesmo.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/** Options aceitas pelo wrapper `wpFetch`. */
export interface WPFetchInit {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly body?: Uint8Array | ArrayBuffer | string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly timeoutMs?: number;
}

/**
 * Wrapper de `fetch` para o WordPress: aplica auth, User-Agent, Content-Type,
 * query string, retry em 502/503/504 e nunca lança em HTTP != 2xx (retorna
 * `{status, data, error}`). Só lança em falha de rede irremediável.
 */
export async function wpFetch<T = unknown>(
  site: WPSite,
  path: string,
  init: WPFetchInit = {},
): Promise<WPResponse<T>> {
  const method = init.method ?? "GET";
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Monta URL com query string quando fornecida.
  let url = joinUrl(site.url, path);
  if (init.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  // Headers: começa com auth+UA, sobrepõe com o que o caller mandar.
  const headers: Record<string, string> = { ...buildAuthHeaders(site) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.headers) {
    for (const [k, v] of Object.entries(init.headers)) headers[k] = v;
  }

  const requestInit: RequestInit = {
    method,
    headers,
    redirect: "follow",
    body:
      init.json !== undefined
        ? JSON.stringify(init.json)
        : (init.body ?? undefined),
  };

  let ultimoErro: unknown = null;
  // Até 2 retries em 502/503/504 (total: até 3 tentativas).
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const r = await fetchOnce(url, requestInit, timeoutMs);
      if (RETRY_STATUS.has(r.status) && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 1_000;
        await sleep(delay);
        continue;
      }
      const data = (await parseBody(r)) as T;
      if (!r.ok) {
        return { status: r.status, data, error: explicarStatus(r.status) };
      }
      return { status: r.status, data };
    } catch (err) {
      ultimoErro = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 1_000;
        await sleep(delay);
        continue;
      }
      throw new Error(
        "Não foi possível se conectar ao WordPress. Verifique a URL e a conexão do site.",
        { cause: ultimoErro instanceof Error ? ultimoErro : undefined },
      );
    }
  }
  // inatingível — o for acima sempre retorna ou lança.
  throw new Error("Falha inesperada ao chamar o WordPress.");
}

/**
 * Sonda o site: valida REST + credencial + presença do plugin e do RankMath.
 * Reproduz o comportamento do `wp_client.testar` do Python, mas devolve num
 * shape mais uniforme (`connected/plugin/rankmath/version/user/error`).
 */
export async function testarConexao(site: WPSite): Promise<WPConnectionCheck> {
  try {
    // 1. REST acessível?
    const raiz = await wpFetch<unknown>(site, "/wp-json/", { timeoutMs: 15_000 });
    if (raiz.status !== 200) {
      return {
        connected: false,
        plugin: false,
        rankmath: false,
        error: explicarStatus(raiz.status),
      };
    }

    // 2. Credencial válida?
    const me = await wpFetch<{ name?: string; slug?: string }>(
      site,
      "/wp-json/wp/v2/users/me",
      { timeoutMs: 15_000 },
    );
    if (me.status === 401 || me.status === 403) {
      return {
        connected: false,
        plugin: false,
        rankmath: false,
        error:
          "Credencial recusada. Gere uma nova senha de aplicativo no WordPress " +
          "ou reconecte o plugin.",
      };
    }
    const usuario = me.data && typeof me.data === "object" ? me.data.slug : undefined;

    // 3. Plugin instalado + RankMath ativo (endpoint do plugin).
    let plugin = false;
    let rankmath = false;
    let versao: string | undefined;
    try {
      const status = await wpFetch<Record<string, unknown>>(
        site,
        "/wp-json/tng-blog/v1/status",
        { timeoutMs: 15_000 },
      );
      if (status.status === 200 && status.data && typeof status.data === "object") {
        plugin = true;
        rankmath = Boolean(status.data["rankmath"]);
        const v = status.data["version"];
        if (typeof v === "string") versao = v;
      }
    } catch {
      // plugin ausente/inatingível — conexão em si continua válida.
    }

    const check: WPConnectionCheck = {
      connected: true,
      plugin,
      rankmath,
      ...(versao !== undefined && { version: versao }),
      ...(usuario !== undefined && { user: usuario }),
    };
    return check;
  } catch (err) {
    return {
      connected: false,
      plugin: false,
      rankmath: false,
      error:
        err instanceof Error
          ? err.message
          : "Não foi possível se conectar ao WordPress.",
    };
  }
}

/**
 * Grava os campos do RankMath via endpoint do plugin (plano B do §6.3 do PRD).
 * Retorna `false` quando o plugin não confirmou a gravação — sem lançar, para
 * a publicação continuar mesmo se o RankMath falhar (regra do Python).
 */
export async function gravarRankMath(
  site: WPSite,
  postId: number,
  campos: WPRankMathInput,
): Promise<boolean> {
  const payload: Record<string, unknown> = { post_id: postId };
  if (campos.rank_math_title !== undefined) payload["title"] = campos.rank_math_title;
  if (campos.meta_description !== undefined) payload["description"] = campos.meta_description;
  if (campos.rank_math_focus_keyword !== undefined) {
    payload["focus_keyword"] = campos.rank_math_focus_keyword;
  }
  try {
    const r = await wpFetch<{ ok?: boolean }>(site, "/wp-json/tng-blog/v1/rankmath", {
      method: "POST",
      json: payload,
    });
    return (
      r.status === 200 &&
      r.data !== null &&
      typeof r.data === "object" &&
      r.data.ok === true
    );
  } catch {
    return false;
  }
}

/** Cria (publica/agenda/rascunho) um post no WordPress. */
export async function criarPost(
  site: WPSite,
  input: WPCreatePostInput,
): Promise<WPPostResponse> {
  const payload: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    content: input.content_html,
    status: input.status,
  };
  if (input.featured_media !== undefined) payload["featured_media"] = input.featured_media;
  if (input.date_gmt !== undefined) payload["date_gmt"] = input.date_gmt;
  if (input.meta !== undefined) payload["meta"] = input.meta;

  const r = await wpFetch<WPPostResponse & { message?: string }>(site, "/wp-json/wp/v2/posts", {
    method: "POST",
    json: payload,
  });
  if (r.status !== 200 && r.status !== 201) {
    const detalhe =
      r.data && typeof r.data === "object" && typeof r.data.message === "string"
        ? ` ${r.data.message}`
        : "";
    throw new Error(
      `O WordPress recusou a criação do post (${r.status}).${detalhe}`.trim(),
    );
  }
  if (!r.data || typeof r.data !== "object" || typeof r.data.id !== "number") {
    throw new Error("Resposta inesperada do WordPress ao criar o post.");
  }
  return {
    id: r.data.id,
    link: r.data.link ?? `${site.url.replace(/\/+$/, "")}/?p=${r.data.id}`,
    status: r.data.status ?? input.status,
  };
}

/** Sobe uma imagem (buffer) como mídia. Aceita image/webp (padrão), image/png ou image/jpeg. */
export async function uploadMidia(
  site: WPSite,
  buffer: ArrayBuffer,
  filename: string,
  contentType: "image/webp" | "image/png" | "image/jpeg" = "image/webp",
): Promise<WPMediaResponse> {
  // O WP REST aceita upload "cru" com Content-Type + Content-Disposition —
  // é o mesmo caminho do Python, evita mexer com multipart boundary.
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
  };
  // Uint8Array casa com o tipo BodyInit aceito pelo fetch do Bun/Node.
  const body = new Uint8Array(buffer);
  const r = await wpFetch<WPMediaResponse & { message?: string }>(
    site,
    "/wp-json/wp/v2/media",
    { method: "POST", headers, body },
  );
  if (r.status !== 200 && r.status !== 201) {
    const detalhe =
      r.data && typeof r.data === "object" && typeof r.data.message === "string"
        ? ` ${r.data.message}`
        : "";
    throw new Error(
      `Falha ao enviar uma imagem ao WordPress (${r.status}).${detalhe}`.trim(),
    );
  }
  if (!r.data || typeof r.data !== "object" || typeof r.data.id !== "number") {
    throw new Error("Resposta inesperada do WordPress ao enviar a imagem.");
  }
  return { id: r.data.id, source_url: r.data.source_url ?? "" };
}

/** Atualiza `alt_text` e `caption` de uma mídia já existente. */
export async function atualizarMidia(
  site: WPSite,
  mediaId: number,
  campos: { alt_text?: string; caption?: string },
): Promise<boolean> {
  const r = await wpFetch(site, `/wp-json/wp/v2/media/${mediaId}`, {
    method: "POST",
    json: campos,
  });
  return r.status === 200 || r.status === 201;
}

/** Normaliza raw da REST em `WPListItem`. Aceita `title` como string ou `{rendered}`. */
function normalizarListItem(raw: unknown): WPListItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj["id"] === "number" ? obj["id"] : null;
  const link = typeof obj["link"] === "string" ? obj["link"] : null;
  const slug = typeof obj["slug"] === "string" ? obj["slug"] : "";
  if (id === null || link === null) return null;
  const tituloRaw = obj["title"];
  let titulo = "";
  if (typeof tituloRaw === "string") {
    titulo = tituloRaw;
  } else if (tituloRaw && typeof tituloRaw === "object") {
    const rendered = (tituloRaw as Record<string, unknown>)["rendered"];
    if (typeof rendered === "string") titulo = rendered;
  }
  return { id, link, slug, title: titulo };
}

/** Opts comuns aos search endpoints do WP. */
export interface WPListOpts {
  readonly search?: string;
  readonly per_page: number;
}

/** GET /wp-json/wp/v2/pages */
export async function buscarPaginas(
  site: WPSite,
  opts: WPListOpts,
): Promise<WPListItem[]> {
  return await listar(site, "pages", opts);
}

/** GET /wp-json/wp/v2/posts */
export async function buscarPosts(
  site: WPSite,
  opts: WPListOpts,
): Promise<WPListItem[]> {
  return await listar(site, "posts", opts);
}

async function listar(
  site: WPSite,
  tipo: "pages" | "posts",
  opts: WPListOpts,
): Promise<WPListItem[]> {
  const perPage = Math.min(Math.max(opts.per_page, 1), 20);
  const query: Record<string, string | number | undefined> = {
    per_page: perPage,
    status: "publish",
    _fields: "id,link,slug,title",
  };
  if (opts.search && opts.search.trim().length > 0) {
    query["search"] = opts.search.trim();
    query["orderby"] = "relevance";
  }
  const r = await wpFetch<unknown>(site, `/wp-json/wp/v2/${tipo}`, { query });
  if (r.status !== 200 || !Array.isArray(r.data)) return [];
  const itens: WPListItem[] = [];
  for (const raw of r.data) {
    const item = normalizarListItem(raw);
    if (item) itens.push(item);
  }
  return itens;
}
