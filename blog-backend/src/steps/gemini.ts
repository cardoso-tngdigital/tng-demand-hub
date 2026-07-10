/**
 * steps/gemini.ts — Etapa 3: geração de texto + SEO com o Gemini.
 *
 * Porte fiel de `app/steps/gemini.py`. Recebe keyword + links internos reais e
 * devolve um artigo estruturado (título, RankMath, meta, slug, HTML e prompts
 * de imagem). Usa saída JSON estruturada (`responseMimeType: application/json`)
 * do SDK oficial `@google/genai`, com:
 *   - retry (3×) em erros transitórios (503/429/RESOURCE_EXHAUSTED/UNAVAILABLE);
 *   - modelo de reserva (`gemini-2.5-flash-lite`) na última tentativa;
 *   - validação dos campos obrigatórios com erro em pt-BR;
 *   - slug normalizado deterministicamente (não confiamos no modelo).
 */

import { GoogleGenAI } from "@google/genai";
import type { LinkInterno } from "./links";

/** Consumo do Gemini reportado no `usageMetadata` — pra gravar em blog.ai_usage. */
export interface GeminiUsage {
  readonly modelo: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
}

/** Saída estruturada esperada do Gemini (PRD §9.2). */
export interface ArtigoGerado {
  /** Headline do post — até 100 chars, corte em borda de palavra. */
  readonly title: string;
  /** Título SEO longo do RankMath — até 300 chars, corte em borda de palavra. */
  readonly rank_math_title: string;
  /** Description SEO longa do RankMath — até 300 chars, corte em borda de palavra. */
  readonly meta_description: string;
  /** Slug normalizado (lowercase, sem acento, hifenizado). */
  readonly slug: string;
  /** Corpo em HTML com links internos e headings. */
  readonly content_html: string;
  /** Focus keyword — mesma keyword usada como input. */
  readonly focus_keyword: string;
  /** 3 prompts pra Magnific: 1 destacada + 2 de corpo. */
  readonly imagens_prompts: readonly string[];
  /** Consumo reportado pelo SDK — opcional (SDK pode não devolver em raras versões). */
  readonly usage?: GeminiUsage;
}

/** Input aceito por `gerarArtigo`. */
export interface GerarArtigoInput {
  readonly apiKey: string;
  readonly modelo?: string;
  readonly keyword: string;
  readonly siteUrl: string;
  readonly linksInternos: readonly LinkInterno[];
  readonly promptTemplate: string;
}

/** Modelo padrão + reserva (mesmos do Python). */
const MODELO_PADRAO = "gemini-2.5-flash";
const MODELO_RESERVA = "gemini-2.5-flash-lite";

/** Sinais de erro temporário/sobrecarga/cota — reproduz o `_TRANSITORIOS` do Python. */
const SINAIS_TRANSITORIOS: readonly string[] = [
  "503",
  "UNAVAILABLE",
  "overloaded",
  "500",
  "RESOURCE_EXHAUSTED",
  "429",
];

/** Tentativas por modelo (3× conforme o Python). */
const TENTATIVAS = 3;
/** Espera entre tentativas — 5s como no Python. */
const ESPERA_MS = 5_000;

/** Campos essenciais que, se faltarem, invalidam o artigo. */
const CAMPOS_OBRIGATORIOS: readonly (keyof ArtigoGerado)[] = [
  "title",
  "meta_description",
  "slug",
  "content_html",
];

/** Limites de corte — batem com o Python. */
const LIMITE_TITULO = 100;
const LIMITE_RANKMATH = 300;

/** Log sem vazar chave nem prompt inteiro. */
function logSeguro(mensagem: string, extra?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(`[gemini] ${mensagem}`, extra ?? "");
}

/**
 * Normaliza um texto em slug amigável ao WordPress:
 *  - NFD + strip de acentos
 *  - lowercase
 *  - `[^a-z0-9]+` → `-`
 *  - trim de `-` e limite de 80 chars.
 *
 * Exportada como `_normalizarSlug` para testes.
 */
