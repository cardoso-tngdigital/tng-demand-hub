/**
 * steps/publish.ts — Etapa 6: publicação no WordPress (REST API).
 *
 * Porte fiel de `app/steps/publish.py`. Sobe as imagens ANTES de criar o post
 * (RNF-06: nada pela metade); usa a 1ª como imagem destacada e insere as
 * demais como `<figure>` antes do 2º, 3º… `<h2>` (pulando o 1º). Cria o post
 * como `publish` (padrão), `draft` (rascunho) ou `future` (agendado com
 * `date_gmt` em UTC). Grava RankMath via plugin — se falhar, marca
 * `rankmath_ok:false` mas não derruba a publicação.
 */

import type { ArtigoGerado } from "./gemini";
import type { WPSite, WPMediaResponse } from "../wordpress";
import {
  atualizarMidia,
  criarPost,
  gravarRankMath,
  uploadMidia,
} from "../wordpress";

/** Imagem já otimizada (WebP) pronta pra upload. */
export interface ImagemPublicavel {
  readonly buffer: ArrayBuffer;
  readonly filename: string;
  readonly alt: string;
  readonly caption?: string;
}

/** Payload aceito por `publicarPost`. */
export interface PublicarPostInput {
  readonly site: WPSite;
  readonly artigo: ArtigoGerado;
  readonly imagens: readonly ImagemPublicavel[];
  readonly keyword: string;
  readonly data?: Date;
  readonly rascunho?: boolean;
}

/** Retorno consolidado da publicação (id + url + slug + status do RankMath). */
export interface PublicarPostResult {
  readonly post_id: number;
  readonly post_url: string;
  readonly slug: string;
  readonly rankmath_ok: boolean;
}

/** Detalhe da mídia após upload — mantém `alt` disponível pra inserir na figura. */
interface MidiaEnviada {
  readonly id: number;
  readonly source_url: string;
  readonly alt: string;
  readonly caption: string;
}

/** Escapa aspas duplas para uso seguro em atributos HTML. */
function escapeHtmlAttr(v: string): string {
  return v.replace(/"/g, "&quot;");
}

/** Monta o snippet `<figure>` da imagem embutida. */
function figuraHtml(url: string, alt: string, caption: string): string {
  const altAttr = escapeHtmlAttr(alt);
  if (caption.length > 0) {
    const captionSafe = escapeHtmlAttr(caption);
    return (
      `<figure class="wp-block-image size-large">` +
      `<img src="${url}" alt="${altAttr}"/>` +
      `<figcaption>${captionSafe}</figcaption>` +
      `</figure>`
    );
  }
  return (
    `<figure class="wp-block-image size-large">` +
    `<img src="${url}" alt="${altAttr}"/>` +
    `</figure>`
  );
}

/**
 * Distribui as figuras no HTML antes dos H2 (pulando o 1º). Se sobrar figura
 * (menos H2 que imagens), joga no final. Reproduz o `_inserir_no_corpo` do Python.
 * Exportada só pra testes — não faz parte da API pública do módulo.
 */
export function _inserirImagensNoCorpo(html: string, figuras: readonly string[]): string {
  if (figuras.length === 0) return html;
  const posicoes: number[] = [];
  const regex = /<h2/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) posicoes.push(match.index);

  const alvos = posicoes.slice(1); // pula o 1º H2 pra imagem não colar no topo
  if (alvos.length === 0) {
    return html + figuras.join("");
  }

  const pares: Array<{ fig: string; pos: number }> = [];
  const usadas = Math.min(figuras.length, alvos.length);
  for (let i = 0; i < usadas; i++) {
    // TypeScript strict — usa non-null com bounds já garantidos pelo loop.
    pares.push({ fig: figuras[i] as string, pos: alvos[i] as number });
  }
  const sobra = figuras.slice(usadas);

  // Insere de trás pra frente pra não deslocar os índices seguintes.
  pares.sort((a, b) => b.pos - a.pos);
  let resultado = html;
  for (const p of pares) {
    resultado = resultado.slice(0, p.pos) + p.fig + resultado.slice(p.pos);
  }
  if (sobra.length > 0) resultado += sobra.join("");
  return resultado;
}

