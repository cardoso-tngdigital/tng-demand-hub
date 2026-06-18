// =============================================================================
// Helpers de conteúdo rich text — TNG Demand Hub
// =============================================================================
// Descrições de demanda e comentários agora são guardados como HTML
// sanitizado. Estes helpers:
//   - sanitizam HTML antes de renderizar via dangerouslySetInnerHTML
//   - convertem markdown → HTML (descrições antigas geradas pela IA usavam
//     sintaxe markdown nos blocos RF-06b)
//   - heurística simples pra decidir se conteúdo legacy é markdown ou
//     texto puro (nesse caso, preserva quebras de linha)
//   - detectam se um HTML está vazio (só whitespace / <p></p>), pra
//     placeholder e validação de envio.
// =============================================================================

import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

// Tags/atributos permitidos. Mantém só o que o editor produz.
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "a",
  "span",
];
// Mantemos só atributos necessários — `class` é usado pelo Mention pra estilizar
// (.tng-mention), `data-*` carregam id/label/tipo da menção pra renderização e
// extração no servidor.
const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "class",
  "data-type",
  "data-id",
  "data-label",
];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });
}

/**
 * Extrai os user_ids únicos das menções (`<span data-type="mention"
 * data-id="...">`) presentes no HTML. Usado para popular `comments.mentions`
 * antes de inserir no banco.
 *
 * Regex em vez de DOMParser porque a função roda no main thread durante o
 * submit do comentário; perfomance não importa, mas evita dependência de DOM
 * pra ficar testável em isolamento.
 */
export function extractMentionIdsFromHtml(html: string): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  const re = /<span[^>]*data-type=["']mention["'][^>]*data-id=["']([^"']+)["']/gi;
  // Aceita também a ordem invertida (data-id antes de data-type).
  const reReverse = /<span[^>]*data-id=["']([^"']+)["'][^>]*data-type=["']mention["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  while ((m = reReverse.exec(html)) !== null) ids.add(m[1]);
  return Array.from(ids);
}

// Detecta marcadores comuns de markdown.
function looksLikeMarkdown(text: string): boolean {
  return (
    /\*\*[^*]+\*\*/.test(text) || // **bold**
    /(^|\s)\*[^*]+\*/.test(text) || // *italic*
    /\[[^\]]+\]\([^)]+\)/.test(text) || // [link](url)
    /(^|\n)\s*[-*]\s+/.test(text) || // - item / * item
    /(^|\n)\s*\d+\.\s+/.test(text) || // 1. item
    /(^|\n)#{1,6}\s+/.test(text) || // # heading
    /```/.test(text) // code block
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTextToHtml(text: string): string {
  if (!text.trim()) return "";
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Normaliza pra comparação fuzzy: lowercase + sem acentos.
function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

type ProfileForMention = { id: string; full_name: string };

/**
 * Procura nos profiles um match para `@<termo>` extraído do texto cru. Tenta:
 *   1) `termo` bate com o full_name inteiro (sem acentos, case-insensitive);
 *   2) `termo` bate com primeiro + último nome juntos (ex.: "joão silva");
 *   3) `termo` é prefixo do primeiro nome E não é ambíguo entre profiles.
 * Retorna o profile encontrado ou null.
 */
function findProfileForMention(
  term: string,
  profiles: ProfileForMention[],
): ProfileForMention | null {
  const needle = normalizeForMatch(term.replace(/[._]+/g, " "));
  if (!needle) return null;

  // 1) Match exato (full_name inteiro)
  const exact = profiles.find((p) => normalizeForMatch(p.full_name) === needle);
  if (exact) return exact;

  // 2) Primeiro + último (separados por espaço)
  const firstLast = profiles.find((p) => {
    const parts = normalizeForMatch(p.full_name).split(/\s+/).filter(Boolean);
    if (parts.length < 2) return false;
    const compact = `${parts[0]} ${parts[parts.length - 1]}`;
    return compact === needle;
  });
  if (firstLast) return firstLast;

  // 3) Prefixo do primeiro nome (precisa ser único). Evita confusão entre
  // dois "Carlos" — se houver mais de um, pula pro fallback.
  const prefixMatches = profiles.filter((p) => {
    const first = normalizeForMatch(p.full_name).split(/\s+/)[0] ?? "";
    return first === needle || first.startsWith(needle);
  });
  if (prefixMatches.length === 1) return prefixMatches[0];

  return null;
}

/**
 * Converte texto cru com `@menções` em HTML compatível com o editor (mesmo
 * formato do tiptap mention: `<span class="tng-mention" data-type="mention"
 * data-id="..." data-label="...">@Nome Completo</span>`).
 *
 * Usado quando a captura vira comentário: a IA devolve texto cru, mas o user
 * quer que `@joão` vire um chip clicável que dispara notificação. Casos não
 * encontrados ficam como texto literal (`@joão`) — sem chip, sem notificação.
 *
 * Retorna o HTML pronto pro RichTextEditor e a lista de IDs já encontrados,
 * caso o caller queira usar de atalho. (A fonte oficial continua sendo
 * `extractMentionIdsFromHtml` chamada no submit.)
 */
export function convertPlainTextMentions(
  text: string,
  profiles: ProfileForMention[],
): { html: string; mentionIds: string[] } {
  if (!text.trim()) return { html: "", mentionIds: [] };

  // Pra cada parágrafo, escapa o texto bruto primeiro e depois substitui as
  // sequências `@nome` por chips já em HTML (que sobrevivem ao escape).
  const ids = new Set<string>();
  // Aceita @nome.sobrenome, @nome_sobrenome ou @nome (caracteres latinos +
  // dígitos). Stop em espaço, pontuação ou fim de string. Não captura emails
  // (precedido por palavra) graças ao lookbehind \B.
  const re = /(^|\s|>)@([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9._]*)/g;

  const paragraphs = text.split(/\n{2,}/).map((para) => {
    const escaped = escapeHtml(para).replace(/\n/g, "<br>");
    const replaced = escaped.replace(re, (_match, lead, term) => {
      const profile = findProfileForMention(term, profiles);
      if (!profile) return `${lead}@${term}`;
      ids.add(profile.id);
      const labelAttr = escapeHtml(profile.full_name);
      return `${lead}<span class="tng-mention" data-type="mention" data-id="${profile.id}" data-label="${labelAttr}">@${labelAttr}</span>`;
    });
    return `<p>${replaced}</p>`;
  });

  return { html: paragraphs.join(""), mentionIds: Array.from(ids) };
}

/**
 * Converte conteúdo legacy (markdown OU texto puro) em HTML pronto pra
 * carregar no editor / renderizar. Idempotente: se já vier como HTML, devolve
 * sanitizado.
 */
export function legacyToHtml(content: string): string {
  if (!content) return "";

  // Já é HTML — devolve sanitizado direto.
  if (/<\w+[\s>]/.test(content)) {
    return sanitizeHtml(content);
  }

  if (looksLikeMarkdown(content)) {
    const html = marked.parse(content, { async: false }) as string;
    return sanitizeHtml(html);
  }

  return sanitizeHtml(plainTextToHtml(content));
}

/**
 * Devolve só o texto visível do HTML, sem tags. Usado em previews de card
 * (título-fallback, busca, etc.) — não para renderização final.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  // Substitui blocos comuns por espaço/quebra antes de stripar tags pra evitar
  // colar palavras de parágrafos vizinhos.
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Considera "vazio" o HTML sem conteúdo significativo — usado por placeholder
 * e botão de envio de comentário.
 */
export function isHtmlEmpty(html: string): boolean {
  if (!html) return true;
  const stripped = html
    .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return stripped.length === 0;
}
