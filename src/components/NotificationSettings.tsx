// =============================================================================
// NotificationSettings — modal de preferências de notificação
// =============================================================================
// Toggles persistidos em `profiles.notifications` JSONB. RLS profiles_update_own
// garante que cada user só altera o próprio registro. As preferências entram
// em vigor na próxima notificação — não invalidam as já agendadas.
// =============================================================================

import { useEffect, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "../types/database";
import { getMyProfile, updateMyNotifications } from "../lib/profiles";
import { ensureNotificationPermission, notify } from "../lib/notifications";

export function NotificationSettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    void (async () => {
      const { data, error } = await getMyProfile();
      if (error) setError(error);
      else if (data?.notifications) {
        setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...data.notifications });
      }
      setLoading(false);
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save(next: NotificationPrefs) {
    setPrefs(next);
    setSaving(true);
    setError(null);
    const { error } = await updateMyNotifications(next);
    setSaving(false);
    if (error) setError(error);
  }

  function toggle(key: keyof NotificationPrefs) {
    // `mentions` é opcional no tipo — fallback pra true quando ausente.
    const current = prefs[key] ?? true;
    void save({ ...prefs, [key]: !current });
  }

  // Dispara uma notificação nativa de teste. Isola o caminho do SO (permissão +
  // banner) do caminho do realtime: se o teste aparece, o sistema de
  // notificações funciona e um eventual problema está na entrega em tempo real.
  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    const granted = await ensureNotificationPermission();
    if (!granted) {
      setTestMsg({
        ok: false,
        text: "Permissão negada pelo sistema. Ative as notificações do app 'TNG Sites - Demandas' nas configurações do seu sistema operacional.",
      });
      setTesting(false);
      return;
    }
    await notify(
      "TNG Sites - Demandas",
      "Notificação de teste — se você está vendo isto, o sistema de notificações está funcionando. ✅",
    );
    setTestMsg({
      ok: true,
      text: "Enviada! Se o banner não apareceu, verifique as notificações do app nas configurações do sistema operacional.",
    });
    setTesting(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-tng-marine-600 bg-tng-marine-800 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-tng-marine-700 px-5 py-3">
          <h2 className="font-sans text-sm font-semibold text-tng-marine-50">
            Notificações
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-tng-marine-400 transition hover:text-tng-marine-100"
            aria-label="Fechar"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          {loading ? (
            <p className="text-xs text-tng-marine-300">Carregando preferências…</p>
          ) : (
            <>
              <p className="text-[11px] text-tng-marine-400">
                Escolha quais notificações deseja receber. Mudanças entram em
                vigor na próxima notificação.
              </p>
              <ToggleRow
                label="Demandas atribuídas a mim"
                description="Quando alguém me marca como responsável."
                checked={prefs.assigned}
                onToggle={() => toggle("assigned")}
              />
              <ToggleRow
                label="Prazos próximos"
                description="Aviso 5 dias, 3 dias e 24h antes do vencimento."
                checked={prefs.due_soon}
                onToggle={() => toggle("due_soon")}
              />
              <ToggleRow
                label="Comentários"
                description="Novos comentários em demandas que estou envolvido."
                checked={prefs.comments}
                onToggle={() => toggle("comments")}
              />
              <ToggleRow
                label="Menções (@usuario)"
                description="Quando alguém me marca em um comentário."
                checked={prefs.mentions ?? true}
                onToggle={() => toggle("mentions")}
              />
              <ToggleRow
                label="Demandas concluídas"
                description="Quando uma demanda que criei é marcada como concluída."
                checked={prefs.completed}
                onToggle={() => toggle("completed")}
              />
            </>
          )}
          <div className="border-t border-tng-marine-700 pt-3">
            <button
              type="button"
              onClick={() => void sendTest()}
              disabled={testing}
              className="w-full rounded-md border border-tng-marine-600 bg-tng-marine-700/40 px-3 py-2 text-xs font-medium text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-white disabled:opacity-50"
            >
              <i className="fa-solid fa-bell mr-2" aria-hidden="true" />
              {testing ? "Enviando…" : "Enviar notificação de teste"}
            </button>
            {testMsg && (
              <p
                className={`mt-2 rounded-md border px-3 py-2 text-[10px] ${
                  testMsg.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {testMsg.text}
              </p>
            )}
          </div>
          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end border-t border-tng-marine-700 bg-tng-marine-800/60 px-5 py-2 text-[10px] text-tng-marine-400">
          {saving ? "Salvando…" : "Mudanças salvas automaticamente"}
        </footer>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-tng-marine-700 bg-tng-marine-800/40 px-3 py-2 transition hover:border-tng-marine-500">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-tng-marine-50">{label}</p>
        <p className="mt-0.5 text-[10px] text-tng-marine-400">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-tng-orange-400" : "bg-tng-marine-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}
