/**
 * singleton.ts — instância única do MagnificClient compartilhada por rotas.
 *
 * O cliente MCP mantém uma conexão persistente + estado de OAuth. Não faz
 * sentido criar um por request — instanciamos lazy e reusamos.
 */

import { env } from "../env";
import { MagnificClient } from "./client";

let _instance: MagnificClient | null = null;

/** Retorna a instância única, criando na primeira chamada. */
export function getMagnific(): MagnificClient {
  if (_instance === null) {
    _instance = new MagnificClient({
      mcpUrl: env.MAGNIFIC_MCP_URL,
      dataDir: env.DATA_DIR,
    });
  }
  return _instance;
}

/** Fecha a conexão MCP no shutdown do sidecar. */
export async function closeMagnific(): Promise<void> {
  if (_instance !== null) {
    try {
      await _instance.close();
    } catch {
      // ignora — já vai encerrar mesmo
    }
    _instance = null;
  }
}
