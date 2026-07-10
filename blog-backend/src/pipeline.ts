/**
 * pipeline.ts — orquestrador determinístico do artigo (Fase 4 / Sprint 24).
 *
 * Roda 5 etapas fixas em ordem (RNF-06: nada pela metade):
 *   1. links     — descobre 2 páginas + 1 post relevantes no WP de destino
 *   2. texto     — Gemini gera título + SEO + HTML + prompts de imagem
 *   3. imagens   — Magnific busca/gera as imagens finais em WebP
 *   4. publicando— WP REST publica/agenda/salva-como-rascunho
 *   5. historico — INSERT em `blog.historico` com os metadados
 *
 * Progresso emitido em cada transição via `onProgresso`. Falha em qualquer
 * etapa interrompe a cadeia, marca `etapa_erro` e devolve pt-BR.
 *
 * Porte de `app/pipeline.py`. Diferença: TypeScript e injeção explícita de
 * dependências (supabase, magnific) em vez de imports globais — isso torna
 * o pipeline testável com fakes sem tocar em rede.
 */

import { env } from "./env";
import { descobrirLinks } from "./steps/links";
import { gerarArtigo, type ArtigoGerado } from "./steps/gemini";
import { obterImagens, type ImagemFinal } from "./steps/images";
import { publicarPost } from "./steps/publish";
import { getPromptParaSite } from "./prompt";
import { getGeminiApiKey, getGeminiModel, getMagnificModeloIA } from "./settings";
import type { MagnificClient } from "./magnific/client";
import type { BlogSupabaseClient } from "./supabase";
import type { WPSite } from "./wordpress";

/** Nomes das etapas — pt-BR, batendo com o `ETAPAS` do Python. */
export const ETAPAS = [
  "iniciando",
  "links",
  "texto",
  "imagens",
  "publicando",
  "historico",
  "concluido",
] as const;

/** Nome da etapa atual do progresso emitido pelo callback.
 *  `na_fila` = job criado mas aguardando a vez na fila serial (pipelineQueue). */
export type NomeEtapa = (typeof ETAPAS)[number] | "falhou" | "na_fila";

/** Evento de progresso emitido em cada transição. */
export interface ProgressoPipeline {
  etapa: NomeEtapa;
  mensagem: string;
  detalhe?: string;
}

/** Resultado final do pipeline. */
export interface ResultadoPipeline {
  status: "concluido" | "rascunho" | "falhou";
  post_id?: number;
  post_url?: string;
  slug?: string;
  historico_id?: string;
  erro?: string;
  etapa_erro?: NomeEtapa;
}

/** Input aceito por `executarPipeline`. */
export interface ExecutarPipelineInput {
  /** Client Supabase com sessão do usuário (RLS) ou service_role (scheduler). */
  supabase: BlogSupabaseClient;
  magnific: MagnificClient;
  siteId: string;
  keyword: string;
  /**
   * Data de publicação. `undefined` → publicar agora. Passado → publica agora.
   * Futuro → agenda no WP com `date_gmt` UTC.
   */
  data?: Date;
  /** `true` → status final é `"rascunho"`. */
  rascunho?: boolean;
  /** Callback opcional pra painel/logs observarem progresso. */
  onProgresso?: (p: ProgressoPipeline) => void;
  /**
   * UUID do usuário que gerou o artigo — grava em `blog.historico.gerado_por`.
   * Se ausente, tentamos ler do `supabase.auth.getUser()` (funciona quando o
   * client tem sessão); com service_role fica `null` no banco.
   */
  geradoPor?: string;
}

/** Formato mínimo de site que o pipeline enxerga (row de `blog.sites`). */
interface SiteRow {
  id: string;
  nome?: string | null;
  url: string;
  token?: string | null;
  prompt?: string | null;
}

/**
 * Ponto de entrada. Sempre resolve (nunca lança) — o resultado carrega o
 * status. Isso deixa o consumidor tratar erro de forma uniforme, sem
 * `try/catch` duplo.
 */
