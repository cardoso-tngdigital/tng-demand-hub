/**
 * routes/plugin.ts — download do plugin WordPress em .zip.
 *
 * NÃO exige auth Supabase — é conveniência pra copiar link direto do painel.
 * Empacota `wp-plugin/tng-blog-connect.php` num zip mínimo (deflate).
 *
 * IMPORTANTE (2026-07-09): o conteúdo do .php é EMBUTIDO no bundle em tempo
 * de build via import de texto do Bun (`with { type: "text" }`). A versão
 * anterior lia o arquivo do disco relativo a `import.meta.url`/`process.cwd()`
 * — o que funciona em dev (`bun run`) mas QUEBRA no binário compilado
 * (`bun build --compile`): não existe `wp-plugin/` ao lado do executável, e
 * o `import.meta.url` aponta pro filesystem virtual `/$bunfs/`. Resultado:
 * "Plugin não encontrado no sidecar." ao baixar o plugin no app empacotado.
 * Embutindo, o binário fica autossuficiente (mesmo espírito do vendor:sharp).
 */

import { Hono } from "hono";
import { deflateRawSync } from "node:zlib";
// Conteúdo do plugin embutido no bundle em build time. Em dev o Bun lê o
// arquivo; em `--compile` vira uma string constante dentro do binário.
import pluginPhp from "../../wp-plugin/tng-blog-connect.php" with { type: "text" };

export const pluginRouter = new Hono();

pluginRouter.get("/download", () => {
  const conteudo = Buffer.from(pluginPhp, "utf-8");
  const zipBuffer = _criarZipSimples("tng-blog-connect.php", conteudo);

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="tng-blog-connect.zip"',
    },
  });
});

/**
 * Gera um .zip mínimo válido com 1 único arquivo — usando o algoritmo ZIP
 * clássico (local file header + central directory + EOCD) com DEFLATE.
 * Suficiente pro WordPress aceitar como plugin.
 */
function _criarZipSimples(filename: string, data: Buffer): Buffer {
  const nome = Buffer.from(filename, "utf-8");
  const dataInflated = data;
  const dataDeflated = deflateRawSync(dataInflated);
  const crc = _crc32(dataInflated);
  const dataSize = dataInflated.length;
  const compressedSize = dataDeflated.length;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  // Local file header
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); // signature
  lfh.writeUInt16LE(20, 4); // version
  lfh.writeUInt16LE(0, 6); // flags
  lfh.writeUInt16LE(8, 8); // method deflate
  lfh.writeUInt16LE(dosTime, 10);
  lfh.writeUInt16LE(dosDate, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(compressedSize, 18);
  lfh.writeUInt32LE(dataSize, 22);
  lfh.writeUInt16LE(nome.length, 26);
  lfh.writeUInt16LE(0, 28);

  // Central directory header
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4); // version made by
  cdh.writeUInt16LE(20, 6); // version needed
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt16LE(dosTime, 12);
  cdh.writeUInt16LE(dosDate, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(compressedSize, 20);
  cdh.writeUInt32LE(dataSize, 24);
  cdh.writeUInt16LE(nome.length, 28);
  cdh.writeUInt16LE(0, 30); // extra
  cdh.writeUInt16LE(0, 32); // comment
  cdh.writeUInt16LE(0, 34); // disk
  cdh.writeUInt16LE(0, 36); // int attrs
  cdh.writeUInt32LE(0, 38); // ext attrs
  cdh.writeUInt32LE(0, 42); // local header offset

  const lfhAll = Buffer.concat([lfh, nome, dataDeflated]);
  const cdhAll = Buffer.concat([cdh, nome]);

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdhAll.length, 12);
  eocd.writeUInt32LE(lfhAll.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfhAll, cdhAll, eocd]);
}

/** CRC-32 do zip (polinômio 0xEDB88320). */
function _crc32(buf: Buffer): number {
  const table = _crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const idx = (crc ^ (buf[i] as number)) & 0xff;
    crc = ((crc >>> 8) ^ (table[idx] as number)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _cache: number[] | null = null;
function _crcTable(): number[] {
  if (_cache !== null) return _cache;
  const t: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  _cache = t;
  return t;
}
