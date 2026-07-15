import { useEffect } from "react";
import {
  notificationIcon,
  type AppNotification,
} from "../lib/notificationsCenter";

type Props = {
  notifications: AppNotification[];
  unreadCount: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Clique numa notificação → abre a demanda e marca a notificação como lida. */
  onSelect: (demandId: string | null, notificationId: string) => void;
  onMarkAllRead: () => void;
  onClearRead: () => void;
};

/** Tempo relativo curto em pt-BR (agora, há 5 min, há 2 h, há 3 d, ou data). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function NotificationsBell({
  notifications,
  unreadCount,
  open,
  onToggle,
  onClose,
  onSelect,
  onMarkAllRead,
  onClearRead,
}: Props) {
  // Esc fecha o popup enquanto aberto.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const hasRead = notifications.some((n) => n.read);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        title="Notificações"
        className="relative flex items-center justify-center h-8 w-8 rounded-lg text-tng-marine-200 hover:text-tng-marine-50 hover:bg-tng-marine-800 transition-colors"
      >
        <i className="fa-solid fa-bell" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-tng-orange-400 text-tng-marine-900 text-[10px] font-bold leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* backdrop transparente pra fechar ao clicar fora */}
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute left-0 mt-2 w-[360px] max-h-[70vh] z-50 flex flex-col rounded-xl border border-tng-marine-700 bg-tng-marine-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-tng-marine-700">
              <span className="text-sm font-semibold text-tng-marine-50">
                Notificações
              </span>
              <div className="flex items-center gap-3 text-xs">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="text-tng-orange-400 hover:underline"
                  >
                    Marcar todas
                  </button>
                )}
                {hasRead && (
                  <button
                    type="button"
                    onClick={onClearRead}
                    className="text-tng-marine-300 hover:text-tng-marine-100 hover:underline"
                  >
                    Limpar lidas
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-tng-marine-400">
                  <i className="fa-regular fa-bell-slash text-2xl mb-2 block opacity-60" />
                  Nenhuma notificação.
                </div>
              ) : (
                <ul className="divide-y divide-tng-marine-800">
                  {notifications.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(n.demand_id, n.id)}
                        className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-tng-marine-800 transition-colors ${
                          n.read ? "opacity-60" : ""
                        }`}
                      >
                        <span className="mt-0.5 flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-full bg-tng-marine-800 text-tng-orange-400">
                          <i className={`fa-solid ${notificationIcon(n.type)} text-xs`} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium text-tng-marine-50 truncate">
                              {n.title}
                            </span>
                            {!n.read && (
                              <span className="flex-shrink-0 h-2 w-2 rounded-full bg-tng-orange-400" />
                            )}
                          </span>
                          {n.body && (
                            <span className="block text-xs text-tng-marine-300 mt-0.5 line-clamp-2">
                              {n.body}
                            </span>
                          )}
                          <span className="block text-[11px] text-tng-marine-400 mt-1">
                            {relativeTime(n.created_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
