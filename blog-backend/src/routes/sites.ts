/**
 * routes/sites.ts — CRUD de sites do blog e callback do plugin WordPress.
 *
 * `/api/sites*` requer auth Supabase (RLS aplica).
 * `POST /api/conectar` NÃO requer auth: é chamado pelo navegador do usuário
 * via form auto-submit do plugin WP v2 — compatibilidade com clientes já
 * conectados. Usa service_role pra escrever ignorando RLS.
 */

import { Hono, type Context } from "hono";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { testarConexao, type WPSite } from "../wordpress";

/** Row de `blog.sites` sanitizada (sem `token`). */
type SiteRow = Record<string, unknown>;
function sanitizar(row: SiteRow): SiteRow {
  const { token: _t, ...rest } = row;
  void _t;
  return rest;
}

export const sitesRouter = new Hono<AuthEnv>();

/** GET /api/sites — lista visível ao usuário (RLS filtra). */
sitesRouter.get("/", requireAuth, async (c: Context<AuthEnv>) => {
  const supabase = c.get("supabase");
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .order("created_at", { ascending: false });
  if (error !== null) {
    return c.json({ error: "Não foi possível listar os sites.", details: error.message }, 500);
  }
  const rows = (data ?? []) as SiteRow[];
  return c.json({ sites: rows.map(sanitizar) });
});

/**
 * GET /api/sites/summary — sites + contadores agregados por site.
 *
 * Antes o painel Sites puxava sites + agendamentos completos + histórico
 * completo pra montar o badge "5/10". Com dezenas de artigos publicados
 * isso serializava payload gigante e derrubava a latência pra 3-5s. Aqui
 * projetamos só o `site_id` das tabelas grandes — o cliente recebe a
 * mesma informação em uma fração do tempo.
 *
 * Retorna:
 *   { sites: SiteRow[], contadores: { [site_id]: { agendados, publicados } } }
 */
sitesRouter.get("/summary", requireAuth, async (c: Context<AuthEnv>) => {
  const supabase = c.get("supabase");
  const [sitesRes, agRes, hsRes] = await Promise.all([
    supabase
      .from("sites")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("agendamentos")
      .select("site_id")
      .eq("status", "pendente"),
    supabase
      .from("historico")
      .select("site_id")
      .in("status", ["concluido", "publicado"]),
  ]);

  if (sitesRes.error !== null) {
    return c.json(
      { error: "Não foi possível listar os sites.", details: sitesRes.error.message },
      500,
    );
  }
  if (agRes.error !== null) {
    return c.json(
      { error: "Erro contando agendamentos.", details: agRes.error.message },
      500,
    );
  }
  if (hsRes.error !== null) {
    return c.json(
      { error: "Erro contando histórico.", details: hsRes.error.message },
      500,
    );
  }

  const rows = ((sitesRes.data ?? []) as SiteRow[]).map(sanitizar);
  const contadores: Record<string, { agendados: number; publicados: number }> = {};
  for (const row of rows) {
    const id = (row as { id?: string }).id;
    if (typeof id === "string") {
      contadores[id] = { agendados: 0, publicados: 0 };
    }
  }
  for (const r of (agRes.data ?? []) as { site_id: string }[]) {
    const b = contadores[r.site_id];
    if (b !== undefined) b.agendados += 1;
  }
  for (const r of (hsRes.data ?? []) as { site_id: string }[]) {
    const b = contadores[r.site_id];
    if (b !== undefined) b.publicados += 1;
  }

  return c.json({ sites: rows, contadores });
});

/** PUT /api/sites/:id — edita nome/prompt/responsavel/plugin/rankmath. */
sitesRouter.put("/:id", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (body === null) return c.json({ error: "Corpo JSON inválido." }, 400);

  // NÃO permitir edição de `token` por essa rota (segurança)
  const camposPermitidos = ["nome", "prompt", "responsavel", "plugin", "rankmath"] as const;
  const patch: Record<string, unknown> = {};
  for (const k of camposPermitidos) {
    if (k in body) patch[k] = body[k];
  }
  patch.updated_at = new Date().toISOString();

  const supabase = c.get("supabase");
  const { data, error } = await supabase
    .from("sites")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error !== null) {
    return c.json({ error: "Não foi possível atualizar o site.", details: error.message }, 500);
  }
  if (data === null) return c.json({ error: "Site não encontrado." }, 404);
  return c.json({ site: sanitizar(data as SiteRow) });
});

