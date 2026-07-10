/**
 * steps/docx.ts — geração do .docx do artigo pra aprovação do cliente.
 *
 * Porte de `app/documento.py`. Converte o HTML do artigo em um documento Word
 * simples e legível (títulos, parágrafos, listas, negrito/itálico, links).
 * `<figure>` é ignorado — o docx é pra revisão do texto; imagens só entram
 * na publicação no WP.
 */

import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from "docx";

/** Formatação inline acumulada ao percorrer a árvore. */
interface Formatacao {
  bold: boolean;
  italics: boolean;
  href?: string;
}

/** Nodo simplificado do parser de HTML — só tag, texto ou break. */
type Node =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "elem"; readonly tag: string; readonly attrs: Record<string, string>; readonly children: Node[] };

/**
 * Parser minimalista de HTML → árvore de nodes. Não valida XML strict,
 * tolera tags soltas e ignora atributos malformados. Suficiente pro output
 * bem-comportado do Gemini.
 */
function parseHtml(html: string): Node[] {
  const raiz: Node[] = [];
  const pilha: Array<{ tag: string; children: Node[]; attrs: Record<string, string> }> = [];
  const empurrar = (n: Node): void => {
    if (pilha.length === 0) raiz.push(n);
    else {
      const topo = pilha[pilha.length - 1];
      if (topo) topo.children.push(n);
    }
  };

  const regex = /<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const tok = m[0];
    if (tok.startsWith("<")) {
      const fecha = tok.startsWith("</");
      const autoFecha = tok.endsWith("/>");
      // Extrai a tag: primeira sequência de letras após "</" ou "<".
      const tagMatch = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(tok);
      if (!tagMatch) continue;
      const tag = (tagMatch[1] ?? "").toLowerCase();
      if (fecha) {
        // fecha o último aberto com essa tag
        for (let i = pilha.length - 1; i >= 0; i--) {
          if (pilha[i]?.tag === tag) {
            pilha.splice(i, 1);
            break;
          }
        }
        continue;
      }
      const attrs: Record<string, string> = {};
      const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      // Pula o nome da tag no matching.
      attrRegex.lastIndex = tok.indexOf(tag) + tag.length;
      let am: RegExpExecArray | null;
      while ((am = attrRegex.exec(tok)) !== null) {
        const nome = (am[1] ?? "").toLowerCase();
        const valor = am[2] ?? am[3] ?? am[4] ?? "";
        if (nome.length > 0 && nome !== tag) attrs[nome] = valor;
      }
      if (tag === "br") {
        empurrar({ type: "elem", tag: "br", attrs, children: [] });
        continue;
      }
      const nodo: Node = { type: "elem", tag, attrs, children: [] };
      empurrar(nodo);
      if (!autoFecha && !VOID_TAGS.has(tag)) {
        // Guarda referência mutável ao array de filhos.
        pilha.push({ tag, attrs, children: (nodo as { children: Node[] }).children });
      }
    } else {
      // Decode básico de entidades comuns.
      const texto = tok
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      if (texto.length > 0) empurrar({ type: "text", value: texto });
    }
  }
  return raiz;
}

/** Void elements HTML — nunca abrem contexto. */
const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

/** Constrói os `TextRun` / `ExternalHyperlink` de uma sequência inline. */
function construirRuns(nodes: readonly Node[], fmt: Formatacao): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  const empurrarTexto = (t: string): void => {
    if (t.length === 0) return;
    const run = new TextRun({ text: t, bold: fmt.bold, italics: fmt.italics });
    if (fmt.href !== undefined) {
      runs.push(new ExternalHyperlink({ link: fmt.href, children: [run] }));
    } else {
      runs.push(run);
    }
  };

  for (const n of nodes) {
    if (n.type === "text") {
      empurrarTexto(n.value);
      continue;
    }
    const tag = n.tag;
    if (tag === "br") {
      const run = new TextRun({ text: "", bold: fmt.bold, italics: fmt.italics, break: 1 });
      runs.push(run);
      continue;
    }
    if (tag === "strong" || tag === "b") {
      runs.push(...construirRuns(n.children, { ...fmt, bold: true }));
      continue;
    }
    if (tag === "em" || tag === "i") {
      runs.push(...construirRuns(n.children, { ...fmt, italics: true }));
      continue;
    }
    if (tag === "a") {
      const href = n.attrs["href"];
      runs.push(
        ...construirRuns(n.children, {
          ...fmt,
          ...(href !== undefined && href.length > 0 && { href }),
        }),
      );
      continue;
    }
    // Ignora <figure>, <img> e outros elementos não-textuais.
    if (tag === "figure" || tag === "img" || tag === "figcaption") continue;
    // Qualquer outra tag inline (span, code, etc.) — herda formatação.
    runs.push(...construirRuns(n.children, fmt));
  }
  return runs;
}

