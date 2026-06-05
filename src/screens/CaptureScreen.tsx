import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createDemand } from "../lib/demands";
import { extractDemand, type ExtractedDemand } from "../lib/ai";
import type { DemandPriority } from "../types/database";

type Mode = "input" | "confirm";

export function CaptureScreen() {
  const [mode, setMode] = useState<Mode>("input");
  const [text, setText] = useState("");
  const [extracted, setExtracted] = useState<ExtractedDemand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function closeWindow() {
    setText("");
    setExtracted(null);
    setError(null);
    setMode("input");
    setBusy(false);
    try {
      await invoke("hide_capture_window");
    } catch (err) {
      console.error("[Capture] hide failed:", err);
    }
  }

  async function runExtraction() {
    const trimmed = text.trim();
    if (!trimmed) {
      await closeWindow();
      return;
    }
    setBusy(true);
    setError(null);

    const result = await extractDemand(trimmed);

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return; // mantém modo input, usuário pode salvar manualmente
    }

    setExtracted(result.extracted);
    setMode("confirm");
  }

  async function saveManual() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    const { error } = await createDemand({
      description: trimmed,
      captured_via: "hotkey",
    });
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    await closeWindow();
  }

  async function saveExtracted(final: ExtractedDemand) {
    setBusy(true);
    setError(null);

    const { error } = await createDemand({
      description: final.descricao,
      title: final.descricao.slice(0, 80),
      priority: final.prioridade,
      due_date: final.prazo,
      tags: final.tags,
      captured_via: "hotkey",
    });

    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    await closeWindow();
  }

  if (mode === "confirm" && extracted) {
    return (
      <ConfirmView
        extracted={extracted}
        busy={busy}
        error={error}
        onCancel={() => void closeWindow()}
        onBack={() => {
          setMode("input");
          setExtracted(null);
        }}
        onConfirm={(final) => void saveExtracted(final)}
      />
    );
  }

  return (
    <InputView
      text={text}
      onTextChange={setText}
      busy={busy}
      error={error}
      onExtract={() => void runExtraction()}
      onCancel={() => void closeWindow()}
      onManualSave={() => void saveManual()}
    />
  );
}

// ---------------------------------------------------------------------------
// View 1 — Input
// ---------------------------------------------------------------------------