export async function executarPipeline(
  input: ExecutarPipelineInput,
): Promise<ResultadoPipeline> {
  const emit = (etapa: NomeEtapa, mensagem: string, detalhe?: string): void => {
    const p: ProgressoPipeline = detalhe !== undefined
      ? { etapa, mensagem, detalhe }
      : { etapa, mensagem };
    try {
      input.onProgresso?.(p);
    } catch (err) {
      // Callback ruim NÃO derruba o pipeline — só logamos.
      console.warn(
        `[pipeline] onProgresso lançou: ${(err as Error).message}`,
      );
    }
  };

  emit("iniciando", "Preparando execução…");

  // ---- Busca do site (fora das 5 etapas — se falhar aqui, é setup) --------
  let site: SiteRow | null = null;
  try {
    site = await _buscarSite(input.supabase, input.siteId);
  } catch (err) {
    return _fim(emit, "falhou", "iniciando", _mensagemErro(err));
  }
  if (site === null) {
    return _fim(
      emit,
      "falhou",
      "iniciando",
      "Site de destino não encontrado. Verifique a lista de sites.",
    );
  }
  const wpSite: WPSite = {
    id: site.id,
    url: site.url,
    ...(site.token ? { token: site.token } : {}),
  };

  // ---- Etapa 1: links -----------------------------------------------------
  emit("links", "Descobrindo links internos do site…");
  let linksInternos: Awaited<ReturnType<typeof descobrirLinks>>;
  try {
    linksInternos = await descobrirLinks(wpSite, input.keyword);
  } catch (err) {
    return _fim(emit, "falhou", "links", _mensagemErro(err));
  }

  // ---- Etapa 2: texto -----------------------------------------------------
  emit("texto", "Gerando o texto e o SEO com o Gemini…");
  let artigo: ArtigoGerado;
  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      throw new Error(
        "A chave do Gemini não está configurada. Vá em Configurações e salve a chave da API.",
      );
    }
    const modelo = await getGeminiModel();
    const promptTemplate = await getPromptParaSite(site.prompt ?? null);
    artigo = await gerarArtigo({
      apiKey,
      modelo,
      keyword: input.keyword,
      siteUrl: site.url,
      linksInternos,
      promptTemplate,
    });
  } catch (err) {
    return _fim(emit, "falhou", "texto", _mensagemErro(err));
  }

  // ---- Registro de consumo (não bloqueia o pipeline) ---------------------
  // Grava em `blog.ai_usage` de forma best-effort. Falha aqui NÃO derruba
  // o artigo — o rastreio é acessório ao fluxo principal.
  if (artigo.usage !== undefined) {
    void _registrarUso(input.supabase, {
      user_id: await _resolverGeradoPor(input),
      site_id: input.siteId,
      job_id: (input as { jobId?: string }).jobId ?? null,
      modelo: artigo.usage.modelo,
      input_tokens: artigo.usage.input_tokens,
      output_tokens: artigo.usage.output_tokens,
    });
  }

  // ---- Etapa 3: imagens ---------------------------------------------------
  emit("imagens", "Buscando as imagens no Magnific…");
  let imagens: ImagemFinal[];
  try {
    const modeloIA = await getMagnificModeloIA();
    imagens = await obterImagens({
      magnific: input.magnific,
      keyword: input.keyword,
      // Padrão 3 (1 destacada + 2 corpo) — mesmo default do Python.
      quantidade: 3,
      jobId: `job-${crypto.randomUUID().slice(0, 8)}`,
      dataDir: env.DATA_DIR,
      modeloIA,
    });
  } catch (err) {
    return _fim(emit, "falhou", "imagens", _mensagemErro(err));
  }

  // ---- Etapa 4: publicando ------------------------------------------------
  emit("publicando", "Publicando o artigo no WordPress…");
  const rascunho = input.rascunho === true;
  let publicacao: Awaited<ReturnType<typeof publicarPost>>;
  try {
    publicacao = await publicarPost({
      site: wpSite,
      artigo,
      imagens,
      keyword: input.keyword,
      ...(input.data !== undefined && { data: input.data }),
      rascunho,
    });
  } catch (err) {
    return _fim(emit, "falhou", "publicando", _mensagemErro(err));
  }

  // ---- Etapa 5: histórico -------------------------------------------------
  emit("historico", "Registrando no histórico…");
  const statusFinal: "concluido" | "rascunho" = rascunho ? "rascunho" : "concluido";
  let historicoId: string | undefined;
  try {
    historicoId = await _registrarHistorico(input.supabase, {
      site_id: input.siteId,
      keyword: input.keyword,
      title: artigo.title,
      slug: publicacao.slug,
      post_url: publicacao.post_url,
      status: statusFinal,
      data_publicacao: (input.data ?? new Date()).toISOString(),
      imagens: imagens.length,
      links_internos: linksInternos,
      gerado_por: await _resolverGeradoPor(input),
    });
  } catch (err) {
    // O post JÁ foi publicado — não podemos "desfazer". Reportamos como falha
    // parcial: o operador vê a URL do post e o erro do histórico.
    return {
      status: "falhou",
      post_id: publicacao.post_id,
      post_url: publicacao.post_url,
      slug: publicacao.slug,
      erro: `Post publicado, mas não consegui gravar no histórico: ${_mensagemErro(err)}`,
      etapa_erro: "historico",
    };
  }

  emit("concluido", "Artigo publicado com sucesso.");
  const resultado: ResultadoPipeline = {
    status: statusFinal,
    post_id: publicacao.post_id,
    post_url: publicacao.post_url,
    slug: publicacao.slug,
  };
  if (historicoId !== undefined) {
    (resultado as { historico_id?: string }).historico_id = historicoId;
  }
  return resultado;
}

