/**
 * settings.ts — preferências não-secretas + chave do Gemini local.
 *
 * Arquivo: `${DATA_DIR}/settings.json` — JSON simples com o shape:
 *
 * ```json
 * {
 *   "gemini_api_key": "AIzaSy...",
 *   "gemini_model": "gemini-2.5-flash",
 *   "magnific_modelo_ia": "imagen-nano-banana"
 * }
 * ```
 *
 * A chave do Gemini vai aqui (não no keyring do SO como no Python) porque o
 * sidecar precisa ficar 100% self-contained pro Bun compile. Permissão 0600
 * nos Unix garante que só o dono lê. NUNCA devolvemos a `gemini_api_key` pro
 * front — é lida só pelo pipeline em runtime.
 *
 * Escrita atômica (`.tmp` + rename), leitura tolerante (JSON inválido = `{}`).
 */

import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { env } from "./env";

/** Shape das chaves conhecidas. Estende sem quebrar consumidores existentes. */
export interface SettingsShape {
  gemini_api_key?: string;
  gemini_model?: string;
  magnific_modelo_ia?: string;
}

/** Modelo padrão do Gemini se nada estiver configurado. */
export const MODELO_GEMINI_PADRAO = "gemini-2.5-flash";

/** Modelos oferecidos no seletor do painel (bate com o app Python). */
export const MODELOS_GEMINI: ReadonlyArray<{ id: string; rotulo: string }> = [
  { id: "gemini-2.5-flash", rotulo: "Gemini 2.5 Flash — equilibrado (recomendado)" },
  { id: "gemini-2.5-flash-lite", rotulo: "Gemini 2.5 Flash-Lite — mais rápido e econômico" },
  { id: "gemini-2.5-pro", rotulo: "Gemini 2.5 Pro — máxima qualidade" },
];

/** Modelo padrão do Magnific quando o operador não escolheu outro. */
export const MODELO_IA_MAGNIFIC_PADRAO = "imagen-nano-banana";

/** Caminho do arquivo. */
function caminho(): string {
  return join(resolve(env.DATA_DIR), "settings.json");
}

/** Lê e devolve o objeto — nunca lança. */
export async function loadSettings(): Promise<SettingsShape> {
  const arquivo = Bun.file(caminho());
  if (!(await arquivo.exists())) return {};
  try {
    const texto = await arquivo.text();
    if (texto.trim().length === 0) return {};
    const parsed = JSON.parse(texto) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      return parsed as SettingsShape;
    }
    return {};
  } catch (err) {
    console.warn(
      `[settings] Arquivo inválido em ${caminho()}: ${(err as Error).message}. ` +
        "Ignorando e usando defaults.",
    );
    return {};
  }
}

/** Merge parcial e grava. Chmod 0600 (best-effort no Windows). */
export async function updateSettings(
  patch: Partial<SettingsShape>,
): Promise<SettingsShape> {
  const atual = await loadSettings();
  const novo: SettingsShape = { ...atual };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      (novo as Record<string, unknown>)[k] = v;
    }
  }
  const alvo = caminho();
  await mkdir(dirname(alvo), { recursive: true });
  const tmp = `${alvo}.tmp`;
  await writeFile(tmp, JSON.stringify(novo, null, 2), { encoding: "utf-8" });
  await rename(tmp, alvo);
  if (platform() !== "win32") {
    try {
      await chmod(alvo, 0o600);
    } catch {
      // best-effort — sem chmod em FS que não suporta
    }
  }
  return novo;
}

/**
 * Retorna a chave do Gemini efetiva: primeiro o settings.json (editado pelo
 * painel), depois a env var `GEMINI_API_KEY`. Nunca vaza pro caller pra
 * qual das duas ficou — o pipeline só precisa do valor.
 */
export async function getGeminiApiKey(): Promise<string> {
  const s = await loadSettings();
  const salva = (s.gemini_api_key ?? "").trim();
  if (salva) return salva;
  return env.GEMINI_API_KEY;
}

/** Retorna o modelo Gemini efetivo (settings → env → padrão). */
export async function getGeminiModel(): Promise<string> {
  const s = await loadSettings();
  const salvo = (s.gemini_model ?? "").trim();
  if (salvo) return salvo;
  const doEnv = (env.GEMINI_MODEL ?? "").trim();
  return doEnv || MODELO_GEMINI_PADRAO;
}

/** Retorna o modelo Magnific efetivo (settings → padrão). */
export async function getMagnificModeloIA(): Promise<string> {
  const s = await loadSettings();
  const salvo = (s.magnific_modelo_ia ?? "").trim();
  return salvo || MODELO_IA_MAGNIFIC_PADRAO;
}
