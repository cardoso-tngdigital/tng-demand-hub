// =============================================================================
// Helper pra abrir a janela "preview" (Quick Look) com o anexo selecionado.
// =============================================================================
// A janela `preview` é criada on-demand via comando Rust (Sprint 18). Antes
// ela era pré-declarada com visible: false, mas o AltTab no macOS lista
// janelas vivas ainda que invisíveis. Agora criamos quando precisamos e
// destruímos ao fechar — cold start de ~200ms no primeiro uso após boot.
//
// Como criar a janela é assíncrono, e o React lá dentro leva tempo pra
// montar e registrar o listener de `preview:open`, usamos um handshake:
// a PreviewScreen emite `preview:ready` no mount; aqui esperamos ele
// (com timeout) antes de mandar o payload.
// =============================================================================

import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
const READY_TIMEOUT_MS = 4000;

// Aguarda o React da PreviewScreen sinalizar que montou e registrou os
// listeners. Resolve no `preview:ready` ou no timeout — o que vier antes.
// O timeout existe como rede de segurança: se algo derrubar a janela
// antes do ready, ainda tentamos o emit e a falha cai no catch externo.
async function waitForPreviewReady(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let unlisten: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        unlisten?.();
        resolve();
      }
    }, timeoutMs);
    void listen("preview:ready", () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        unlisten?.();
        resolve();
      }
    }).then((fn) => {
      if (settled) fn();
      else unlisten = fn;
    });
  });
}

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

  // Logs por etapa — sem devtools em release não dava pra ver onde o fluxo
  // parava (bug "anexos não abrem no Windows", 2026-07-10). Com a feature
  // devtools ligada + F12, esses logs mostram exatamente o ponto de falha.
  try {
    console.log("[preview] abrindo. itens:", items.length, "index:", currentIndex);
    let win = await WebviewWindow.getByLabel(WINDOW_LABEL);
    console.log("[preview] janela existente?", win !== null);
    if (!win) {
      // Cria a janela on-demand e espera o React lá dentro montar antes
      // de emitir — senão o evento é entregue antes do listener existir
      // e o payload se perde.
      console.log("[preview] criando janela via ensure_preview_window_cmd…");
      await invoke("ensure_preview_window_cmd");
      console.log("[preview] aguardando preview:ready (timeout 4s)…");
      await waitForPreviewReady(READY_TIMEOUT_MS);
      win = await WebviewWindow.getByLabel(WINDOW_LABEL);
      console.log("[preview] após ready, janela achada?", win !== null);
    }

    console.log("[preview] emitindo preview:open…");
    await emitTo(WINDOW_LABEL, "preview:open", payload);

    if (win) {
      console.log("[preview] show + setFocus…");
      await win.show();
      await win.setFocus();
      console.log("[preview] concluído com sucesso.");
    } else {
      // Janela nunca ficou disponível — reporta como falha em vez de fingir OK.
      console.error("[preview] janela 'preview' indisponível após criação.");
      return {
        ok: false,
        error:
          "A janela de pré-visualização não abriu. Tente de novo; se persistir, abra o console (F12) e me mande o erro.",
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[preview] falhou:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
