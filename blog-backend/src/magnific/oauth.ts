/**
 * oauth.ts — OAuthClientProvider custom pro SDK MCP + fluxo de callback local.
 *
 * O Magnific hospeda o servidor OAuth em https://mcp.magnific.com e exige que
 * o cliente registre callback em `http://localhost:8765/callback`. Essa porta
 * é HARDCODED do lado deles — não pode mudar. Se algo estiver segurando a
 * 8765 na máquina do operador, o fluxo falha com mensagem clara.
 *
 * O SDK MCP expõe `OAuthClientProvider` como uma interface (TypeScript puro,
 * nada de classe base) — cabe a nós implementar cada método. Este arquivo
 * também traz o dispatcher do redirect (abre o browser via `open`/`start`/
 * `xdg-open`) e o coletor do `code` + `state` do callback.
 *
 * Diferença vs Python: o Python usa `webbrowser` (stdlib) e um HTTPServer
 * bloqueante em thread separada; nós usamos `Bun.serve` (assíncrono) e
 * `Bun.spawn` pra abrir o browser. Comportamento externo é idêntico.
 */

import { platform } from "node:os";
import { Subprocess } from "bun";
import type {
  OAuthClientMetadata,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

import { FileTokenStorage } from "./tokenStorage.js";

/** Porta da callback — hardcoded no cadastro do app no Magnific. */
export const CALLBACK_PORT = 8765;
/** URI de redirect completa (deve casar 1:1 com o registro DCR). */
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
/** Timeout p/ o operador concluir o login no navegador. */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Erros de OAuth que a camada superior pode inspecionar por tipo. */
export class OAuthTimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "OAuthTimeoutError";
  }
}

export class CallbackPortInUseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CallbackPortInUseError";
  }
}

/**
 * Abre o navegador do sistema na URL passada. Cross-platform:
 * macOS → `open`, Windows → `cmd /c start`, Linux → `xdg-open`.
 * Não bloqueia — a chamada volta assim que o comando é despachado.
 */
export async function openBrowser(url: string): Promise<void> {
  const so = platform();
  let cmd: string[];
  if (so === "darwin") {
    cmd = ["open", url];
  } else if (so === "win32") {
    // cmd.exe: `start ""` pra tratar o 1º argumento como título (URL vai como 2º).
    cmd = ["cmd", "/c", "start", "", url];
  } else {
    cmd = ["xdg-open", url];
  }
  try {
    const proc: Subprocess = Bun.spawn({
      cmd,
      stdout: "ignore",
      stderr: "ignore",
    });
    // Desanexamos — quem chamou não precisa esperar o processo do browser sumir.
    proc.unref();
  } catch (err) {
    console.warn(
      `[magnific] Falhei ao abrir o navegador (${cmd.join(" ")}): ${(err as Error).message}. ` +
        `Cole esta URL manualmente no browser: ${url}`,
    );
  }
}

/** Handle retornado por `esperarCallback` — permite cancelar o server antes do timeout. */
export interface CallbackHandle {
  /** Promise que resolve com o `code` + `state` recebidos do Magnific. */
  readonly promise: Promise<{ code: string; state: string | null }>;
  /** Encerra o server + timer antecipadamente (usar em error paths). */
  readonly cancel: () => void;
}

/**
 * Coleta o `code` + `state` do callback OAuth. O server sobe SÍNCRONO
 * (ao retornar, já está bindado em 127.0.0.1:8765) — quem chamar pode
 * abrir o browser em seguida sem risco de race. O caller recebe o
 * `handle` e aguarda `handle.promise` no ponto certo. Se algo antes do
 * callback falhar (ex.: `client.connect()` explodiu por erro de rede),
 * chame `handle.cancel()` pra derrubar o server.
 */
