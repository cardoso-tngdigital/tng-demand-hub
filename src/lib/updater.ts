import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateInfo = {
  version: string;
  notes: string | null;
  date: string | null;
  apply: () => Promise<void>;
};

/**
 * Consulta o endpoint de updates configurado em `tauri.conf.json`. Retorna
 * dados da nova versão e uma função `apply` que faz download, instala e
 * reinicia o app. Null se já estamos na última.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update: Update | null = await check();
    if (!update?.available) return null;
    return {
      version: update.version,
      notes: update.body ?? null,
      date: update.date ?? null,
      apply: async () => {
        await update.downloadAndInstall();
        await relaunch();
      },
    };
  } catch (err) {
    console.error("[updater] check failed:", err);
    return null;
  }
}