export function _normalizarSlug(texto: string): string {
  const nfd = String(texto).normalize("NFD");
  // Remove diacríticos (Unicode combining marks, U+0300–U+036F) — mesmo efeito
  // do `encode("ascii", "ignore")` do Python sobre string em NFD.
  const semAcento = nfd.replace(/[̀-ͯ]/g, "");
  const minusculo = semAcento.toLowerCase();
  const hifens = minusculo.replace(/[^a-z0-9]+/g, "-");
  const colapsado = hifens.replace(/-{2,}/g, "-");
  const aparado = colapsado.replace(/^-+|-+$/g, "");
  return aparado.slice(0, 80);
}

/**
 * Corta o texto em `limite` chars sem partir palavra: se o caractere na
 * posição `limite` não for whitespace, recua até o último espaço; se não
 * houver espaço nenhum (uma palavra só), aplica corte cru no limite.
 *
 * Exportada como `_limitarBordaPalavra` para testes.
 */
export function _limitarBordaPalavra(texto: string, limite: number): string {
  const t = String(texto).trim();
  if (t.length <= limite) return t;
  let cortado = t.slice(0, limite);
  const proximo = t.charAt(limite);
  // Se o próximo char *é* whitespace, o corte já caiu numa borda — mantém.
  if (proximo.length > 0 && !/\s/.test(proximo)) {
    const posEspaco = cortado.lastIndexOf(" ");
    if (posEspaco > 0) {
      cortado = cortado.slice(0, posEspaco);
    }
    // Se não achou espaço, cai fora e mantém o corte cru (`cortado` no limite).
  }
  // Remove pontuação/espaços residuais no final — bate com o `.rstrip` do Python.
  return cortado.replace(/[\s\-–—:,;.]+$/g, "").trim();
}

/** Monta o prompt preenchendo os placeholders do template. */
function montarPrompt(
  base: string,
  keyword: string,
  siteUrl: string,
  linksInternos: readonly LinkInterno[],
): string {
  const blocoLinks =
    linksInternos.length > 0
      ? linksInternos.map((l) => `- ${l.url}`).join("\n")
      : "(nenhum link interno disponível — não invente nenhuma URL)";
  return base
    .replaceAll("{keyword}", keyword)
    .replaceAll("{site_url}", siteUrl || "")
    .replaceAll("{links_internos}", blocoLinks);
}

/** True se a mensagem de erro sugere problema transitório (a repetir). */
function ehTransitorio(msg: string): boolean {
  return SINAIS_TRANSITORIOS.some((sinal) => msg.includes(sinal));
}

/** Traduz erros da API do Gemini em orientações claras. Mesma tabela do Python. */
function mensagemAmigavel(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("api_key_invalid") || m.includes("api key not valid") || m.includes("invalid api key")) {
    return "A chave do Gemini parece inválida. Confira e salve novamente em Configurações.";
  }
  if (m.includes("permission_denied") || m.includes("permission")) {
    return "A chave do Gemini não tem permissão para este modelo. Verifique a conta no Google AI Studio.";
  }
  if (m.includes("resource_exhausted") || m.includes("429") || m.includes("quota")) {
    return (
      "Limite de uso do Gemini atingido (cota). Se estiver usando a chave gratuita, " +
      "ative o faturamento no Google AI Studio para gerar em volume."
    );
  }
  if (m.includes("503") || m.includes("unavailable") || m.includes("overloaded") || m.includes("500")) {
    return "O Gemini está sobrecarregado no momento. Aguarde alguns instantes e gere novamente.";
  }
  return `Não foi possível gerar o texto com o Gemini. Detalhe técnico: ${msg.slice(0, 200)}`;
}

/** Sleep sem depender de Bun. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa a chamada ao Gemini com retry + fallback pro modelo reserva.
 * Retorna o texto bruto — o parse fica em `parseEValidar`.
 */