export function esperarCallback(
  timeoutMs = LOGIN_TIMEOUT_MS,
): CallbackHandle {
  let servidor: ReturnType<typeof Bun.serve> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finalizado = false;

  let resolveFn!: (v: { code: string; state: string | null }) => void;
  let rejectFn!: (err: unknown) => void;
  const promise = new Promise<{ code: string; state: string | null }>(
    (resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    },
  );

  const encerrar = (): void => {
    if (finalizado) return;
    finalizado = true;
    if (timer) clearTimeout(timer);
    // queueMicrotask garante que a última Response HTML sai antes do socket cair.
    queueMicrotask(() => servidor?.stop(true));
  };

  try {
    servidor = Bun.serve({
      port: CALLBACK_PORT,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Não encontrado.", { status: 404 });
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code) {
          const erro = url.searchParams.get("error") ?? "desconhecido";
          const desc =
            url.searchParams.get("error_description") ?? "sem descrição adicional";
          rejectFn(
            new Error(
              `O Magnific não devolveu um código de autorização (erro: ${erro} — ${desc}).`,
            ),
          );
          encerrar();
          return new Response(
            `<h2>Erro no login: ${erro}</h2><p>${desc}</p>`,
            { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
        resolveFn({ code, state });
        encerrar();
        return new Response(
          "<h2>Magnific conectado! Pode fechar esta aba e voltar ao TNG Blog.</h2>",
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      },
      error(err) {
        console.error(`[magnific] Erro no callback HTTP: ${err.message}`);
        return new Response("Erro interno.", { status: 500 });
      },
    });
    timer = setTimeout(() => {
      rejectFn(
        new OAuthTimeoutError(
          "O login no Magnific não foi concluído no tempo esperado (5 min). Tente conectar novamente.",
        ),
      );
      encerrar();
    }, timeoutMs);
  } catch (err) {
    const msg = (err as Error).message;
    if (/EADDRINUSE|address already in use/i.test(msg)) {
      rejectFn(
        new CallbackPortInUseError(
          `A porta ${CALLBACK_PORT} está ocupada. Feche qualquer app que possa estar usando essa porta e tente novamente.`,
        ),
      );
    } else {
      rejectFn(err);
    }
    finalizado = true;
  }

  return { promise, cancel: encerrar };
}

/**
 * Implementação do OAuthClientProvider do SDK MCP.
 *
 * O SDK chama estes métodos ao longo do fluxo:
 *
 *  1. `clientMetadata` → passado ao servidor no Dynamic Client Registration (DCR).
 *  2. `clientInformation()` → devolve credenciais já registradas (cache).
 *  3. `saveClientInformation()` → chamado após DCR bem-sucedido.
 *  4. `tokens()` / `saveTokens()` → cache do par access/refresh.
 *  5. `codeVerifier()` / `saveCodeVerifier()` → PKCE persistente entre
 *     o redirect (nova aba do browser) e a chegada do callback.
 *  6. `redirectToAuthorization(url)` → abre o browser na URL de autorização.
 *
 * A troca do `code` por token é orquestrada pelo transporte MCP:
 *   `await transport.finishAuth(code)`
 * chamado pelo `MagnificClient` depois que `esperarCallback` resolve.
 */
export class MagnificOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl = REDIRECT_URI;
  readonly clientMetadata: OAuthClientMetadata;

  constructor(private readonly storage: FileTokenStorage) {
    this.clientMetadata = {
      client_name: "TNG Blog (sidecar TypeScript)",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return this.storage.getClientInfo();
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    // O SDK chama isso após DCR — sempre teremos os campos "Full" mas
    // aceitamos o tipo Mixed pra bater com a assinatura da interface.
    await this.storage.setClientInfo(
      clientInformation as OAuthClientInformationFull,
    );
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.storage.getTokens();
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.storage.setTokens(tokens);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.storage.setCodeVerifier(codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const v = await this.storage.getCodeVerifier();
    if (!v) {
      throw new Error(
        "PKCE code_verifier não encontrado no storage — o fluxo OAuth precisa reiniciar.",
      );
    }
    return v;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Log seguro — só o hostname + path, nunca a query completa (contém state e
    // client_id que, embora não sejam secretos, poluem o log).
    console.log(
      `[magnific] Abrindo o navegador para ${authorizationUrl.origin}${authorizationUrl.pathname} …`,
    );
    await openBrowser(authorizationUrl.toString());
  }

  /** Escopo `tokens` limpa só o par access/refresh (mantém cliente DCR). */
  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all") {
      await this.storage.clear();
      return;
    }
    const atual = (await this.storage.load()) ?? {};
    if (scope === "tokens") atual.tokens = undefined;
    if (scope === "client") atual.client_info = undefined;
    if (scope === "verifier") atual.code_verifier = undefined;
    // 'discovery' — não armazenamos discovery state por enquanto (o SDK
    // vai refazer o RFC 9728 na próxima conexão, custo baixo).
    await this.storage.save(atual);
  }
}