/** Traduz uma tag de bloco em `heading` do docx. */
function nivelHeading(tag: string): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  switch (tag) {
    case "h1":
      return HeadingLevel.HEADING_1;
    case "h2":
      return HeadingLevel.HEADING_2;
    case "h3":
      return HeadingLevel.HEADING_3;
    case "h4":
      return HeadingLevel.HEADING_4;
    case "h5":
      return HeadingLevel.HEADING_5;
    case "h6":
      return HeadingLevel.HEADING_6;
    default:
      return undefined;
  }
}

/** Constrói parágrafos a partir dos nodes de nível raiz. */
function construirParagrafos(nodes: readonly Node[]): Paragraph[] {
  const paragrafos: Paragraph[] = [];
  const fmtBase: Formatacao = { bold: false, italics: false };

  for (const n of nodes) {
    if (n.type === "text") {
      const texto = n.value.trim();
      if (texto.length === 0) continue;
      paragrafos.push(new Paragraph({ children: [new TextRun({ text: texto })] }));
      continue;
    }
    const tag = n.tag;
    const heading = nivelHeading(tag);
    if (heading !== undefined) {
      const children = construirRuns(n.children, fmtBase);
      if (children.length > 0) {
        paragrafos.push(new Paragraph({ heading, children }));
      }
      continue;
    }
    if (tag === "p") {
      const children = construirRuns(n.children, fmtBase);
      if (children.length > 0) {
        paragrafos.push(new Paragraph({ children }));
      }
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const bullet = tag === "ul";
      for (const li of n.children) {
        if (li.type !== "elem" || li.tag !== "li") continue;
        const children = construirRuns(li.children, fmtBase);
        if (children.length === 0) continue;
        paragrafos.push(
          new Paragraph({
            children,
            ...(bullet
              ? { bullet: { level: 0 } }
              : { numbering: { reference: "numbered", level: 0 } }),
          }),
        );
      }
      continue;
    }
    if (tag === "figure" || tag === "img" || tag === "figcaption") {
      // Ignorado — docx é só do texto.
      continue;
    }
    // Bloco não-mapeado: tenta renderizar filhos como parágrafo simples.
    const children = construirRuns(n.children, fmtBase);
    if (children.length > 0) {
      paragrafos.push(new Paragraph({ children }));
    }
  }
  return paragrafos;
}

/** Payload do `gerarDocxArtigo`. */
export interface GerarDocxInput {
  readonly title: string;
  readonly content_html: string;
}

/**
 * Monta o `.docx` completo (título + corpo do HTML). Devolve os bytes prontos
 * pra streamar por HTTP. Começa com magic-number `PK` (assinatura zip).
 */
export async function gerarDocxArtigo(artigo: GerarDocxInput): Promise<Uint8Array> {
  const nodes = parseHtml(artigo.content_html ?? "");
  const corpo = construirParagrafos(nodes);

  const titulo = (artigo.title ?? "").trim() || "Artigo";
  const paragrafos: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: titulo })],
    }),
    ...corpo,
  ];

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "left",
            },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children: paragrafos }],
  });

  const buffer = await Packer.toBuffer(doc);
  // `Packer.toBuffer` devolve um `Buffer` do Node — convertemos pra `Uint8Array`
  // padrão pra manter o contrato prometido pela função.
  return new Uint8Array(buffer);
}