async function gerarComResiliencia(
  cliente: GoogleGenAI,
  modelos: readonly string[],
  prompt: string,
): Promise<{ texto: string; usage: GeminiUsage }> {
  let ultimoErro = "erro desconhecido";
  for (const modelo of modelos) {
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      try {
        const resp = await cliente.models.generateContent({
          model: modelo,
          contents: prompt,
          config: { responseMimeType: "application/json" },
        });
        const texto = resp.text;
        if (typeof texto === "string" && texto.length > 0) {
          // Tokens: `usageMetadata` do SDK. Nomes podem variar entre versões;
          // aceitamos ambos os padrões e caímos em 0 se ausente.
          const meta = (resp as unknown as {
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          }).usageMetadata ?? {};
          const usage: GeminiUsage = {
            modelo,
            input_tokens: meta.promptTokenCount ?? 0,
            output_tokens: meta.candidatesTokenCount ?? 0,
          };
          logSeguro(
            `modelo=${modelo} tentativa=${tentativa} tokens_in=${usage.input_tokens} tokens_out=${usage.output_tokens}`,
          );
          return { texto, usage };
        }
        ultimoErro = "o modelo devolveu uma resposta vazia";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ultimoErro = msg;
        if (!ehTransitorio(msg)) {
          // Erro definitivo (chave inválida etc.) — não insiste.
          throw new Error(mensagemAmigavel(msg), {
            cause: err instanceof Error ? err : undefined,
          });
        }
        if (tentativa < TENTATIVAS) {
          logSeguro(`transitório em ${modelo} tentativa=${tentativa}, aguardando ${ESPERA_MS}ms`);
          await sleep(ESPERA_MS);
          continue;
        }
        // Esgotou tentativas neste modelo — vai pro próximo (reserva).
        break;
      }
    }
  }
  throw new Error(mensagemAmigavel(ultimoErro));
}

/**
 * Se o objeto de topo tem uma única chave (ou uma chave "wrapper" conhecida
 * como `artigo`/`output`/`response`/etc.) que contém um objeto com os campos
 * esperados, devolve esse objeto interno. Senão devolve o próprio `obj`.
 * Cobre o caso do Gemini responder `{"artigo": {"title": "..."}}` quando
 * o prompt pede direto no top level.
 */
function _talvezDesembrulhar(
  obj: Record<string, unknown>,
  wrappers: readonly string[],
): Record<string, unknown> {
  // Se algum wrapper conhecido aponta pra um objeto, prefere ele.
  for (const chave of wrappers) {
    const v = obj[chave];
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v as Record<string, unknown>).length > 0
    ) {
      return v as Record<string, unknown>;
    }
  }
  // Se topo só tem uma chave e ela aponta pra objeto, desembrulha.
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const v = obj[keys[0]!];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  return obj;
}

