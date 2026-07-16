import { supabase } from "./supabase/client";

// =============================================================================
// Centro de notificações in-app
// =============================================================================
// As notificações são criadas SERVER-SIDE (triggers no Postgres — ver migration
// 20260715000001_notifications.sql), uma linha por destinatário. Aqui o cliente
// só LÊ, ASSINA em tempo real e MARCA COMO LIDA. "Lida" = o destinatário viu a
// notificação (clicou no popup do app ou no banner do SO) — não tem relação com
// abrir a demanda por navegação normal.
// =============================================================================

export type AppNotificationType =
  | "assigned"
  | "status"
  | "priority"
  | "comment"
  | "mention"
  | "due"
  | "attachment";

export type AppNotification = {
  id: string;
  user_id: string;
  demand_id: string | null;
  actor_id: string | null;
  type: AppNotificationType;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

/** Ícone Font Awesome por tipo — usado no popup. */
export function notificationIcon(type: AppNotificationType): string {
  switch (type) {
    case "assigned":
      return "fa-user-check";
    case "status":
      return "fa-arrows-rotate";
    case "priority":
      return "fa-flag";
    case "comment":
      return "fa-comment";
    case "mention":
      return "fa-at";
    case "due":
      return "fa-clock";
    case "attachment":
      return "fa-paperclip";
    default:
      return "fa-bell";
  }
}

/**
 * Lista as notificações do usuário logado (RLS já restringe às próprias),
 * mais recentes primeiro. Admin recebe uma linha por evento, então vê tudo.
 */
export async function listMyNotifications(
  limit = 100,
): Promise<{ data: AppNotification[]; error: string | null }> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[notificationsCenter] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as AppNotification[]) ?? [], error: null };
}

export type NotificationHandlers = {
  onInsert?: (n: AppNotification) => void;
  onUpdate?: (n: AppNotification) => void;
  onDelete?: (id: string) => void;
};

// Topic único por subscription (mesma lição do canal de demands): evita corrida
// phx_leave/phx_join quando a subscription é recriada.
let notifChannelSeq = 0;

/**
 * Assina em tempo real as notificações do usuário (filtradas por user_id no
 * servidor). INSERT = nova; UPDATE = mudou "read" (sincroniza contador entre
 * sessões); DELETE = removida. Retorna função pra desinscrever.
 */
export function subscribeToMyNotifications(
  userId: string,
  handlers: NotificationHandlers,
): () => void {
  const channel = supabase
    .channel(`notifications:${userId}:${++notifChannelSeq}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          handlers.onInsert?.(payload.new as AppNotification);
        } else if (payload.eventType === "UPDATE") {
          handlers.onUpdate?.(payload.new as AppNotification);
        } else if (payload.eventType === "DELETE") {
          const old = payload.old as { id?: string } | undefined;
          if (old?.id) handlers.onDelete?.(old.id);
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Marca UMA notificação como lida. */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", id);
  if (error) console.error("[notificationsCenter] markRead failed:", error);
}

/** Marca todas as não lidas do usuário como lidas. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) console.error("[notificationsCenter] markAllRead failed:", error);
}

/** Remove as notificações já lidas do usuário (limpeza opcional). */
export async function clearReadNotifications(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("user_id", userId)
    .eq("read", true);
  if (error) console.error("[notificationsCenter] clearRead failed:", error);
}