/**
 * Decide o status/date_gmt do post a partir de `data` + `rascunho`.
 * Regra: `rascunho` sempre vence → `draft`. Sem `data` → `publish` (agora).
 * `data` no passado → `publish` (agora). `data` no futuro → `future` +
 * `date_gmt` em UTC (`YYYY-MM-DDTHH:MM:SS`, sem fuso).
 *
 * Exportada só pra testes.
 */
export function _resolverStatus(
  data: Date | undefined,
  rascunho: boolean,
): { status: "publish" | "draft" | "future"; date_gmt?: string } {
  if (rascunho) return { status: "draft" };
  if (data === undefined) return { status: "publish" };
  const agora = new Date();
  if (data.getTime() <= agora.getTime()) return { status: "publish" };
  // ISO em UTC sem sufixo Z, no formato que o WP espera para date_gmt.
  const iso = data.toISOString(); // ex.: 2026-07-15T13:00:00.000Z
  const dateGmt = iso.slice(0, 19); // corta ".000Z"
  return { status: "future", date_gmt: dateGmt };
}

/**
 * Publica (ou agenda / salva como rascunho) o artigo com as imagens.
 * Retorna `post_id`, `post_url`, `slug` e `rankmath_ok`. Nunca vaza detalhes
 * técnicos ao usuário — mensagens são reescritas em pt-BR.
 */
export async function publicarPost(input: PublicarPostInput): Promise<PublicarPostResult> {
  const { site, artigo, imagens, keyword } = input;
  const rascunho = input.rascunho === true;

  // 1. Sobe todas as mídias antes de criar o post (RNF-06).
  const midias: MidiaEnviada[] = [];
  try {
    for (let i = 0; i < imagens.length; i++) {
      const img = imagens[i];
      if (!img) continue;
      const media: WPMediaResponse = await uploadMidia(
        site,
        img.buffer,
        img.filename,
        "image/webp",
      );
      // Alt/caption melhoram SEO; falha silenciosa não impede publicação.
      if (img.alt.length > 0 || (img.caption ?? "").length > 0) {
        try {
          const campos: { alt_text?: string; caption?: string } = {};
          if (img.alt.length > 0) campos.alt_text = img.alt;
          if (img.caption && img.caption.length > 0) campos.caption = img.caption;
          await atualizarMidia(site, media.id, campos);
        } catch {
          // ignorar — o post continua
        }
      }
      midias.push({
        id: media.id,
        source_url: media.source_url,
        alt: img.alt,
        caption: img.caption ?? "",
      });
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("Falha ao enviar as imagens ao WordPress.");
  }

  const destacadaId = midias.length > 0 ? midias[0]?.id : undefined;
  const figuras = midias
    .slice(1)
    .map((m) => figuraHtml(m.source_url, m.alt, m.caption));
  const corpo = _inserirImagensNoCorpo(artigo.content_html, figuras);

  // 2. Cria o post no status apropriado.
  const { status, date_gmt } = _resolverStatus(input.data, rascunho);
  const post = await criarPost(site, {
    title: artigo.title,
    slug: artigo.slug,
    content_html: corpo,
    status,
    ...(date_gmt !== undefined && { date_gmt }),
    ...(destacadaId !== undefined && { featured_media: destacadaId }),
  });

  // 3. RankMath — best-effort, não derruba publicação.
  const rankmathOk = await gravarRankMath(site, post.id, {
    rank_math_title: artigo.rank_math_title || artigo.title,
    meta_description: artigo.meta_description,
    rank_math_focus_keyword: keyword.trim() || undefined,
  }).catch(() => false);

  return {
    post_id: post.id,
    post_url: post.link,
    slug: artigo.slug,
    rankmath_ok: rankmathOk,
  };
}
