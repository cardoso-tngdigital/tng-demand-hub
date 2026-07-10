/**
 * steps/images.ts — Etapa 4 do pipeline: imagens via Magnific.
 *
 * Portada de `app/steps/images.py` (§9.3 do PRD). Estratégia:
 *   1. Pra cada prompt (1 destacada + N corpo): busca no banco primeiro
 *      (`stock_search` + `stock_download`, ≈1 crédito).
 *   2. Se não achar candidato bom, gera com IA (`images_generate` +
 *      `creations_wait`, ≈50 créditos).
 *   3. Otimiza cada imagem com `sharp`: largura ≤ 1200px (sem aumentar) +
 *      WebP quality 85. É a mesma regra do Sprint 11 do app original.
 *   4. Salva na pasta `data/imagens/${jobId}/` só pra log/debug — quem
 *      consome recebe o buffer (`ArrayBuffer`) e pode subir direto pro WP.
 *   5. Limpa a pasta ao fim (sucesso ou falha).
 *
 * Diferença vs Python: retornamos o buffer em vez do path. Isso evita I/O
 * duplicado no `publish.ts` (que hoje faria fetch da URL do WP; agora usa
 * o buffer direto). Também simplifica testes — dá pra assertar bytes sem
 * mock de filesystem.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
// `sharp` é carregado dinamicamente pra sobreviver ao Bun compile — o binário
// standalone não empacota os `.node` nativos do libvips. Em dev funciona normal;
// no binário, se não achar, `_otimizarWebp` retorna a imagem original sem
// otimizar (o WordPress ainda gera thumbnails próprios). Ver Fase 6 (Tauri
// sidecar) que resolve vendoring do sharp junto do binário.
type SharpFactory = (input: Uint8Array) => {
  rotate: () => SharpFactoryChain;
};
interface SharpFactoryChain {
  rotate?: () => SharpFactoryChain;
  resize: (opts: { width: number; withoutEnlargement: boolean }) => SharpFactoryChain;
  webp: (opts: { quality: number }) => SharpFactoryChain;
  toBuffer: () => Promise<Buffer>;
}
let _sharpCache: SharpFactory | null | undefined = undefined;
async function _lazySharp(): Promise<SharpFactory | null> {
  if (_sharpCache !== undefined) return _sharpCache;
  try {
    const mod = (await import("sharp")) as { default: SharpFactory };
    _sharpCache = mod.default;
    return _sharpCache;
  } catch (err) {
    console.warn(
      `[images] sharp indisponível (${(err as Error).message}). ` +
        "Publicando imagens sem otimização — o WordPress gera thumbnails próprios.",
    );
    _sharpCache = null;
    return null;
  }
}

import type { MagnificClient, StockItem } from "../magnific/client.js";

/** Largura máxima da imagem final (nunca aumenta imagens menores). */
const LARGURA_MAX = 1200;
/** Qualidade do WebP (mesmo padrão do Python: 85). */
const WEBP_QUALIDADE = 85;
/** Timeout do download de uma imagem individual. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface ImagemFinal {
  /** Bytes da imagem já otimizada em WebP. */
  buffer: ArrayBuffer;
  /** Nome sugerido pra upload (`img-0001.webp`, `img-0002.webp`, …). */
  filename: string;
  /** Descrição pro atributo `alt` — vindo do título do stock ou do prompt. */
  alt: string;
  /** Legenda opcional. Hoje usamos `undefined`; reservado pra futuro. */
  caption?: string;
}

export interface ObterImagensInput {
  magnific: MagnificClient;
  /** Palavra-chave/tema do artigo — usada para a busca no banco e o prompt da IA. */
  keyword: string;
  /** Quantidade total de imagens desejada. Default 3 (1 destacada + 2 corpo). */
  quantidade?: number;
  jobId: string;
  dataDir: string;
  modeloIA?: string;
}

/**
 * Estratégia igual ao Python (`app/steps/images.py::_obter_async`):
 *   1. Faz UMA busca no banco Magnific com `query=keyword` (não N buscas por prompt);
 *   2. Baixa até `quantidade` itens do resultado;
 *   3. Se sobrar (`faltam = quantidade - baixadas`), gera `faltam` imagens por IA
 *      com um prompt editorial neutro derivado da keyword (sem usar prompts
 *      individuais do Gemini — o Python também ignora eles);
 *   4. Otimiza cada imagem em WebP 1200px (fallback: bytes originais se sharp faltar).
 *
 * Motivo: o TS antigo usava `artigo.imagens_prompts` do Gemini, chamando
 * `stock_search` uma vez por prompt. Isso multiplicava o custo Magnific,
 * quebrava quando o Gemini gerava `imagens_prompts` vazio, e divergia do
 * comportamento validado do Python (que funciona há 3 sprints).
 */
