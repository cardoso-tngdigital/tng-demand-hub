/**
 * scripts/vendor-sharp.ts — copia sharp + @img/sharp-* + deps de runtime pro
 * `sidecar-vendor/node_modules/`, pra ficar ao lado do binário compilado.
 *
 * Roda cross-platform (Mac/Windows) via APIs Node — sem `cp -r` shell.
 */

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const NM = join(ROOT, "node_modules");
const OUT = join(ROOT, "sidecar-vendor", "node_modules");

/** Pacotes que precisam sair inteiros junto do binário (sharp + deps). */
const PACKAGES = ["sharp", "@img", "color", "detect-libc", "semver"];

async function existe(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  for (const pkg of PACKAGES) {
    const src = join(NM, pkg);
    if (!(await existe(src))) {
      console.warn(`[vendor] pulando "${pkg}" — não instalado`);
      continue;
    }
    const dest = join(OUT, pkg);
    await cp(src, dest, { recursive: true, dereference: true });
    console.log(`[vendor] ${pkg} → sidecar-vendor/node_modules/`);
  }
  console.log("[vendor] concluído.");
}

await main();
