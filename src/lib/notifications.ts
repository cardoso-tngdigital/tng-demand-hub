// =============================================================================
// Notificações nativas do SO
// =============================================================================
// `notify()` dispara um banner do sistema via tauri-plugin-notification (usado
// como fallback e no botão de teste). O caminho com CLIQUE real (abrir a
// demanda ao clicar no banner) fica em `notifyWithClick` mais abaixo — via Web
// Notification API do WebView, com fallback pro plugin. Ver o comentário lá.
// =============================================================================

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { supabase } from "./supabase/client";

export type DueBucket = "5d" | "3d" | "24h";

export type DueNotificationRow = {
  demand_id: string;
  user_id: string;
  bucket: DueBucket;
  sent_at: string;
};

let cachedPermission: "granted" | "denied" | "unknown" = "unknown";

export async function ensureNotificationPermission(): Promise<boolean> {
  if (cachedPermission === "granted") return true;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    cachedPermission = granted ? "granted" : "denied";
    return granted;
  } catch (err) {
    console.error("[notifications] permission check failed:", err);
    return false;
  }
}

export async function notify(title: string, body?: string): Promise<void> {
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  try {
    // sound: 'default' usa o som de notificação do sistema (macOS: Pop/Funk,
    // Windows: ms-winsoundevent default). Sem isso a notif é silenciosa.
    sendNotification({ title, body, sound: "default" });
  } catch (err) {
    console.error("[notifications] send failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Supressão de auto-notificação
// ---------------------------------------------------------------------------
// Quando o próprio user faz uma mudança (atribui-se, comenta, etc.), o
// realtime traz o UPDATE/INSERT de volta pra ele em milissegundos. Sem
// suppressão, ele recebe notificação por uma ação que acabou de fazer.
// Mantemos um cache de demand_ids "marcados" nos últimos LOCAL_CHANGE_TTL_MS
// e pulamos a notificação enquanto a marca está fresca.

const LOCAL_CHANGE_TTL_MS = 3000;
const localChanges = new Map<string, number>();

export function markLocalChange(demandId: string): void {
  localChanges.set(demandId, Date.now());
  // Limpa entradas velhas eventualmente — evita crescer indefinidamente.
  if (localChanges.size > 64) {
    const now = Date.now();
    for (const [id, at] of localChanges) {
      if (now - at > LOCAL_CHANGE_TTL_MS) localChanges.delete(id);
    }
  }
}

export function wasLocalChange(demandId: string): boolean {
  const at = localChanges.get(demandId);
  if (at === undefined) return false;
  if (Date.now() - at > LOCAL_CHANGE_TTL_MS) {
    localChanges.delete(demandId);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Notificação com CLIQUE real → demanda (Web Notification API + fallback)
// ---------------------------------------------------------------------------
// O desktop do Tauri NÃO entrega o clique no banner do plugin nativo (só o
// mobile — confirmado na fonte do plugin e na issue tauri #4770/#2150). A saída
// que dá clique real SEM assinar o app é a Web Notification API do próprio
// WebView: `new Notification(...)` tem `onclick` de verdade (é o que o app
// ClawTerm usou pro mesmo problema). Porém no macOS (WKWebView) ela às vezes
// NÃO exibe o banner. Estratégia adaptativa:
//   1. Dispara via Web Notification API.
//   2. Se CONFIRMAR que exibiu (evento `onshow`), usa o `onclick` dela — clicar
//      abre a demanda. Um banner só.
//   3. Se NÃO exibir (sem `onshow` até o timeout, ou `onerror`), cai no plugin
//      Tauri (banner garantido, sem clique). O fallback dispara UMA vez só.
// Resultado: a notificação SEMPRE aparece, nunca duplica, e o clique→demanda
// vale sempre que a Web API exibiu (Windows sempre; macOS quando suportar).
//
// Antes disto usávamos "foco da janela após a notificação" como proxy de
// clique — que abria a demanda em QUALQUER foco (falso-positivo). Removido.

/** Pede a permissão da Web Notification API (separada da permissão do plugin). */
export async function ensureWebNotificationPermission(): Promise<void> {
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (window.Notification.permission === "default") {
        await window.Notification.requestPermission();
      }
    }
  } catch {
    /* se falhar, o fallback do plugin cobre a exibição */
  }
}

/**
 * Mostra uma notificação e, quando o usuário CLICA nela, chama `onClick`.
 * Tenta a Web Notification API (clique real); se ela não exibir, cai no plugin
 * Tauri (banner garantido, sem clique).
 */
export async function notifyWithClick(
  title: string,
  body: string,
  onClick: () => void,
): Promise<void> {
  const canWeb =
    typeof window !== "undefined" &&
    "Notification" in window &&
    window.Notification.permission === "granted";

  if (canWeb) {
    try {
      let shown = false;
      let fellBack = false;
      const fallback = () => {
        if (shown || fellBack) return;
        fellBack = true;
        void notify(title, body);
      };
      const n = new window.Notification(title, { body });
      n.onshow = () => {
        shown = true;
      };
      n.onclick = () => {
        onClick();
        try {
          n.close();
        } catch {
          /* noop */
        }
      };
      n.onerror = () => fallback();
      // Sem `onshow` até aqui => a Web API não exibiu (ex.: macOS) => plugin.
      window.setTimeout(fallback, 700);
      return;
    } catch {
      /* falhou ao criar — cai no plugin abaixo */
    }
  }

  // Fallback: plugin Tauri (banner garantido, sem clique).
  await notify(title, body);
}

// ---------------------------------------------------------------------------
// Notificações de prazo
// ---------------------------------------------------------------------------
// O Postgres cria os registros em `demand_due_notifications` 1x/dia via
// pg_cron + função compute_due_notifications(). Aqui o cliente escuta os
// INSERTs filtrados pelo próprio user_id e dispara notificação nativa.

export function subscribeToDueNotifications(
  userId: string,
  onInsert: (row: DueNotificationRow) => void,
): () => void {
  const channel = supabase
    .channel(`public:demand_due_notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "demand_due_notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as DueNotificationRow | undefined;
        if (row) onInsert(row);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function bucketToLabel(bucket: DueBucket): string {
  if (bucket === "24h") return "vence em 24h";
  if (bucket === "3d") return "vence em 3 dias";
  return "vence em 5 dias";
}