/** DELETE /api/sites/:id — remove o site. */
sitesRouter.delete("/:id", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const supabase = c.get("supabase");
  const { error } = await supabase.from("sites").delete().eq("id", id);
  if (error !== null) {
    return c.json({ error: "Não foi possível remover o site.", details: error.message }, 500);
  }
  return c.json({ ok: true });
});

/** POST /api/sites/:id/testar — testa conexão real + atualiza flags. */
sitesRouter.post("/:id/testar", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const supabase = c.get("supabase");
  const { data: site, error: errSite } = await supabase
    .from("sites")
    .select("id, url, token")
    .eq("id", id)
    .maybeSingle();
  if (errSite !== null) {
    return c.json({ error: "Erro lendo o site.", details: errSite.message }, 500);
  }
  if (site === null) return c.json({ error: "Site não encontrado." }, 404);

  const wpSite: WPSite = {
    id: (site as { id: string }).id,
    url: (site as { url: string }).url,
    ...((site as { token?: string | null }).token
      ? { token: (site as { token: string }).token }
      : {}),
  };
  const result = await testarConexao(wpSite);

  await supabase
    .from("sites")
    .update({
      status: result.connected ? "conectado" : "erro",
      plugin: result.plugin,
      rankmath: result.rankmath,
      ultima_verificacao: new Date().toISOString(),
    })
    .eq("id", id);

  return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /api/conectar — callback público do plugin WordPress v2.
// Fica exportado SEPARADO porque não passa pelo middleware de auth.
// ---------------------------------------------------------------------------

export const conectarPublicRouter = new Hono();

conectarPublicRouter.post("/conectar", async (c) => {
  if (env.SUPABASE_SERVICE_ROLE_KEY.length === 0) {
    return c.html(
      _paginaErroHTML(
        "Conexão desligada",
        "Este sidecar não tem SUPABASE_SERVICE_ROLE_KEY configurada. Peça ao admin.",
      ),
      503,
    );
  }

  // O plugin manda como form-urlencoded (auto-submit).
  const form = await c.req.parseBody().catch(() => null);
  if (form === null) {
    return c.html(_paginaErroHTML("Erro", "Formulário inválido."), 400);
  }
  const nome = String(form.nome ?? "").trim();
  const url = String(form.url ?? "").trim();
  const token = String(form.token ?? "").trim();
  if (!url || !token) {
    return c.html(_paginaErroHTML("Erro", "Campos obrigatórios ausentes."), 400);
  }

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "blog" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const patch = {
    nome: nome || null,
    url,
    token,
    status: "conectado",
    plugin: true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("sites")
    .upsert(patch, { onConflict: "url" });

  if (error !== null) {
    return c.html(
      _paginaErroHTML("Erro ao conectar", `Falha ao salvar: ${error.message}`),
      500,
    );
  }
  return c.html(_paginaSucessoHTML(nome || url));
});

/** Página HTML de sucesso (tema TNG marine + orange). */
function _paginaSucessoHTML(nome: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Conectado ao TNG Blog</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#082345;color:#eef3fa;
       display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#0a1f3a;padding:2rem 2.5rem;border-radius:12px;max-width:480px;
        text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
  h1{color:#F6A532;margin:0 0 1rem;font-size:1.3rem}
  p{margin:0 0 1.5rem;line-height:1.5;color:#aac0d8}
  strong{color:#eef3fa}
  button{background:#F6A532;color:#082345;border:0;padding:.7rem 1.3rem;
         border-radius:8px;font-weight:600;cursor:pointer;font-size:.95rem}
</style></head><body>
<div class="card">
  <h1>✓ Site conectado</h1>
  <p><strong>${_esc(nome)}</strong> foi vinculado ao TNG Blog. Você pode fechar essa aba e voltar ao app.</p>
  <button onclick="window.close()">Fechar</button>
</div></body></html>`;
}

/** Página HTML de erro (mesmo tema). */
function _paginaErroHTML(titulo: string, msg: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${_esc(titulo)}</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#082345;color:#eef3fa;
       display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#0a1f3a;padding:2rem 2.5rem;border-radius:12px;max-width:480px;
        text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
  h1{color:#F6A532;margin:0 0 1rem;font-size:1.3rem}
  p{margin:0 0 1rem;line-height:1.5;color:#aac0d8}
</style></head><body>
<div class="card"><h1>${_esc(titulo)}</h1><p>${_esc(msg)}</p></div></body></html>`;
}

function _esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