export async function obterImagens(
  input: ObterImagensInput,
): Promise<ImagemFinal[]> {
  const {
    magnific,
    keyword,
    jobId,
    dataDir,
    modeloIA = "imagen-nano-banana",
    quantidade = 3,
  } = input;

  if (quantidade < 1) return [];
  const tema = keyword.trim();
  if (tema.length === 0) return [];

  const pasta = join(dataDir, "imagens", jobId);
  await mkdir(pasta, { recursive: true });

  try {
    // 1. Banco: uma busca só com a keyword (equivale ao `_do_banco` do Python).
    const doBanco = await _buscarNoBanco(magnific, tema, quantidade);
    console.log(`[images] Banco devolveu ${doBanco.length}/${quantidade} imagens.`);

    // 2. IA para completar o que faltou (equivale ao `_por_ia` do Python).
    const faltam = quantidade - doBanco.length;
    const daIA =
      faltam > 0
        ? await _gerarPorIA(magnific, tema, faltam, modeloIA)
        : [];
    console.log(`[images] IA devolveu ${daIA.length}/${faltam} imagens.`);

    const brutas = [...doBanco, ...daIA];
    const finais: ImagemFinal[] = [];
    for (let i = 0; i < brutas.length; i++) {
      const b = brutas[i]!;
      const filename = `img-${String(i + 1).padStart(4, "0")}.webp`;
      const otimizada = await _otimizarWebp(b.buffer);
      await writeFile(join(pasta, filename), otimizada);
      finais.push({
        buffer: _toArrayBuffer(otimizada),
        filename,
        alt: b.alt || tema,
      });
    }

    if (finais.length === 0) {
      throw new Error(
        `Não consegui obter imagens para o tema "${tema}" no Magnific. Tente outro tema ou gere novamente.`,
      );
    }
    return finais;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

interface ImagemBruta {
  buffer: Uint8Array;
  alt: string;
  origem: "banco" | "ia";
}

/**
 * Faz 1 `stock_search` com a keyword e baixa até `quantidade` itens do
 * resultado. Pula itens problemáticos silenciosamente — igual Python.
 */
async function _buscarNoBanco(
  magnific: MagnificClient,
  tema: string,
  quantidade: number,
): Promise<ImagemBruta[]> {
  const perPage = Math.max(quantidade * 3, 10);
  let itens: StockItem[];
  try {
    itens = await magnific.stockSearch(tema, perPage);
  } catch (err) {
    console.warn(
      `[images] stock_search falhou (${(err as Error).message}). Vou direto pra IA.`,
    );
    return [];
  }
  console.log(`[images] stock_search "${tema}" → ${itens.length} candidatos.`);
  const resultado: ImagemBruta[] = [];
  for (const item of itens) {
    if (resultado.length >= quantidade) break;
    if (item.id === undefined || item.id === null) continue;
    const baixada = await _baixarDoBanco(magnific, item, tema);
    if (baixada) resultado.push(baixada);
  }
  return resultado;
}

/**
 * Gera `quantidade` imagens numa única chamada `images_generate` (usando o
 * `count`), aguarda todas ficarem prontas e baixa cada URL. Prompt neutro
 * derivado da keyword — não usa `imagens_prompts` do Gemini (paridade com Python).
 */
async function _gerarPorIA(
  magnific: MagnificClient,
  tema: string,
  quantidade: number,
  modeloIA: string,
): Promise<ImagemBruta[]> {
  const resultado: ImagemBruta[] = [];
  for (let i = 0; i < quantidade; i++) {
    try {
      const { creationId } = await magnific.imagesGenerate(
        _promptImagemIA(tema),
        modeloIA,
      );
      const { url } = await magnific.creationsWait(creationId);
      const bytes = await _baixarUrl(url);
      resultado.push({ buffer: bytes, alt: tema, origem: "ia" });
    } catch (err) {
      console.warn(
        `[images] Geração IA ${i + 1}/${quantidade} falhou: ${(err as Error).message}`,
      );
    }
  }
  return resultado;
}

async function _baixarDoBanco(
  magnific: MagnificClient,
  item: StockItem,
  tema: string,
): Promise<ImagemBruta | null> {
  try {
    const { downloadUrl } = await magnific.stockDownload(item.id);
    const bytes = await _baixarUrl(downloadUrl);
    return {
      buffer: bytes,
      alt: (item.title as string | undefined) ?? tema,
      origem: "banco",
    };
  } catch (err) {
    console.warn(
      `[images] Não consegui baixar item ${item.id} do banco: ${(err as Error).message}`,
    );
    return null;
  }
}

/** GET simples com timeout — usa fetch nativo do Bun. */
async function _baixarUrl(url: string): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    if (!r.ok) {
      throw new Error(`HTTP ${r.status} ao baixar ${url}`);
    }
    return new Uint8Array(await r.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Otimização determinística: reorienta pela EXIF, redimensiona pela largura
 * (nunca aumenta) e converte pra WebP q=85. Exportada pra teste no `sharp`.
 */
export async function _otimizarWebp(bytes: Uint8Array): Promise<Uint8Array> {
  const sharpFn = await _lazySharp();
  if (sharpFn === null) {
    // Fallback: sobe a imagem crua. WP faz thumbnails próprios.
    return bytes;
  }
  const inst = sharpFn(bytes);
  const rotated = inst.rotate !== undefined ? inst.rotate() : (inst as unknown as SharpFactoryChain);
  const out = await rotated
    .resize({ width: LARGURA_MAX, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALIDADE })
    .toBuffer();
  return new Uint8Array(out);
}

/** Prompt neutro de blog editorial — 1:1 com o Python. */
function _promptImagemIA(tema: string): string {
  return (
    `Fotografia editorial profissional para um artigo de blog sobre ${tema}. ` +
    "Imagem realista, iluminação natural suave, composição limpa e moderna, " +
    "sem texto, sem marca d'água, alta qualidade."
  );
}

/** Converte Uint8Array em ArrayBuffer "puro" (fatia o backing). */
function _toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // `u8.buffer` pode compartilhar backing com outras views; slice garante
  // um ArrayBuffer isolado do tamanho exato.
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
