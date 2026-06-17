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

export type PreviewItem = {
  url: string;
  name: string;
  mime: string;
  sizeBytes: number;
};

export type PreviewPayload = {
  // Sempre tem pelo menos 1 item. O primeiro a ser exibido é
  // items[currentIndex]; o user navega com ←/→.
  items: PreviewItem[];
  currentIndex: number;
};

const WINDOW_LABEL = "preview";

export async function openAttachmentPreview(
  attachment: Attachment,
  allAttachments?: Attachment[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Universo de navegação: lista passada OU só o anexo clicado. Pra evitar
  // gerar signed URLs de coisa que o user talvez não veja, vamos resolver
  // só o anexo atual ANTES de mostrar a janela; os vizinhos resolvem sob
  // demanda quando o user pressionar ←/→.
  const list = allAttachments && allAttachments.length > 0
    ? allAttachments
    : [attachment];
  const currentIndex = Math.max(
    0,
    list.findIndex((a) => a.id === attachment.id),
  );

  const url = await getSignedUrl(attachment.file_path);
  if (!url) {
    return { ok: false, error: "Não foi possível gerar o link do arquivo." };
  }

  // Pré-resolve TODAS as URLs em paralelo. Signed URLs duram horas no
  // Supabase, então gerar pra lista inteira de uma vez tem custo
  // desprezível e elimina latência ao navegar entre anexos.
  const items: PreviewItem[] = await Promise.all(
    list.map(async (a) => {
      if (a.id === attachment.id) {
        return {
          url,
          name: a.file_name,
          mime: a.file_type,
          sizeBytes: a.file_size_bytes,
        };
      }
      const u = await getSignedUrl(a.file_path);
      return {
        url: u ?? "",
        name: a.file_name,
        mime: a.file_type,
        sizeBytes: a.file_size_bytes,
      };
    }),
  );

  const payload: PreviewPayload = { items, currentIndex };

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
