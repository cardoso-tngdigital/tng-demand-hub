/**
 * tokenStorage.ts — persistência do token OAuth do Magnific em disco.
 *
 * Formato COMPATÍVEL com o app Python (`app/magnific_client.py::_FileTokenStorage`)
 * — o arquivo é `data/magnific_token.json` com o shape:
 *
 * ```json
 * {
 *   "tokens":       { access_token, token_type, expires_in?, refresh_token?, scope?, id_token? },
 *   "client_info":  { client_id, client_secret?, ... , redirect_uris, grant_types, ... }
 * }
 * ```
 *
 * Preservar o formato permite que operadores que já fizeram login no app Python
 * NÃO precisem logar de novo no sidecar TypeScript. Se o arquivo for inválido
 * (corrompido, faltando `tokens`, JSON quebrado), tratamos como "sem sessão"
 * em vez de lançar — o fluxo de OAuth simplesmente vai abrir o navegador.
 *
 * Escrita atômica: escrevemos em `<path>.tmp` e depois `rename` — se o processo
 * morrer no meio, o arquivo antigo permanece íntegro. Permissão 0600 nos Unix
 * (dono lê/escreve) — no Windows a ACL default do usuário já é privada.
 */

import { chmod, mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { dirname } from "node:path";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Payload armazenado em disco — replica 1:1 o `_FileTokenStorage` do Python.
 * `client_info` é opcional porque a 1ª execução salva o token antes do
 * registro DCR completo. `code_verifier` mora aqui em runs longos (PKCE).
 */
export interface StoredTokens {
  tokens?: OAuthTokens;
  client_info?: OAuthClientInformationMixed;
  /** PKCE verifier salvo entre o redirect e o callback. */
  code_verifier?: string;
}

/**
 * Storage OAuth compatível com o formato Python. Persistente entre execuções.
 * Não faz cache em memória — cada operação relê o arquivo. Isso mantém o
 * comportamento previsível quando dois processos concorrem (o último a
 * escrever vence, e leituras sempre veem o estado freshest do disco).
 */
export class FileTokenStorage {
  constructor(private readonly path: string) {}

  /** Carrega o payload do disco. `null` = arquivo ausente ou inválido. */
  async load(): Promise<StoredTokens | null> {
    const arquivo = Bun.file(this.path);
    if (!(await arquivo.exists())) return null;
    try {
      const texto = await arquivo.text();
      if (texto.trim().length === 0) return null;
      const parsed = JSON.parse(texto) as StoredTokens;
      // Aceita objetos vazios (`{}`) — significa que uma escrita anterior
      // resetou o arquivo. Se não tiver `tokens` nem `client_info`, é como null.
      if (typeof parsed !== "object" || parsed === null) return null;
      return parsed;
    } catch (err) {
      // JSON inválido, permissão, etc. — logamos e devolvemos null pra
      // o OAuth simplesmente refazer o fluxo.
      console.warn(
        `[magnific] Arquivo de token em "${this.path}" está inválido; ignorando e refazendo login. Detalhe: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Grava o payload completo (atômico via `.tmp` + rename). */
  async save(dados: StoredTokens): Promise<void> {
    const pasta = dirname(this.path);
    await mkdir(pasta, { recursive: true });
    const tmp = `${this.path}.tmp`;
    const json = JSON.stringify(dados, null, 2);
    await writeFile(tmp, json, { encoding: "utf-8" });
    // rename é atômico dentro do mesmo filesystem — se falhar, o arquivo
    // antigo permanece; se der certo, ninguém enxerga estado intermediário.
    await rename(tmp, this.path);
    // Permissão 0600 (dono lê/escreve) — só faz sentido nos Unix; no Windows
    // ignoramos silenciosamente porque a ACL nativa já protege o home.
    if (platform() !== "win32") {
      try {
        await chmod(this.path, 0o600);
      } catch {
        // Não bloqueia — em sistemas de arquivos que não suportam chmod
        // (FAT montado, etc.) a operação é best-effort.
      }
    }
  }

  /** Remove o arquivo. Silencioso se ele já não existir. */
  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (err) {
      const codigo = (err as NodeJS.ErrnoException).code;
      if (codigo !== "ENOENT") {
        // Loga mas não lança — chamador não precisa se preocupar.
        console.warn(
          `[magnific] Não consegui remover "${this.path}": ${(err as Error).message}`,
        );
      }
    }
    // Se sobrou lixo do `.tmp` (crash no meio da escrita), limpa também.
    try {
      await rm(`${this.path}.tmp`, { force: true });
    } catch {
      // idem — best-effort
    }
  }

  /* -------------------- Atalhos consumidos pelo OAuthClientProvider -------- */
  // Estes helpers são thin wrappers em cima de load/save pra manter a API do
  // provider limpa. Trocam só a parte relevante do payload, preservando o resto.

  async getTokens(): Promise<OAuthTokens | undefined> {
    const s = await this.load();
    return s?.tokens;
  }

  async setTokens(tokens: OAuthTokens): Promise<void> {
    const atual = (await this.load()) ?? {};
    atual.tokens = tokens;
    await this.save(atual);
  }

  async getClientInfo(): Promise<OAuthClientInformationMixed | undefined> {
    const s = await this.load();
    return s?.client_info;
  }

  async setClientInfo(info: OAuthClientInformationFull): Promise<void> {
    const atual = (await this.load()) ?? {};
    atual.client_info = info;
    await this.save(atual);
  }

  async getCodeVerifier(): Promise<string | undefined> {
    const s = await this.load();
    return s?.code_verifier;
  }

  async setCodeVerifier(verifier: string): Promise<void> {
    const atual = (await this.load()) ?? {};
    atual.code_verifier = verifier;
    await this.save(atual);
  }
}
