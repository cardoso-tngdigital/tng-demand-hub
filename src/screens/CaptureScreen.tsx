import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createDemand } from "../lib/demands";

export function CaptureScreen() {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-foco no input ao abrir
  useEffect(() => {
    const id = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, []);

  async function closeWindow() {
    setText("");
    setError(null);
    try {
      await invoke("hide_capture_window");
    } catch (err) {
      console.error("[Capture] hide failed:", err);
    }
  }

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) {
      await closeWindow();
      return;
    }
    setSubmitting(true);
    setError(null);

    const { error } = await createDemand({
      description: trimmed,
      captured_via: "hotkey",
    });

    setSubmitting(false);

    if (error) {
      setError(error);
      return;
    }

    await closeWindow();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      void closeWindow();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-tng-marine-900 p-0">
      <div className="flex h-full w-full flex-col overflow-hidden border border-tng-marine-600/60 bg-tng-marine-700">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-tng-marine-600/60 px-5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-tng-orange-400" />
            <span className="text-xs font-medium text-tng-marine-100">Nova captura</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-tng-marine-300">
            ⌘⇧D
          </span>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="O que precisa ser feito? Descreva a demanda…"
          disabled={submitting}
          className="flex-1 resize-none bg-transparent px-5 py-4 text-sm leading-relaxed text-tng-marine-50 placeholder:text-tng-marine-300 focus:outline-none disabled:opacity-60"
        />

        {error && (
          <div className="border-t border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-tng-marine-600/60 bg-tng-marine-800/40 px-5 py-3">
          <span className="text-[11px] text-tng-marine-300">
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">Esc</kbd> fecha &nbsp;·&nbsp;
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">Enter</kbd> envia
          </span>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || text.trim().length === 0}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Salvando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
