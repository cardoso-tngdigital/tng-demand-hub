// =============================================================================
// Notificações nativas + correlação com a demanda alvo
// =============================================================================
// O tauri-plugin-notification dispara banner do sistema, mas o click no body
// da notificação não vira evento JS no macOS — só foca a janela do app. Isso
// nos obriga a correlacionar "qual demanda gerou a última notificação" com
// o `tauri://focus` da janela main.
//
// Estratégia:
//   1. Toda notificação ligada a uma demanda passa por `notifyAboutDemand`,
//      que registra `{ demandId, at }` em estado de módulo.
//   2. `subscribeToNotificationClick` ouve o focus da janela main; se ele
//      acontece pouco tempo (< 8s) depois da notificação, considera que foi
//      clique e entrega o `demandId` pendente ao callback.
//
// Limitações conhecidas:
//   - Se o user dá Cmd+Tab pra app dentro da janela de 8s, a app vai abrir
//     o drawer da última notificação — comportamento aceitável (a chance é
//     baixa e o resultado é "mostrar algo relevante", não destrutivo).
//   - Apenas a notificação mais recente é correlacionada. Se chegam duas em
//     <1s e o user clica na primeira, vai abrir a segunda. Para o uso real
//     (~10 pessoas, fluxo de demandas) é raro.
// =============================================================================

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
// Correlação click → demanda
// ---------------------------------------------------------------------------
// No desktop (macOS/Windows) o SO NÃO entrega o clique no corpo da notificação
// como evento — só ativa/foca o app. Então usamos "o app ganhou foco logo após
// uma notificação" como proxy de clique. Duas lições do uso real (2026-07-15):
//   1. 8s era curto DEMAIS. Entre a notificação chegar (latência do realtime) e
//      o usuário efetivamente clicar (às vezes noutra máquina, lendo o banner
//      antes), passavam >8s → o pending expirava → "clico e nada abre". Subimos
//      pra 60s: quem clica numa notificação costuma fazê-lo dentro de 1 min.
//   2. Só armamos o pending quando o app NÃO está focado no momento da
//      notificação. Se ele já está focado, clicar no banner não gera transição
//      de foco (o flush nunca roda de qualquer jeito), e um pending armado
//      abriria a demanda errada no próximo foco não relacionado (falso
//      positivo). App em background/escondido → clicar traz o foco → abre.
const CLICK_WINDOW_MS = 60_000;

type Pending = { demandId: string; notificationId?: string; at: number };

let pending: Pending | null = null;

export async function notifyAboutDemand(
  title: string,
  body: string,
  demandId: string,
  notificationId?: string,
): Promise<void> {
  const appFocused = typeof document !== "undefined" && document.hasFocus();
  if (!appFocused) {
    // notificationId permite ao proxy marcar AQUELA notificação como lida
    // quando o clique no banner do SO traz o foco e abre a demanda.
    pending = { demandId, notificationId, at: Date.now() };
  }
  await notify(title, body);
}

/**
 * Ouve focos na janela main e, quando o foco chega logo após uma notificação,
 * entrega o demandId ao callback. Devolve função pra cancelar.
 *
 * Escutamos por DUAS vias em paralelo porque cada uma falha em casos
 * diferentes no Tauri 2 + macOS:
 *   - DOM focus event (window.addEventListener "focus") — dispara quando o
 *     webview ganha foco; consistente entre plataformas.
 *   - Tauri Window.onFocusChanged — dispara em transição focus/blur; mais
 *     baixo nível, garante captura em casos onde DOM event não dispara
 *     (alguns relaunches/reflows).
 * O `pending` é consumido pela primeira que entregar, então não há risco
 * de chamar `onClick` duas vezes para o mesmo evento.
 */
export function subscribeToNotificationClick(
  onClick: (demandId: string, notificationId?: string) => void,
): () => void {
  let cancelled = false;
  let unlistenTauri: (() => void) | null = null;

  function flushIfPending(): void {
    const p = pending;
    if (!p) return;
    if (Date.now() - p.at > CLICK_WINDOW_MS) {
      pending = null;
      return;
    }
    pending = null;
    onClick(p.demandId, p.notificationId);
  }

  // Via 1 — DOM
  window.addEventListener("focus", flushIfPending);

  // Via 2 — Tauri (best-effort; alguns ambientes podem não suportar)
  (async () => {
    try {
      const win = getCurrentWindow();
      const unlisten = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) flushIfPending();
      });
      if (cancelled) {
        unlisten();
      } else {
        unlistenTauri = unlisten;
      }
    } catch (err) {
      console.warn("[notifications] tauri focus listener unavailable:", err);
    }
  })();

  return () => {
    cancelled = true;
    window.removeEventListener("focus", flushIfPending);
    if (unlistenTauri) unlistenTauri();
  };
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
