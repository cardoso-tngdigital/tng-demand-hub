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