function InputView(props: {
  text: string;
  onTextChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onExtract: () => void;
  onCancel: () => void;
  onManualSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => textareaRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onExtract();
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
          value={props.text}
          onChange={(e) => props.onTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="O que precisa ser feito? Descreva a demanda…"
          disabled={props.busy}
          className="flex-1 resize-none bg-transparent px-5 py-4 text-sm leading-relaxed text-tng-marine-50 placeholder:text-tng-marine-300 focus:outline-none disabled:opacity-60"
        />

        {props.error && (
          <div className="border-t border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-300">
            <div className="flex items-center justify-between gap-3">
              <span>IA indisponível: {props.error}</span>
              <button
                onClick={props.onManualSave}
                disabled={props.busy || props.text.trim().length === 0}
                className="shrink-0 rounded bg-red-500/20 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/30 disabled:opacity-50"
              >
                Salvar mesmo assim
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-tng-marine-600/60 bg-tng-marine-800/40 px-5 py-3">
          <span className="text-[11px] text-tng-marine-300">
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">Esc</kbd> fecha &nbsp;·&nbsp;
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">Enter</kbd> processa com IA
          </span>
          <button
            type="button"
            onClick={props.onExtract}
            disabled={props.busy || props.text.trim().length === 0}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.busy ? "Processando…" : "Processar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 2 — Confirm
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS: { value: DemandPriority; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

function ConfirmView(props: {
  extracted: ExtractedDemand;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: (final: ExtractedDemand) => void;
}) {
  const [cliente, setCliente] = useState(props.extracted.cliente ?? "");
  const [responsavel, setResponsavel] = useState(props.extracted.responsavel ?? "");
  const [prioridade, setPrioridade] = useState<DemandPriority>(props.extracted.prioridade);
  const [prazo, setPrazo] = useState(props.extracted.prazo ?? "");
  const [descricao, setDescricao] = useState(props.extracted.descricao);
  const [tags, setTags] = useState(props.extracted.tags.join(", "));

  const conf = props.extracted.confianca;
  const lowConfidence = (v: number) => v < 0.7;

  function handleConfirm() {
    props.onConfirm({
      cliente: cliente.trim() || null,
      responsavel: responsavel.trim() || null,
      prioridade,
      prazo: prazo.trim() || null,
      descricao: descricao.trim(),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      confianca: conf,
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleConfirm();
    }
  }

  return (
    <div
      className="flex h-screen items-center justify-center bg-tng-marine-900 p-0"
      onKeyDown={handleKeyDown}
    >
      <div className="flex h-full w-full flex-col overflow-hidden border border-tng-marine-600/60 bg-tng-marine-700">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-tng-marine-600/60 px-5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium text-tng-marine-100">Revisar captura</span>
          </div>
          <button
            onClick={props.onBack}
            className="text-[10px] uppercase tracking-wider text-tng-marine-300 hover:text-tng-marine-100"
          >
            ← voltar
          </button>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto px-5 py-4">
          <Field
            label="Cliente"
            confidence={conf.cliente}
            warn={lowConfidence(conf.cliente)}
          >
            <input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="—"
              className={fieldClass(lowConfidence(conf.cliente))}
            />
          </Field>

          <Field
            label="Responsável"
            confidence={conf.responsavel}
            warn={lowConfidence(conf.responsavel)}
          >
            <input
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              placeholder="—"
              className={fieldClass(lowConfidence(conf.responsavel))}
            />
          </Field>

          <Field
            label="Prioridade"
            confidence={conf.prioridade}
            warn={lowConfidence(conf.prioridade)}
          >
            <select
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as DemandPriority)}
              className={fieldClass(lowConfidence(conf.prioridade))}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value} className="bg-tng-marine-800">
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Prazo"
            confidence={conf.prazo}
            warn={lowConfidence(conf.prazo)}
          >
            <input
              type="date"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              className={fieldClass(lowConfidence(conf.prazo))}
            />
          </Field>

          <div className="col-span-2">
            <Field label="Descrição">
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={3}
                className={`${fieldClass(false)} resize-none`}
              />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="Tags (separadas por vírgula)">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="design, cliente-externo"
                className={fieldClass(false)}
              />
            </Field>
          </div>
        </div>

        {props.error && (
          <div className="border-t border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-300">
            {props.error}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-tng-marine-600/60 bg-tng-marine-800/40 px-5 py-3">
          <span className="text-[11px] text-tng-marine-300">
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">Esc</kbd> cancela &nbsp;·&nbsp;
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">⌘↵</kbd> confirma
          </span>
          <button
            onClick={handleConfirm}
            disabled={props.busy || descricao.trim().length === 0}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.busy ? "Salvando…" : "Confirmar e enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  confidence,
  warn,
}: {
  label: string;
  children: React.ReactNode;
  confidence?: number;
  warn?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] uppercase tracking-wider text-tng-marine-300">
          {label}
        </label>
        {typeof confidence === "number" && (
          <span
            className={`text-[9px] ${warn ? "text-tng-orange-400" : "text-tng-marine-400"}`}
            title={`Confiança da IA: ${Math.round(confidence * 100)}%`}
          >
            {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function fieldClass(warn: boolean): string {
  return `block w-full rounded-md border ${
    warn ? "border-tng-orange-400/60" : "border-tng-marine-600"
  } bg-tng-marine-800 px-2.5 py-1.5 text-sm text-tng-marine-50 placeholder:text-tng-marine-300 focus:border-tng-orange-400 focus:outline-none focus:ring-1 focus:ring-tng-orange-400/30`;
}
