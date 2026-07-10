#!/usr/bin/env bun
/**
 * magnific-smoke.ts — smoke test manual do MCP do Magnific.
 *
 * NÃO roda em `bun test` (por design — precisa de credencial Magnific viva
 * e abre o browser na 1ª execução). Rode manualmente:
 *
 *     cd blog-backend
 *     bun run tests/manual/magnific-smoke.ts
 *
 * O que ele faz (em ordem):
 *   1. Instancia o `MagnificClient` apontando pra `./data/` local.
 *   2. `ensureAuth()` — na 1ª vez abre o browser e persiste o token em
 *      `data/magnific_token.json`. Nas próximas, reusa em silêncio.
 *   3. `accountBalance()` — imprime créditos e plano.
 *   4. `stockSearch("marketing digital", 2)` — imprime título de cada item.
 *   5. `close()` — encerra a sessão limpo.
 *
 * Se algum passo falhar, o erro imprime pt-BR + causa técnica. Nada é
 * publicado nem baixado — o objetivo é validar sessão + descoberta.
 */

import { MagnificClient } from "../../src/magnific/client.js";

const MCP_URL =
  Bun.env["MAGNIFIC_MCP_URL"] ?? "https://mcp.magnific.com/mcp";
const DATA_DIR = Bun.env["DATA_DIR"] ?? "./data";

async function main(): Promise<void> {
  const cli = new MagnificClient({
    mcpUrl: MCP_URL,
    dataDir: DATA_DIR,
    onNeedLogin: () => {
      console.log("→ Vou abrir o navegador pra você fazer login no Magnific.");
    },
  });

  try {
    console.log("1) Conectando ao MCP…");
    await cli.ensureAuth();

    console.log("2) Consultando saldo da conta…");
    const balance = await cli.accountBalance();
    console.log(
      `   Plano: ${balance.plan} · Créditos: ${balance.credits.toLocaleString("pt-BR")}`,
    );

    console.log('3) Buscando no banco: "marketing digital" (limit=2)…');
    const itens = await cli.stockSearch("marketing digital", 2);
    if (itens.length === 0) {
      console.log("   (nenhum item)");
    } else {
      itens.forEach((it, i) => {
        console.log(`   ${i + 1}. id=${it.id} · ${it.title ?? "(sem título)"}`);
      });
    }

    console.log("\nOK — smoke test concluído.");
  } catch (err) {
    console.error("\nErro no smoke test:");
    console.error(`  ${(err as Error).message}`);
    const cause = (err as Error & { cause?: Error }).cause;
    if (cause) {
      console.error(`  Causa técnica: ${cause.message}`);
    }
    process.exit(1);
  } finally {
    await cli.close();
  }
}

main();
