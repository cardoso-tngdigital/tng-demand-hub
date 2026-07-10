/**
 * steps/links.ts — Etapa 2: descoberta de links internos (WP REST API).
 *
 * Antes do Gemini gerar o texto, buscamos no site de destino páginas e posts
 * relevantes à keyword para inserir como link building interno (RF-05/06).
 * Estratégia do PRD §8.4: 2 páginas + 1 post relevantes. Não forçamos link
 * fraco (contato/legal) — se não houver bom match, retornamos menos.
 *
 * Porte fiel de `app/steps/links.py`.
 */

import type { WPSite, WPListItem } from "../wordpress";
import { buscarPaginas, buscarPosts } from "../wordpress";

/** Item de link interno devolvido pra Gemini/publish. */
export interface LinkInterno {
  readonly url: string;
  readonly title: string;
  readonly tipo: "page" | "post";
}

/**
 * Slugs que rendem link interno fraco para SEO. Cópia 1:1 do Python
 * (`_SLUGS_EVITAR` em `app/steps/links.py`). "sobre" foi removido porque
 * páginas "Sobre / Sobre nós / Sobre a empresa" costumam ser páginas-pilar
 * válidas — bloqueá-las descartava links úteis (bug do sidecar TS).
 */
const SLUGS_EVITAR: readonly string[] = [
  "politica",
  "privacidade",
  "privacy",
  "termos",
  "terms",
  "cookie",
  "cookies",
  "lgpd",
  "contato",
  "contact",
  "fale-conosco",
  "carrinho",
  "checkout",
  "minha-conta",
];

/** True quando o slug bate com alguma palavra da lista de exclusão. */
function ehFraca(slug: string): boolean {
  const s = slug.toLowerCase();
  return SLUGS_EVITAR.some((palavra) => s.includes(palavra));
}

/** Decide se o item entra: link presente, id inédito e slug não-fraco. */
function aproveitar(item: WPListItem, vistos: Set<number>): boolean {
  if (!item.link) return false;
  if (vistos.has(item.id)) return false;
  if (ehFraca(item.slug)) return false;
  vistos.add(item.id);
  return true;
}

/** Coleta relevância + completa com genéricos (para pages). */
async function coletar(
  site: WPSite,
  tipo: "pages" | "posts",
  termo: string,
  limite: number,
  vistos: Set<number>,
  completar: boolean,
): Promise<WPListItem[]> {
  if (limite <= 0) return [];
  const encontrados: WPListItem[] = [];

  // 1) Prioriza relevância pela keyword.
  if (termo.length > 0) {
    const buscarFn = tipo === "pages" ? buscarPaginas : buscarPosts;
    const relevantes = await buscarFn(site, { search: termo, per_page: limite });
    for (const item of relevantes) {
      if (encontrados.length >= limite) break;
      if (aproveitar(item, vistos)) encontrados.push(item);
    }
  }

  // 2) Só para pages: completa com páginas publicadas gerais (páginas-pilar).
  if (completar && encontrados.length < limite) {
    const buscarFn = tipo === "pages" ? buscarPaginas : buscarPosts;
    const gerais = await buscarFn(site, { per_page: limite * 4 });
    for (const item of gerais) {
      if (encontrados.length >= limite) break;
      if (aproveitar(item, vistos)) encontrados.push(item);
    }
  }

  return encontrados;
}

/** Opts opcionais de `descobrirLinks`. */
export interface DescobrirLinksOpts {
  readonly maxLinks?: number;
}

/**
 * Descobre até `maxLinks` (default 3 = 2 páginas + 1 post) URLs reais do site
 * relevantes à keyword. Nunca força links fracos; se faltar candidato,
 * devolve menos (0–2 é OK).
 */
export async function descobrirLinks(
  site: WPSite,
  keyword: string,
  opts?: DescobrirLinksOpts,
): Promise<LinkInterno[]> {
  const termo = (keyword ?? "").trim();
  const maxLinks = opts?.maxLinks ?? 3;
  // Distribui o teto entre páginas e posts (padrão 2 páginas + 1 post).
  const maxPaginas = maxLinks > 1 ? Math.max(1, maxLinks - 1) : 1;
  const maxPosts = Math.max(0, maxLinks - maxPaginas);

  const vistos = new Set<number>();
  let paginas: WPListItem[];
  let posts: WPListItem[];
  try {
    paginas = await coletar(site, "pages", termo, maxPaginas, vistos, true);
    posts = await coletar(site, "posts", termo, maxPosts, vistos, false);
  } catch (err) {
    throw new Error(
      "Não consegui ler os links internos do site (falha de conexão com o WordPress). " +
        "Verifique a conexão do site na aba Sites.",
      { cause: err instanceof Error ? err : undefined },
    );
  }

  const urls = new Set<string>();
  const resultado: LinkInterno[] = [];
  const empurrar = (item: WPListItem, tipo: "page" | "post"): void => {
    if (!item.link || urls.has(item.link)) return;
    urls.add(item.link);
    resultado.push({ url: item.link, title: item.title, tipo });
  };
  for (const p of paginas) empurrar(p, "page");
  for (const p of posts) empurrar(p, "post");

  return resultado.slice(0, maxLinks);
}
