import { useEffect, useRef, useState } from "react";
import {
  HOTKEY_PRESETS,
  acceleratorFromEvent,
  applyHotkeyToRust,
  displayHotkey,
  getDefaultHotkey,
  getPlatform,
  getStoredHotkey,
  isValidAccelerator,
  setStoredHotkey,
} from "../lib/hotkey";

export function HotkeySettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const platform = getPlatform();
  const [current, setCurrent] = useState<string>(() => getStoredHotkey());
  const [error, setError] = useState<string | null>(null);
  // Quando capturing=true, o div abaixo escuta keydown e monta combo.
  const [capturing, setCapturing] = useState(false);
  const [pendingCombo, setPendingCombo] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, capturing]);

  // Quando entra em modo de captura, foca o div pra receber keydown.
  useEffect(() => {
    if (capturing) captureRef.current?.focus();
  }, [capturing]);

  if (!open) return null;

  async function applyAndStore(accel: string) {
    setError(null);
    const err = await applyHotkeyToRust(accel);
    if (err) {
      // Não persiste se Tauri rejeitou (ex.: combo em uso por outro app).
      setError(
        `Falha ao registrar atalho. Pode estar em uso por outro app. (${err})`,
      );
      return;
    }
    setStoredHotkey(accel);
    setCurrent(accel);
  }

  function startCapture() {
    setError(null);
    setPendingCombo(null);
    setCapturing(true);
  }

  function cancelCapture() {
    setCapturing(false);
    setPendingCombo(null);
  }

  async function commitCapture() {
    if (!pendingCombo || !isValidAccelerator(pendingCombo)) return;
    setCapturing(false);
    await applyAndStore(pendingCombo);
    setPendingCombo(null);
  }

  function handleCaptureKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelCapture();
      return;
    }
    if (e.key === "Enter" && pendingCombo) {
      e.preventDefault();
      void commitCapture();
      return;
    }
    e.preventDefault();
    const accel = acceleratorFromEvent(e.nativeEvent);
    if (accel) {
      setPendingCombo(accel);
    }
  }

  async function restoreDefault() {
    await applyAndStore(getDefaultHotkey());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-tng-marine-900/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[460px] max-w-[92vw] rounded-xl border border-tng-marine-600 bg-tng-marine-800 shadow-xl"
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
            Em qualquer lugar do sistema, pressione esta combinação para abrir
            a janela de captura.
          </p>

          {capturing ? (
            <div
              ref={captureRef}
              tabIndex={0}
              onKeyDown={handleCaptureKeyDown}
              onBlur={cancelCapture}
              className="my-5 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-tng-orange-400/60 bg-tng-orange-400/5 py-7 outline-none"
            >
              <div className="font-mono text-3xl tracking-widest text-tng-orange-400">
                {pendingCombo ? displayHotkey(pendingCombo, platform) : "…"}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-tng-marine-300">
                {pendingCombo
                  ? "Enter pra salvar, Esc pra cancelar"
                  : "Pressione a combinação desejada"}
              </div>
            </div>
          ) : (
            <div className="my-5 flex flex-col items-center gap-2">
              <div className="font-mono text-3xl tracking-widest text-tng-orange-400">
                {displayHotkey(current, platform)}
              </div>
              <button
                type="button"
                onClick={startCapture}
                className="rounded-md border border-tng-marine-600 px-3 py-1 text-[11px] text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
              >
                <i className="fa-solid fa-pen mr-1.5" aria-hidden="true" />
                Mudar atalho
              </button>
            </div>
          )}

          <div className="mt-2">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-400">
              Sugestões
            </div>
            <div className="grid grid-cols-2 gap-2">
              {HOTKEY_PRESETS.map((preset) => {
                const active = preset.accelerator === current;
                return (
                  <button
                    key={preset.accelerator}
                    type="button"
                    onClick={() => void applyAndStore(preset.accelerator)}
                    className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                      active
                        ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
                        : "border-tng-marine-600 text-tng-marine-200 hover:border-tng-orange-400/60 hover:text-tng-marine-50"
                    }`}
                  >
                    <div className="font-mono text-sm">
                      {displayHotkey(preset.accelerator, platform)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-tng-marine-400">
                      {preset.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

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
