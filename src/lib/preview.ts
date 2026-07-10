// =============================================================================
// Helper pra abrir a janela "preview" (Quick Look) com o anexo selecionado.
// =============================================================================
// REESCRITO 2026-07-10 pra ser robusto no Windows. Antes: criava a janela via
// JS, esperava um handshake `preview:ready` e mandava o payload por
// `emitTo("preview:open")`. No WebView2 (Windows) isso quebrava — o React da
// janela demora mais pra montar, o evento chegava antes do listener e sumia,
// e às vezes o `getByLabel` voltava null e a janela nunca era mostrada
// ("anexo não abre").
//
// Agora TODO o controle da janela é do Rust (`open_preview_window`): ele
// guarda o payload num state, cria/mostra/foca a janela e a PreviewScreen
// BUSCA o payload (pull via `get_preview_payload`) quando monta — sem corrida.
// =============================================================================

import { invoke } from "@tauri-apps/api/core";
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

export async function openAttachmentPreview(
  attachment: Attachment,
  allAttachments?: Attachment[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const list =
    allAttachments && allAttachments.length > 0 ? allAttachments : [attachment];
  const currentIndex = Math.max(
    0,
    list.findIndex((a) => a.id === attachment.id),
  );

  const url = await getSignedUrl(attachment.file_path);
  if (!url) {
    return { ok: false, error: "Não foi possível gerar o link do arquivo." };
  }

  // Pré-resolve TODAS as URLs em paralelo. Signed URLs duram horas no
  // Supabase, então gerar pra lista inteira de uma vez tem custo desprezível
  // e elimina latência ao navegar entre anexos.
  const items: PreviewItem[] = await Promise.all(
    list.map(async (a) => {
      if (a.id === attachment.id) {
        return { url, name: a.file_name, mime: a.file_type, sizeBytes: a.file_size_bytes };
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
    console.log("[preview] open_preview_window — itens:", items.length);
    // O Rust guarda o payload, cria/mostra/foca a janela e sinaliza refresh.
    await invoke("open_preview_window", { payloadJson: JSON.stringify(payload) });
    return { ok: true };
  } catch (err) {
    console.error("[preview] open_preview_window falhou:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