// -------------------------------------------------------------------------
// Helpers privados
// -------------------------------------------------------------------------

/** Consulta `blog.sites` pelo id — devolve null se não achar. */
async function _buscarSite(
  supabase: BlogSupabaseClient,
  siteId: string,
): Promise<SiteRow | null> {
  const { data, error } = await supabase
    .from("sites")
    .select("id, nome, url, token, prompt")
    .eq("id", siteId)
    .maybeSingle();
  if (error !== null) {
    throw new Error(
      `Não foi possível ler o site no Supabase: ${error.message}`,
    );
  }
  return (data as SiteRow | null) ?? null;
}

/** INSERT em `blog.historico` e retorna o id gerado. */
async function _registrarHistorico(
  supabase: BlogSupabaseClient,
  row: {
    site_id: string;
    keyword: string;
    title: string;
    slug: string;
    post_url: string;
    status: "concluido" | "rascunho";
    data_publicacao: string;
    imagens: number;
    links_internos: unknown;
    gerado_por: string | null;
  },
): Promise<string | undefined> {
  // Retry com backoff (3 tentativas: 0s/2s/4s). O INSERT roda depois de
  // MINUTOS de upload de imagens — a conexão HTTP reusada pelo supabase-js
  // pode ter sido fechada pelo servidor nesse meio tempo ("socket connection
  // was closed unexpectedly", visto em produção 2026-07-09). Sem retry, um
  // erro transitório aqui marcava como "falhou" um artigo JÁ publicado.
  let ultimoErro = "";
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    if (tentativa > 1) {
      await new Promise((r) => setTimeout(r, (tentativa - 1) * 2000));
    }
    try {
      const { data, error } = await supabase
        .from("historico")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (error === null) {
        if (data && typeof (data as { id?: unknown }).id === "string") {
          return (data as { id: string }).id;
        }
        return undefined;
      }
      ultimoErro = error.message;
    } catch (err) {
      // fetch do Bun rejeita a Promise em erro de socket — também retentável
      ultimoErro = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(
    `Não foi possível gravar no histórico (3 tentativas): ${ultimoErro}`,
  );
}

/**
 * Descobre o `gerado_por`: primeiro `input.geradoPor`, depois
 * `supabase.auth.getUser()`. Se nada, retorna null (service role no banco
 * aceita null em `gerado_por` — o accountability fica no `criado_por` do
 * agendamento quando vier do scheduler).
 */
async function _resolverGeradoPor(
  input: ExecutarPipelineInput,
): Promise<string | null> {
  if (input.geradoPor) return input.geradoPor;
  try {
    const { data } = await input.supabase.auth.getUser();
    if (data?.user?.id) return data.user.id;
  } catch {
    // service_role sem sessão explode — ignoramos.
  }
  return null;
}

/**
 * INSERT best-effort em `blog.ai_usage`. Erros aqui só viram warn — não
 * lançamos porque o artigo já foi gerado com sucesso.
 */
async function _registrarUso(
  supabase: BlogSupabaseClient,
  row: {
    user_id: string | null;
    site_id: string | null;
    job_id: string | null;
    modelo: string;
    input_tokens: number;
    output_tokens: number;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("ai_usage").insert(row);
    if (error !== null) {
      console.warn(`[pipeline] Não gravei blog.ai_usage: ${error.message}`);
    }
  } catch (err) {
    console.warn(`[pipeline] Erro registrando uso: ${(err as Error).message}`);
  }
}

/** Extrai a mensagem em pt-BR do erro, sem vazar stack técnica. */
function _mensagemErro(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Emite o progresso final e monta o resultado de falha. */
function _fim(
  emit: (etapa: NomeEtapa, mensagem: string, detalhe?: string) => void,
  status: "falhou",
  etapa: NomeEtapa,
  mensagem: string,
): ResultadoPipeline {
  emit("falhou", mensagem, `etapa=${etapa}`);
  return { status, erro: mensagem, etapa_erro: etapa };
}
