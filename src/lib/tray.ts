import { invoke } from "@tauri-apps/api/core";

/**
 * Atualiza o contador exibido junto ao tray icon na menubar.
 * Passe 0 para limpar.
 */
export async function setTrayBadge(count: number): Promise<void> {
  try {
    await invoke("set_tray_badge", { count: Math.max(0, Math.floor(count)) });
  } catch (err) {
    console.error("[tray] set_tray_badge failed:", err);
  }
}
