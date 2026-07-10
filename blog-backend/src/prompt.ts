/**
 * prompt.ts — leitura/escrita do prompt geral (padrão) do Gemini.
 *
 * O prompt vive em `${DATA_DIR}/prompt_padrao.txt` — versionado no disco do
 * operador e editável pelo painel (`PUT /api/prompt`). Se o arquivo não
 * existir na 1ª execução, semeamos com o template embarcado em
 * `src/prompt_padrao_default.txt` (copiado do app Python).
 *
 * `getPromptSeSite(site)` implementa a regra do pipeline: usa o `prompt`
 * específico do site quando não-vazio; senão, cai pro prompt geral.
 *
 * Escrita atômica (`.tmp` + rename) — nunca corrompe o arquivo em caso de
 * crash no meio da gravação.
 */

import { rename, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "./env";
import { PROMPT_PADRAO_DEFAULT } from "./prompt_padrao_default";

/** Nome do arquivo persistido em `${DATA_DIR}`. */
const NOME_ARQUIVO = "prompt_padrao.txt";

/** Caminho absoluto do arquivo do prompt salvo no disco. */
function caminhoPrompt(): string {
  return join(resolve(env.DATA_DIR), NOME_ARQUIVO);
}

/**
 * Retorna o prompt geral. Se o arquivo não existir OU estiver vazio,
 * semeia com o template embutido em `PROMPT_PADRAO_DEFAULT` (constante TS
 * que vai pro bundle do `bun build --compile`; recurso `.txt` externo
 * NÃO é bundleado — foi o bug do primeiro teste real). Nunca lança —
 * a última cartada é devolver o template default in-memory.
 */
export async function getPrompt(): Promise<string> {
  const alvo = caminhoPrompt();
  const arquivo = Bun.file(alvo);
  if (await arquivo.exists()) {
    try {
      const texto = await arquivo.text();
      if (texto.trim().length > 0) return texto;
      // Arquivo existe mas vazio — sinal do bug antigo. Reescreve com o default.
      console.warn(
        `[prompt] Arquivo ${alvo} existia mas estava vazio. Re-semeando com default embutido.`,
      );
    } catch (err) {
      console.warn(
        `[prompt] Falha ao ler ${alvo}: ${(err as Error).message}. Semeando novamente.`,
      );
    }
  }
  // Semeia com o template embutido no bundle e devolve.
  try {
    await savePrompt(PROMPT_PADRAO_DEFAULT);
  } catch (err) {
    console.warn(
      `[prompt] Falha ao gravar seed em ${alvo}: ${(err as Error).message}. Devolvendo texto default sem persistir.`,
    );
  }
  return PROMPT_PADRAO_DEFAULT;
}

/**
 * Grava o prompt em `${DATA_DIR}/prompt_padrao.txt` atomicamente. Cria a
 * pasta `data/` se ainda não existir. Erros da FS propagam pra rota tratar.
 */
export async function savePrompt(texto: string): Promise<void> {
  const alvo = caminhoPrompt();
  await mkdir(dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  await writeFile(tmp, texto, { encoding: "utf-8" });
  await rename(tmp, alvo);
}

/**
 * Retorna o prompt efetivo pra um site: se o site tem `prompt` não-vazio
 * (Sprint 12 do Python), usa ele; senão, cai pro prompt geral do arquivo.
 */
export async function getPromptParaSite(
  sitePrompt: string | null | undefined,
): Promise<string> {
  const proprio = (sitePrompt ?? "").trim();
  if (proprio.length > 0) return proprio;
  return await getPrompt();
}
