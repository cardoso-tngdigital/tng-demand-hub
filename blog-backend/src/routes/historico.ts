/**
 * routes/historico.ts — histórico de artigos + geração de .docx +
 * publicação de rascunho pelo painel.
 */

import { Hono, type Context } from "hono";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { gerarDocxArtigo } from "../steps/docx";
import { wpFetch, type WPSite } from "../wordpress";

export const historicoRouter = new Hono<AuthEnv>();

/** GET /api/historico?site_id=... — lista, filtrando por site opcional. */
historicoRouter.get("/", requireAuth, async (c: Context<AuthEnv>) => {
  const siteId = c.req.query("site_id");
  const supabase = c.get("supabase");
  let query = supabase.from("historico").select("*").order("created_at", { ascending: false });
  if (siteId) query = query.eq("site_id", siteId);
  const { data, error } = await query;
  if (error !== null) {
    return c.json({ error: "Não foi possível listar o histórico.", details: error.message }, 500);
  }
  return c.json({ historico: data ?? [] });
});

/** GET /api/historico/:id/docx — devolve .docx do post pra aprovação. */
historicoRouter.get("/:id/docx", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const supabase = c.get("supabase");
  const { data: item, error } = await supabase
    .from("historico")
    .select("id, title, slug, post_url, site_id, keyword")
    .eq("id", id)
    .maybeSingle();
  if (error !== null || item === null) return c.json({ error: "Item não encontrado." }, 404);

  // Busca o site pra chamar o WP
  const { data: siteRow } = await supabase
    .from("sites")
    .select("id, url, token")
    .eq("id", (item as { site_id: string }).site_id)
    .maybeSingle();
  if (siteRow === null) return c.json({ error: "Site do artigo não encontrado." }, 404);

  const wpSite: WPSite = {
    id: (siteRow as { id: string }).id,
    url: (siteRow as { url: string }).url,
    ...((siteRow as { token?: string | null }).token
      ? { token: (siteRow as { token: string }).token }
      : {}),
  };

  // Prefere o `slug` do banco (fonte confiável, igual Python). Só usa
  // `post_url.split(...).pop()` como fallback se o slug não tiver sido
  // gravado no histórico (rows antigos).
  const itemTyped = item as {
    title: string;
    slug: string | null;
    post_url: string | null;
    keyword: string | null;
  };
  const slugDoBanco = (itemTyped.slug ?? "").trim();
  const slugDoUrl =
    (itemTyped.post_url ?? "").split("/").filter(Boolean).pop() ?? "";
  const slug = slugDoBanco || slugDoUrl;
  if (!slug) {
    return c.json(
      { error: "Não há slug do post no histórico — não consigo buscar no WordPress." },
      404,
    );
  }
  const resp = await wpFetch(
    wpSite,
    `/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&status=draft,publish,future,pending,private`,
  );
  if (resp.status !== 200) {
    return c.json({ error: "Não consegui buscar o post no WordPress." }, 502);
  }
  const posts = resp.data as Array<{ content?: { rendered?: string }; title?: { rendered?: string } }>;
  if (!Array.isArray(posts) || posts.length === 0) {
    return c.json({ error: "Post não encontrado no WordPress." }, 404);
  }
  const post = posts[0] as { content?: { rendered?: string }; title?: { rendered?: string } };
  const contentHtml = post.content?.rendered ?? "";
  const title =
    post.title?.rendered ?? itemTyped.title ?? itemTyped.keyword ?? "Artigo";

  const buffer = await gerarDocxArtigo({ title, content_html: contentHtml });
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${_slugFilename(title)}.docx"`,
    },
  });
});

/** POST /api/historico/:id/publicar — muda rascunho pra publicado no WP. */
historicoRouter.post("/:id/publicar", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const supabase = c.get("supabase");
  const { data: item } = await supabase
    .from("historico")
    .select("id, slug, post_url, site_id, status")
    .eq("id", id)
    .maybeSingle();
  if (item === null) return c.json({ error: "Item não encontrado." }, 404);
  if ((item as { status: string }).status !== "rascunho") {
    return c.json({ error: "Este item já não é rascunho." }, 400);
  }

  const { data: siteRow } = await supabase
    .from("sites")
    .select("id, url, token")
    .eq("id", (item as { site_id: string }).site_id)
    .maybeSingle();
  if (siteRow === null) return c.json({ error: "Site do artigo não encontrado." }, 404);

  const wpSite: WPSite = {
    id: (siteRow as { id: string }).id,
    url: (siteRow as { url: string }).url,
    ...((siteRow as { token?: string | null }).token
      ? { token: (siteRow as { token: string }).token }
      : {}),
  };

  const slug = (item as { slug: string }).slug;
  const busca = await wpFetch(
    wpSite,
    `/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&status=draft,publish,future,private`,
  );
  const posts = busca.data as Array<{ id: number }>;
  if (!Array.isArray(posts) || posts.length === 0) {
    return c.json({ error: "Post não achado no WP pelo slug." }, 404);
  }
  const postId = (posts[0] as { id: number }).id;

  // IMPORTANTE: usar `json:` (não `body:`) para que wpFetch aplique
  // `Content-Type: application/json`. Sem isso o WP ignora o payload e o
  // post permanece como rascunho — bug reportado em 2026-07-04.
  const publish = await wpFetch(wpSite, `/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    json: { status: "publish" },
  });
  if (publish.status < 200 || publish.status >= 300) {
    return c.json({ error: "Falha publicando no WP.", details: publish.error }, 502);
  }

  // Paridade com Python: rascunho publicado vira "publicado" (não "concluido").
  await supabase.from("historico").update({ status: "publicado" }).eq("id", id);
  return c.json({ ok: true });
});

/**
 * DELETE /api/historico/:id — remove o REGISTRO do histórico (2026-07-09).
 * Não toca no post do WordPress — é só limpeza do painel (ex.: artigo
 * publicado no site errado por falha humana; o operador apaga no WP admin
 * e remove a linha aqui pra não poluir a listagem).
 */
historicoRouter.delete("/:id", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const supabase = c.get("supabase");
  const { data, error } = await supabase
    .from("historico")
    .delete()
    .eq("id", id)
    .select("id");
  if (error !== null) {
    return c.json({ error: "Erro removendo do histórico.", details: error.message }, 500);
  }
  if (((data ?? []) as unknown[]).length === 0) {
    return c.json({ error: "Item não encontrado." }, 404);
  }
  return c.json({ ok: true });
});

/** Sanitiza título pra filename ASCII curto. */
function _slugFilename(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "artigo";
}
