/**
 * client.ts — cliente MCP de alto nível pro Magnific.
 *
 * Encapsula:
 *   • Sessão MCP via `StreamableHTTPClientTransport` (SDK oficial da Anthropic).
 *   • Fluxo OAuth persistente (token em `data/magnific_token.json`; navegador
 *     só abre na 1ª conexão) via `MagnificOAuthProvider`.
 *   • Retry com backoff em erros transitórios (rede, 5xx, timeout).
 *   • Parser das respostas do Magnific — o servidor às vezes prefixa o JSON
 *     com um bloco `<system_reminder>...</system_reminder>` (instruções pro
 *     agente); recortamos antes de tentar interpretar como JSON.
 *   • API alto nível: `accountBalance`, `stockSearch`, `stockDownload`,
 *     `imagesGenerate`, `creationsWait` — matching 1:1 com o Python.
 *
 * Segurança de logs: nunca imprimimos o token completo, só os primeiros 8
 * chars + "…". Prompts caem em texto truncado a 100 chars.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { join } from "node:path";

import { FileTokenStorage } from "./tokenStorage.js";
import {
  MagnificOAuthProvider,
  esperarCallback,
  OAuthTimeoutError,
  CallbackPortInUseError,
  type CallbackHandle,
} from "./oauth.js";

/** Tempo de retry entre tentativas em erros transitórios. */
const RETRY_DELAYS_MS = [1000, 3000];
/** Timeout default do `creations_wait` (imagens IA levam ~30-90s). */
const CREATIONS_WAIT_DEFAULT_MS = 120_000;
/** Máximo de tentativas do polling em `creationsWait`. */
const CREATIONS_WAIT_TENTATIVAS = 8;

/** Descrição minimalista de uma tool retornada pelo `listTools`. */
export interface Tool {
  name: string;
  description?: string;
}

/** Item do banco (`stock_search`) — subset do que usamos. */
export interface StockItem {
  id: string | number;
  title?: string;
  thumbnail?: string;
  [k: string]: unknown;
}

/** Callback opcional pro consumidor reagir ao evento "precisa logar". */
export interface MagnificClientOptions {
  mcpUrl: string;
  dataDir: string;
  onNeedLogin?: () => void;
}

/** Erros específicos do cliente pra chamador tratar com granularidade. */
export class MagnificAuthRequiredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "MagnificAuthRequiredError";
  }
}

export class MagnificToolError extends Error {
  constructor(
    public readonly tool: string,
    msg: string,
  ) {
    super(msg);
    this.name = "MagnificToolError";
  }
}

/**
 * Cliente Magnific. Instanciação é barata (não conecta); a conexão real
 * acontece em `ensureAuth()` ou preguiçosamente na 1ª chamada de tool.
 * Reutilize a mesma instância entre chamadas — o SDK MCP mantém a sessão
 * viva e evita o handshake em toda operação.
 */
