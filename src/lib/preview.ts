// =============================================================================
// Helper pra abrir a janela "preview" (Quick Look) com o anexo selecionado.
// =============================================================================
// A janela `preview` é pré-declarada no tauri.conf.json (visible: false) e
// fica viva escondida entre invocações — mesmo padrão da `capture`. Aqui
// resolvemos a signed URL do Storage, emitimos um evento `preview:open` com
// o payload pra que a janela atualize o estado, e damos show + focus.
// =============================================================================

import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getSignedUrl } from "./attachments";
import type { Attachment } from "../types/database";

export type PreviewPayload = {
  url: string;
  name: string;
  mime: string;
  sizeBytes: number;
};

const WINDOW_LABEL = "preview";

export async function openAttachmentPreview(
  attachment: Attachment,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = await getSignedUrl(attachment.file_path);
  if (!url) {
    return { ok: false, error: "Não foi possível gerar o link do arquivo." };
  }

  const payload: PreviewPayload = {
    url,
    name: attachment.file_name,
    mime: attachment.file_type,
    sizeBytes: attachment.file_size_bytes,
  };

  try {
    await emitTo(WINDOW_LABEL, "preview:open", payload);

    const win = await WebviewWindow.getByLabel(WINDOW_LABEL);
    if (win) {
      await win.show();
      await win.setFocus();
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