/** Interpreta e valida a resposta JSON, aplicando limites + slug determinístico. */
function parseEValidar(texto: string, keyword: string): ArtigoGerado {
  let bruto = (texto ?? "").trim();
  // Remove cercas de código markdown (às vezes o modelo escapa em ```json…```).
  if (bruto.startsWith("```")) {
    bruto = bruto.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  if (bruto.length === 0) {
    logSeguro("Resposta do Gemini veio vazia após trim.");
    throw new Error(
      "O Gemini devolveu resposta vazia. Tente gerar novamente.",
    );
  }

  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch (err) {
    logSeguro(
      `JSON.parse falhou. Primeiros 500 chars da resposta: ${bruto.slice(0, 500)}`,
    );
    throw new Error(
      "O Gemini não retornou um texto no formato esperado. Tente gerar novamente.",
      { cause: err instanceof Error ? err : undefined },
    );
  }
  if (dados === null || typeof dados !== "object" || Array.isArray(dados)) {
    const tipoReal = Array.isArray(dados) ? "array" : dados === null ? "null" : typeof dados;
    logSeguro(
      `Resposta parseou como não-objeto (tipo=${tipoReal}). Primeiros 500 chars: ${bruto.slice(0, 500)}`,
    );
    throw new Error(
      `A resposta do Gemini veio em um formato inesperado (recebido: ${tipoReal}, esperado: objeto JSON). Tente de novo.`,
    );
  }
  const obj = dados as Record<string, unknown>;

  // Alguns runs o Gemini aninha a saída dentro de uma chave-invólucro
  // (ex.: `{"artigo": {...}}` ou `{"response": {...}}` ou `{"output": {...}}`).
  // Se detectarmos essa forma, "desembrulhamos" antes de validar.
  const chavesPossiveisWrapper = ["artigo", "article", "output", "response", "resultado", "data"];
  const obj2 = _talvezDesembrulhar(obj, chavesPossiveisWrapper);

  // Checagem dos campos essenciais.
  const faltando: string[] = [];
  for (const campo of CAMPOS_OBRIGATORIOS) {
    const valor = obj2[campo];
    if (typeof valor !== "string" || valor.trim().length === 0) faltando.push(campo);
  }
  if (faltando.length > 0) {
    const keys = Object.keys(obj2).join(", ") || "(vazio)";
    logSeguro(
      `Campos obrigatórios ausentes: ${faltando.join(", ")}. ` +
        `Keys presentes no objeto: ${keys}. Amostra dos primeiros 500 chars: ${bruto.slice(0, 500)}`,
    );
    throw new Error(
      `O texto gerado veio incompleto (faltou: ${faltando.join(", ")}). ` +
        `Chaves recebidas: ${keys.slice(0, 200)}. Tente gerar novamente.`,
    );
  }

  const titleRaw = String(obj2["title"]).trim();
  const metaRaw = String(obj2["meta_description"]).trim();
  const contentRaw = String(obj2["content_html"]).trim();
  const slugRaw = typeof obj2["slug"] === "string" ? obj2["slug"] : "";
  const rankMathRaw =
    typeof obj2["rank_math_title"] === "string" && obj2["rank_math_title"].trim().length > 0
      ? String(obj2["rank_math_title"]).trim()
      : titleRaw;

  // Extrai imagens_prompts, se vier. Aceita array de strings; ignora resto.
  const promptsRaw = obj2["imagens_prompts"];
  const imagens_prompts: string[] = [];
  if (Array.isArray(promptsRaw)) {
    for (const p of promptsRaw) {
      if (typeof p === "string" && p.trim().length > 0) imagens_prompts.push(p.trim());
    }
  }

  const slug =
    _normalizarSlug(slugRaw && slugRaw.trim().length > 0 ? slugRaw : titleRaw) ||
    _normalizarSlug(keyword);

  return {
    title: _limitarBordaPalavra(titleRaw, LIMITE_TITULO),
    rank_math_title: _limitarBordaPalavra(rankMathRaw, LIMITE_RANKMATH),
    meta_description: _limitarBordaPalavra(metaRaw, LIMITE_RANKMATH),
    slug,
    content_html: contentRaw,
    focus_keyword: keyword.trim(),
    imagens_prompts,
  };
}

/**
 * Ponto de entrada: chama o Gemini com prompt montado e devolve o artigo
 * estruturado, aplicando validação e normalização.
 */
export async function gerarArtigo(input: GerarArtigoInput): Promise<ArtigoGerado> {
  const chave = input.apiKey?.trim();
  if (!chave) {
    throw new Error(
      "A chave do Gemini não está configurada. Vá em Configurações e salve a chave da API.",
    );
  }
  const modeloPrincipal = input.modelo?.trim() || MODELO_PADRAO;
  const modelos: string[] = [modeloPrincipal];
  if (MODELO_RESERVA !== modeloPrincipal) modelos.push(MODELO_RESERVA);

  const prompt = montarPrompt(
    input.promptTemplate,
    input.keyword,
    input.siteUrl,
    input.linksInternos,
  );

  // Loga só o começo do prompt e nunca a chave.
  logSeguro(
    `iniciando geração (keyword="${input.keyword.slice(0, 60)}", prompt_head="${prompt.slice(0, 100)}...")`,
  );

  const cliente = new GoogleGenAI({ apiKey: chave });
  const { texto, usage } = await gerarComResiliencia(cliente, modelos, prompt);
  const artigo = parseEValidar(texto, input.keyword);
  return { ...artigo, usage };
}