export class MagnificClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private storage: FileTokenStorage;
  private provider: MagnificOAuthProvider;
  private conectando: Promise<void> | null = null;

  constructor(private readonly opts: MagnificClientOptions) {
    this.storage = new FileTokenStorage(
      join(opts.dataDir, "magnific_token.json"),
    );
    this.provider = new MagnificOAuthProvider(this.storage);
  }

  /**
   * Garante que existe uma sessão MCP autenticada. Reutiliza conexão em
   * chamadas subsequentes. Se estiver conectando em paralelo, aguarda o
   * mesmo Promise em vez de disparar duas conexões concorrentes.
   */
  async ensureAuth(): Promise<void> {
    if (this.client) return;
    if (this.conectando) return this.conectando;
    this.conectando = this._conectar().finally(() => {
      this.conectando = null;
    });
    return this.conectando;
  }

  /**
   * Fluxo de conexão em dois estágios:
   *
   *   1. Se já existe token em disco, tenta conectar silencioso. Se der certo,
   *      acabou. Se der `UnauthorizedError`, o token está expirado — limpa e
   *      cai no fluxo interativo (sem propagar o erro).
   *   2. Fluxo interativo: sobe o callback server ANTES de disparar
   *      `client.connect()`, porque o SDK chama `redirectToAuthorization`
   *      dentro do connect e o browser pode bater no callback quase instantâneo
   *      — se o server ainda não estivesse ouvindo, o usuário levaria
   *      `ERR_CONNECTION_REFUSED` (bug real observado em 2026-07-03).
   *   3. Espera o `code`, chama `transport.finishAuth(code)` e reconecta.
   */
  private async _conectar(): Promise<void> {
    const url = new URL(this.opts.mcpUrl);

    // ---------- Estágio 1: tentativa silenciosa com token do disco ---------
    const tinhaToken = (await this.storage.getTokens()) !== undefined;
    if (tinhaToken) {
      const clientSilencioso = new Client(
        { name: "tng-blog-backend", version: "0.2.0" },
        { capabilities: {} },
      );
      const transportSilencioso = new StreamableHTTPClientTransport(url, {
        authProvider: this.provider,
      });
      try {
        await clientSilencioso.connect(transportSilencioso);
        this.client = clientSilencioso;
        this.transport = transportSilencioso;
        const preview = await this._previewToken();
        console.log(
          `[magnific] Conectado ao MCP (token existente ${preview}).`,
        );
        return;
      } catch (err) {
        await this._encerrarLimpo(clientSilencioso, transportSilencioso);
        if (!(err instanceof UnauthorizedError)) {
          throw this._traduzirErro(err);
        }
        // Token velho / revogado — limpa e cai no interativo. Mantemos o
        // `client_info` (DCR) porque ele não expira; só tokens + verifier
        // precisam ser refeitos.
        console.log("[magnific] Token existente inválido — refazendo login.");
        await this.provider.invalidateCredentials("tokens");
        await this.provider.invalidateCredentials("verifier");
      }
    }

    // ---------- Estágio 2: fluxo interativo ---------------------------------
    // Avisa a UI ANTES do prompt do browser.
    this.opts.onNeedLogin?.();

    // Sobe o callback server PRIMEIRO. O `esperarCallback` retorna síncrono
    // com o server já bindado — nenhum browser vai bater em porta vazia.
    let callback: CallbackHandle;
    try {
      callback = esperarCallback();
    } catch (err) {
      if (err instanceof CallbackPortInUseError) throw err;
      throw this._traduzirErro(err);
    }

    const client = new Client(
      { name: "tng-blog-backend", version: "0.2.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: this.provider,
    });

    // Agora dispara o connect. O SDK chama `redirectToAuthorization` internamente,
    // abrindo o browser. Como `esperarCallback` já subiu, o callback está
    // garantido a ter alguém escutando quando o Magnific redirecionar.
    try {
      await client.connect(transport);
      // Sucesso inesperado: se conectou sem token, alguma coisa muito estranha
      // — mas se aconteceu, aceitamos e vamos embora.
      callback.cancel();
      this.client = client;
      this.transport = transport;
      return;
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        callback.cancel();
        await this._encerrarLimpo(client, transport);
        throw this._traduzirErro(err);
      }
      // Esperado — o SDK jogou UnauthorizedError e já disparou o redirect.
      // Continua pra aguardar o callback.
    }

    let code: string;
    try {
      ({ code } = await callback.promise);
    } catch (err) {
      await this._encerrarLimpo(client, transport);
      if (err instanceof OAuthTimeoutError || err instanceof CallbackPortInUseError) {
        throw err;
      }
      throw this._traduzirErro(err);
    }

    try {
      await transport.finishAuth(code);
      await client.connect(transport);
      this.client = client;
      this.transport = transport;
      const preview = await this._previewToken();
      console.log(`[magnific] Login concluído (token novo ${preview}).`);
    } catch (err) {
      await this._encerrarLimpo(client, transport);
      throw this._traduzirErro(err);
    }
  }

  /** Devolve os primeiros 8 chars do access_token pra log sem vazar. */
  private async _previewToken(): Promise<string> {
    const t = await this.storage.getTokens();
    const s = t?.access_token ?? "";
    return s.length > 8 ? `${s.slice(0, 8)}…` : "(vazio)";
  }

  private async _encerrarLimpo(
    client: Client,
    transport: StreamableHTTPClientTransport,
  ): Promise<void> {
    try {
      await client.close();
    } catch {
      /* ignorar */
    }
    try {
      await transport.close();
    } catch {
      /* ignorar */
    }
  }

  /**
   * Traduz um erro de rede/MCP em Error pt-BR pro usuário final.
   * Mantém a mensagem original em `.cause` pra o log técnico.
   */
  private _traduzirErro(err: unknown): Error {
    const original = err instanceof Error ? err : new Error(String(err));
    const msg = original.message.toLowerCase();
    let amigavel = "Não consegui conversar com o Magnific.";
    if (/timeout|timed out/.test(msg)) {
      amigavel =
        "O Magnific demorou para responder. Tente novamente em instantes.";
    } else if (/enotfound|econnrefused|network|fetch/.test(msg)) {
      amigavel =
        "Não consegui alcançar o Magnific pela rede. Verifique sua conexão.";
    } else if (/unauthorized|401/.test(msg)) {
      amigavel =
        "A sessão do Magnific expirou. Vá em Configurações e clique em \"Conectar ao Magnific\".";
    }
    const novo = new Error(amigavel);
    (novo as Error & { cause?: unknown }).cause = original;
    return novo;
  }

  /** Encerra a sessão MCP. Idempotente. */
  async close(): Promise<void> {
    if (this.client) {
      await this._encerrarLimpo(this.client, this.transport!);
      this.client = null;
      this.transport = null;
    }
  }

  /* ================== chamadas de baixo nível ============================ */

  /**
   * Chama uma tool MCP com retry em erros transitórios. NÃO retry em
   * erro de autorização — deixa o `_conectar()` cuidar disso na próxima
   * `ensureAuth()`.
   */
  private async _callTool(
    nome: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureAuth();
    let ultimoErro: unknown = null;
    for (let tentativa = 0; tentativa <= RETRY_DELAYS_MS.length; tentativa++) {
      try {
        const res = await this.client!.callTool({
          name: nome,
          arguments: args,
        });
        if ("isError" in res && res.isError) {
          throw new MagnificToolError(
            nome,
            `O Magnific recusou a chamada '${nome}'.`,
          );
        }
        return this._parsearConteudo(res);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          // Token expirou no meio de uma sessão viva — invalida o client
          // pra reconectar na próxima chamada, mas NÃO faz retry aqui.
          await this.close();
          throw new MagnificAuthRequiredError(
            "A sessão do Magnific expirou. Reconecte em Configurações e tente novamente.",
          );
        }
        if (err instanceof MagnificToolError) {
          // Erro semântico da tool não faz sentido tentar de novo.
          throw err;
        }
        ultimoErro = err;
        if (tentativa >= RETRY_DELAYS_MS.length) break;
        const espera = RETRY_DELAYS_MS[tentativa]!;
        console.warn(
          `[magnific] Falha em ${nome} (tent. ${tentativa + 1}). Retry em ${espera}ms. Detalhe: ${(err as Error).message}`,
        );
        await Bun.sleep(espera);
      }
    }
    throw this._traduzirErro(ultimoErro);
  }

  /**
   * Extrai o JSON da resposta MCP. O Magnific pode retornar:
   *   1) Bloco de texto puro contendo JSON válido.
   *   2) Bloco antecedido por `<system_reminder>…</system_reminder>` (instruções
   *      pro agente que precisamos descartar).
   *   3) Bloco com JSON solto em meio a texto — recortamos do `{` ao `}`.
   */
  private _parsearConteudo(res: unknown): unknown {
    const r = res as { content?: Array<{ type: string; text?: string }> };
    const blocos = (r.content ?? [])
      .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
      .filter((s) => s.length > 0);

    // 1. algum bloco isolado já é JSON puro
    for (const t of blocos) {
      const j = this._parseJsonSafe(t.trim());
      if (j !== null) return j;
    }

    // 2. combina, remove <system_reminder>, tenta de novo
    const combinado = blocos.join("\n").trim();
    const limpo = combinado
      .replace(/<system_reminder>[\s\S]*?<\/system_reminder>/g, "")
      .trim();
    const j = this._parseJsonSafe(limpo);
    if (j !== null) return j;

    // 3. último recurso: recorta { … }
    const abre = limpo.indexOf("{");
    const fecha = limpo.lastIndexOf("}");
    if (abre >= 0 && fecha > abre) {
      const jj = this._parseJsonSafe(limpo.slice(abre, fecha + 1));
      if (jj !== null) return jj;
    }

    // 4. sem JSON detectável — devolve texto bruto pra log/debug
    return combinado ? { _texto: combinado } : null;
  }

  private _parseJsonSafe(s: string): unknown {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  /* ================== API alto nível ===================================== */

  async listTools(): Promise<Tool[]> {
    await this.ensureAuth();
    const res = await this.client!.listTools();
    return res.tools.map((t) => ({ name: t.name, description: t.description }));
  }

  async accountBalance(): Promise<{ credits: number; plan: string }> {
    const raw = await this._callTool("account_balance", {});
    const d = (raw ?? {}) as {
      credits?: number;
      subscription_credits?: number;
      plan?: string;
      subscription?: { plan?: string; credits?: number };
    };
    return {
      credits:
        d.credits ??
        d.subscription_credits ??
        d.subscription?.credits ??
        0,
      plan: d.plan ?? d.subscription?.plan ?? "desconhecido",
    };
  }

  async stockSearch(query: string, limit: number): Promise<StockItem[]> {
    const raw = await this._callTool("stock_search", {
      query,
      content_type: "photo",
      per_page: Math.max(limit, 5),
    });
    const d = raw as { items?: StockItem[] } | null;
    const itens = d?.items ?? [];
    return itens.slice(0, limit);
  }

  async stockDownload(
    stockId: string | number,
  ): Promise<{ downloadUrl: string }> {
    const raw = await this._callTool("stock_download", {
      id: stockId,
      type: "photo",
      format: "render",
    });
    const d = raw as { downloadUrl?: string } | null;
    if (!d?.downloadUrl) {
      throw new MagnificToolError(
        "stock_download",
        "O Magnific devolveu a resposta sem 'downloadUrl' para este item.",
      );
    }
    return { downloadUrl: d.downloadUrl };
  }

  async imagesGenerate(
    prompt: string,
    model = "imagen-nano-banana",
  ): Promise<{ creationId: string }> {
    const raw = await this._callTool("images_generate", {
      prompt,
      mode: model,
      aspectRatio: "16:9",
      count: 1,
    });
    const d = raw as { creations?: Array<{ identifier?: string }> } | null;
    const id = d?.creations?.[0]?.identifier;
    if (!id) {
      throw new MagnificToolError(
        "images_generate",
        "O Magnific aceitou o prompt mas não devolveu identificador de criação.",
      );
    }
    return { creationId: id };
  }

  /**
   * Aguarda a criação (`images_generate`, `video_generate`, etc.) ficar pronta
   * e devolve a URL final do asset. Faz polling em janelas de 25s até bater
   * o timeout total ou o `allTerminal`.
   */
  async creationsWait(
    creationId: string,
    timeoutMs = CREATIONS_WAIT_DEFAULT_MS,
  ): Promise<{ url: string }> {
    const deadline = Date.now() + timeoutMs;
    let pendentes = [creationId];
    for (let i = 0; i < CREATIONS_WAIT_TENTATIVAS; i++) {
      if (Date.now() > deadline) break;
      const raw = await this._callTool("creations_wait", {
        identifiers: pendentes,
        timeoutSeconds: 25,
      });
      const resp = raw as {
        results?: Array<{
          status?: string;
          identifier?: string;
          results?: { url?: string };
        }>;
        allTerminal?: boolean;
      } | null;
      const results = resp?.results ?? [];
      const ainda: string[] = [];
      for (const r of results) {
        if (r.status === "completed") {
          const url = r.results?.url;
          if (url) return { url };
        } else if (
          r.status === "failed" ||
          r.status === "error" ||
          r.status === "canceled"
        ) {
          throw new MagnificToolError(
            "creations_wait",
            `A criação ${r.identifier ?? creationId} falhou no Magnific (status ${r.status}).`,
          );
        } else if (r.identifier) {
          ainda.push(r.identifier);
        }
      }
      pendentes = ainda.length > 0 ? ainda : [creationId];
      if (resp?.allTerminal) break;
    }
    throw new MagnificToolError(
      "creations_wait",
      "A criação não ficou pronta no tempo esperado. Tente novamente em instantes.",
    );
  }
}
