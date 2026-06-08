import { useEffect, useState } from "react";
import {
  ALL_MODIFIERS,
  applyHotkeyToRust,
  checkAccessibilityPermission,
  displayHotkey,
  getDefaultHotkey,
  getPlatform,
  getStoredHotkey,
  modifierLabel,
  setStoredHotkey,
  type HotkeyModifier,
} from "../lib/hotkey";

export function HotkeySettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const platform = getPlatform();
  const [selected, setSelected] = useState<HotkeyModifier>(() => getStoredHotkey());
  const [error, setError] = useState<string | null>(null);
  // Status da permissão Accessibility no macOS. null = ainda checando.
  const [accessibility, setAccessibility] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Checa permissão silenciosa quando o modal abre — não dispara prompt
  // automático. O user clica "Solicitar permissão" pra disparar.
  useEffect(() => {
    if (!open) return;
    if (platform !== "macos") {
      setAccessibility(true);
      return;
    }
    void (async () => {
      const ok = await checkAccessibilityPermission(false);
      setAccessibility(ok);
    })();
  }, [open, platform]);

  if (!open) return null;

  async function pickModifier(mod: HotkeyModifier) {
    setError(null);
    setSelected(mod);
    setStoredHotkey(mod);
    const err = await applyHotkeyToRust(mod);
    if (err) setError(err);
  }

  async function restoreDefault() {
    await pickModifier(getDefaultHotkey(platform));
  }

  async function requestPermission() {
    const ok = await checkAccessibilityPermission(true);
    setAccessibility(ok);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-tng-marine-900/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] rounded-xl border border-tng-marine-600 bg-tng-marine-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-tng-marine-700 px-5 py-3">
          <h2 className="font-sans text-sm font-semibold text-tng-marine-50">
            Atalho da captura
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="px-5 py-5">
          <p className="text-[11px] text-tng-marine-300">
            Pressione a tecla escolhida <strong>duas vezes</strong> em
            qualquer lugar do sistema para abrir a janela de captura.
          </p>

          <div className="my-5 flex flex-col items-center gap-2">
            <div className="font-mono text-3xl tracking-widest text-tng-orange-400">
              {displayHotkey(selected, platform)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-tng-marine-400">
              {modifierLabel(selected, platform)} duas vezes
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ALL_MODIFIERS.map((mod) => {
              const active = selected === mod;
              return (
                <button
                  key={mod}
                  type="button"
                  onClick={() => void pickModifier(mod)}
                  className={`rounded-md border px-3 py-2 text-xs transition ${
                    active
                      ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
                      : "border-tng-marine-600 text-tng-marine-200 hover:border-tng-orange-400/60 hover:text-tng-marine-50"
                  }`}
                >
                  <div className="font-mono text-base">
                    {displayHotkey(mod, platform)}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider text-tng-marine-400">
                    {modifierLabel(mod, platform)}
                  </div>
                </button>
              );
            })}
          </div>

          {platform === "macos" && accessibility === false && (
            <div className="mt-4 rounded-md border border-tng-orange-400/40 bg-tng-orange-400/10 px-3 py-2 text-[11px] text-tng-orange-200">
              <p className="font-medium">Permissão de Acessibilidade pendente</p>
              <p className="mt-1 text-tng-orange-300/90">
                Sem ela o macOS não permite que o app detecte teclas globais.
                Abra <em>Ajustes do Sistema → Privacidade e Segurança →
                Acessibilidade</em> e ative o TNG Sites — Demandas.
              </p>
              <button
                type="button"
                onClick={() => void requestPermission()}
                className="mt-2 rounded bg-tng-orange-400/20 px-2 py-1 text-[10px] font-medium text-tng-orange-100 hover:bg-tng-orange-400/30"
              >
                Solicitar permissão
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void restoreDefault()}
              className="text-[10px] uppercase tracking-wider text-tng-marine-400 hover:text-tng-marine-100"
            >
              Restaurar padrão
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-[11px] font-semibold text-tng-marine-900 hover:bg-tng-orange-300"
            >
              Concluído
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
