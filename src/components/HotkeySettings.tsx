import { useEffect, useRef, useState } from "react";
import {
  ALL_DOUBLE_TAP_MODIFIERS,
  HOTKEY_PRESETS,
  acceleratorFromEvent,
  applyDoubleTapToRust,
  applyHotkeyToRust,
  displayDoubleTap,
  displayHotkey,
  doubleTapLabel,
  getDefaultHotkey,
  getHotkeyMode,
  getPlatform,
  getStoredDoubleTap,
  getStoredHotkey,
  isValidAccelerator,
  setHotkeyMode,
  setStoredDoubleTap,
  setStoredHotkey,
  type DoubleTapModifier,
  type HotkeyMode,
} from "../lib/hotkey";

export function HotkeySettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const platform = getPlatform();
  const [mode, setMode] = useState<HotkeyMode>(() => getHotkeyMode());
  const [combo, setCombo] = useState<string>(() => getStoredHotkey());
  const [doubleTap, setDoubleTap] = useState<DoubleTapModifier>(() =>
    getStoredDoubleTap(),
  );
  const [error, setError] = useState<string | null>(null);

  // Captura de combo
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

  useEffect(() => {
    if (capturing) captureRef.current?.focus();
  }, [capturing]);

  if (!open) return null;

  // ----- Modo combo -----

  async function applyCombo(accel: string) {
    setError(null);
    const err = await applyHotkeyToRust(accel);
    if (err) {
      setError(
        `Falha ao registrar atalho. Pode estar em uso por outro app. (${err})`,
      );
      return;
    }
    setStoredHotkey(accel);
    setCombo(accel);
    setHotkeyMode("combo");
    setMode("combo");
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
    await applyCombo(pendingCombo);
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
    if (accel) setPendingCombo(accel);
  }

  // ----- Modo dupla pressão -----

  async function applyDoubleTap(modifier: DoubleTapModifier) {
    setError(null);
    const err = await applyDoubleTapToRust(modifier);
    if (err) {
      setError(`Falha ao ativar dupla pressão. (${err})`);
      return;
    }
    setStoredDoubleTap(modifier);
    setDoubleTap(modifier);
    setHotkeyMode("double-tap");
    setMode("double-tap");
  }

  // ----- Restaurar default geral -----

  async function restoreDefault() {
    await applyCombo(getDefaultHotkey());
  }

  // ----- Toggle de modo (sem trocar valor) -----

  async function switchToMode(target: HotkeyMode) {
    if (mode === target) return;
    setError(null);
    if (target === "double-tap") {
      const err = await applyDoubleTapToRust(doubleTap);
      if (err) {
        setError(`Falha ao ativar dupla pressão. (${err})`);
        return;
      }
    } else {
      const err = await applyHotkeyToRust(combo);
      if (err) {
        setError(`Falha ao registrar combinação. (${err})`);
        return;
      }
    }
    setHotkeyMode(target);
    setMode(target);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-tng-marine-900/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-[92vw] rounded-xl border border-tng-marine-600 bg-tng-marine-800 shadow-xl"
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
          {/* Toggle de modo */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-md border border-tng-marine-700 bg-tng-marine-900/40 p-1">
            <button
              type="button"
              onClick={() => void switchToMode("combo")}
              className={`rounded px-3 py-1.5 text-[11px] font-medium transition ${
                mode === "combo"
                  ? "bg-tng-orange-400 text-tng-marine-900"
                  : "text-tng-marine-200 hover:text-tng-marine-50"
              }`}
            >
              Combinação
            </button>
            <button
              type="button"
              onClick={() => void switchToMode("double-tap")}
              className={`rounded px-3 py-1.5 text-[11px] font-medium transition ${
                mode === "double-tap"
                  ? "bg-tng-orange-400 text-tng-marine-900"
                  : "text-tng-marine-200 hover:text-tng-marine-50"
              }`}
            >
              Dupla pressão
            </button>
          </div>

          {mode === "combo" ? (
            <ComboPane
              platform={platform}
              current={combo}
              capturing={capturing}
              pendingCombo={pendingCombo}
              captureRef={captureRef}
              onStartCapture={startCapture}
              onCaptureKeyDown={handleCaptureKeyDown}
              onCaptureBlur={cancelCapture}
              onPickPreset={(p) => void applyCombo(p)}
            />
          ) : (
            <DoubleTapPane
              platform={platform}
              current={doubleTap}
              onPick={(m) => void applyDoubleTap(m)}
            />
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

// ---------------------------------------------------------------------------
// Painel: combo tradicional (Cmd+Shift+D etc.)
// ---------------------------------------------------------------------------

function ComboPane(props: {
  platform: ReturnType<typeof getPlatform>;
  current: string;
  capturing: boolean;
  pendingCombo: string | null;
  captureRef: React.RefObject<HTMLDivElement | null>;
  onStartCapture: () => void;
  onCaptureKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCaptureBlur: () => void;
  onPickPreset: (accelerator: string) => void;
}) {
  return (
    <>
      <p className="text-[11px] text-tng-marine-300">
        Pressione esta combinação em qualquer lugar do sistema para abrir
        a janela de captura.
      </p>

      {props.capturing ? (
        <div
          ref={props.captureRef}
          tabIndex={0}
          onKeyDown={props.onCaptureKeyDown}
          onBlur={props.onCaptureBlur}
          className="my-5 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-tng-orange-400/60 bg-tng-orange-400/5 py-7 outline-none"
        >
          <div className="font-mono text-3xl tracking-widest text-tng-orange-400">
            {props.pendingCombo
              ? displayHotkey(props.pendingCombo, props.platform)
              : "…"}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-tng-marine-300">
            {props.pendingCombo
              ? "Enter pra salvar, Esc pra cancelar"
              : "Pressione a combinação desejada"}
          </div>
        </div>
      ) : (
        <div className="my-5 flex flex-col items-center gap-2">
          <div className="font-mono text-3xl tracking-widest text-tng-orange-400">
            {displayHotkey(props.current, props.platform)}
          </div>
          <button
            type="button"
            onClick={props.onStartCapture}
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
            const active = preset.accelerator === props.current;
            return (
              <button
                key={preset.accelerator}
                type="button"
                onClick={() => props.onPickPreset(preset.accelerator)}
                className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                  active
                    ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
                    : "border-tng-marine-600 text-tng-marine-200 hover:border-tng-orange-400/60 hover:text-tng-marine-50"
                }`}
              >
                <div className="font-mono text-sm">
                  {displayHotkey(preset.accelerator, props.platform)}
                </div>
                <div className="mt-0.5 text-[10px] text-tng-marine-400">
                  {preset.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Painel: dupla pressão de modificador (option+option etc.)
// ---------------------------------------------------------------------------

function DoubleTapPane(props: {
  platform: ReturnType<typeof getPlatform>;
  current: DoubleTapModifier;
  onPick: (mod: DoubleTapModifier) => void;
}) {
  return (
    <>
      <p className="text-[11px] text-tng-marine-300">
        Pressione esta tecla <strong>duas vezes</strong> em qualquer lugar
        do sistema para abrir a captura. Ergonomia similar ao Claude Desktop.
      </p>

      <div className="my-5 flex flex-col items-center gap-2">
        <div className="font-mono text-3xl tracking-widest text-tng-orange-400">
          {displayDoubleTap(props.current, props.platform)}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-tng-marine-400">
          {doubleTapLabel(props.current, props.platform)} duas vezes
        </div>
      </div>

      <div className="mt-2">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-400">
          Escolher tecla
        </div>
        <div className="grid grid-cols-2 gap-2">
          {ALL_DOUBLE_TAP_MODIFIERS.map((mod) => {
            const active = props.current === mod;
            return (
              <button
                key={mod}
                type="button"
                onClick={() => props.onPick(mod)}
                className={`rounded-md border px-3 py-2 text-xs transition ${
                  active
                    ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
                    : "border-tng-marine-600 text-tng-marine-200 hover:border-tng-orange-400/60 hover:text-tng-marine-50"
                }`}
              >
                <div className="font-mono text-base">
                  {displayDoubleTap(mod, props.platform)}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-tng-marine-400">
                  {doubleTapLabel(mod, props.platform)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
