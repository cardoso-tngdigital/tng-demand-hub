import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { createDemand } from "../lib/demands";
import { extractDemand, type ExtractedDemand } from "../lib/ai";
import { supabase } from "../lib/supabase/client";
import {
  buildPendingAttachment,
  categoryIconClass,
  disposePending,
  formatBytes,
  INLINE_PER_FILE_BYTES,
  MAX_INLINE_TOTAL_BYTES,
  materializeAttachmentsForExtraction,
  pickFilesNative,
  uploadAttachment,
  uploadAttachmentFromTmp,
  type PendingAttachment,
  type StorageAttachment,
} from "../lib/attachments";
import {
  listActiveClients,
  listActiveProfiles,
  subscribeToActiveClients,
  subscribeToActiveProfiles,
  type ClientOption,
  type ProfileOption,
} from "../lib/lookups";
import {
  applyRules,
  listActiveRules,
  type AppliedRuleEntry,
} from "../lib/classificationRules";
import type {
  ClassificationRule,
  DemandInfrastructure,
  DemandPriority,
} from "../types/database";

/**
 * Resolve um nome retornado pela IA contra a lista cadastrada — primeiro
 * tenta match exato (case insensitive) por nome ou alias, depois match
 * parcial. Retorna o id do cadastro encontrado ou null.
 */
function matchByName<T extends { id: string; name: string; alias?: string | null }>(
  raw: string | null,
  items: T[],
): string | null {
  if (!raw) return null;
  const norm = raw.toLowerCase().trim();
  if (!norm) return null;
  for (const i of items) {
    if (i.name.toLowerCase() === norm) return i.id;
    if (i.alias && i.alias.toLowerCase() === norm) return i.id;
  }
  for (const i of items) {
    const n = i.name.toLowerCase();
    if (n.includes(norm) || norm.includes(n)) return i.id;
    if (i.alias) {
      const a = i.alias.toLowerCase();
      if (a.includes(norm) || norm.includes(a)) return i.id;
    }
  }
  return null;
}

function matchClient(name: string | null, clients: ClientOption[]): string | null {
  return matchByName(name, clients);
}

function matchProfile(name: string | null, profiles: ProfileOption[]): string | null {
  if (!name) return null;
  return matchByName(
    name,
    profiles.map((p) => ({ id: p.id, name: p.full_name, alias: null })),
  );
}

export type ConfirmedDemand = {
  titulo: string;
  descricao: string;
  prioridade: DemandPriority;
  prazo: string | null;
  tags: string[];
  clientId: string | null;
  assigneeId: string | null;
  infraestrutura: DemandInfrastructure | null;
};

/** Valores iniciais já com matching nome→id e regras aplicadas. */
type Initial = {
  titulo: string;
  descricao: string;
  prazo: string | null;
  prioridade: DemandPriority;
  tags: string[];
  infraestrutura: DemandInfrastructure | null;
  clientId: string | null;
  assigneeId: string | null;
  appliedRules: AppliedRuleEntry[];
};

type Mode = "input" | "confirm";

export function CaptureScreen() {
  const [mode, setMode] = useState<Mode>("input");
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [extracted, setExtracted] = useState<ExtractedDemand | null>(null);
  const [initial, setInitial] = useState<Initial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  // pending.id → referência no Storage tmp (set por anexos grandes durante
  // a extração). Usado depois pra decidir entre uploadAttachment (inline
  // já materializado) vs uploadAttachmentFromTmp (apenas move).
  const [storageMap, setStorageMap] = useState<Map<string, StorageAttachment>>(
    () => new Map(),
  );

  // Carrega lookups e regras no mount, depois subscreve realtime de clients
  // e profiles para refletir CRUDs feitos em outras janelas/usuários sem
  // exigir recarregar o app (a janela 'capture' fica viva escondida).
  useEffect(() => {
    (async () => {
      const [c, p, r] = await Promise.all([
        listActiveClients(),
        listActiveProfiles(),
        listActiveRules(),
      ]);
      setClients(c);
      setProfiles(p);
      setRules(r);
    })();
    const unsubClients = subscribeToActiveClients(setClients);
    const unsubProfiles = subscribeToActiveProfiles(setProfiles);
    return () => {
      unsubClients();
      unsubProfiles();
    };
  }, []);

  // Garante que object URLs criados para preview sejam liberados na desmontagem.
  useEffect(() => {
    return () => {
      attachments.forEach(disposePending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    const errors: string[] = [];
    const accepted: PendingAttachment[] = [];
    // buildPendingAttachment materializa os bytes (await) — evita
    // "I/O read operation failed" quando o File vem do clipboard e expira.
    for (const f of list) {
      const result = await buildPendingAttachment(f);
      if ("error" in result) errors.push(`${f.name}: ${result.error}`);
      else accepted.push(result);
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
    if (errors.length > 0) {
      setError(errors.join(" · "));
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) disposePending(found);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  async function closeWindow() {
    attachments.forEach(disposePending);
    // Best-effort: apaga arquivos órfãos no Storage tmp caso o usuário tenha
    // gerado uploads e cancelado a captura. Falha silenciosa — o cleanup
    // periódico do bucket pega o que sobrar.
    const orphanPaths = Array.from(storageMap.values()).map((s) => s.storagePath);
    if (orphanPaths.length > 0) {
      void supabase.storage.from("attachments").remove(orphanPaths).catch(() => {});
    }
    setText("");
    setAttachments([]);
    setExtracted(null);
    setInitial(null);
    setError(null);
    setMode("input");
    setBusy(false);
    setStorageMap(new Map());
    try {
      await invoke("hide_capture_window");
    } catch (err) {
      console.error("[Capture] hide failed:", err);
    }
  }

  async function runExtraction() {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) {
      await closeWindow();
      return;
    }
    if (!trimmed) {
      setError("Adicione um texto descrevendo a captura.");
      return;
    }

    // Limite cumulativo só vale pros que vão inline (pequenos). Os grandes
    // entram pela Files API e não competem por esse orçamento.
    const inlineBytes = attachments
      .filter((a) => a.file.size < INLINE_PER_FILE_BYTES)
      .reduce((sum, a) => sum + a.file.size, 0);
    if (inlineBytes > MAX_INLINE_TOTAL_BYTES) {
      const limitMb = Math.round(MAX_INLINE_TOTAL_BYTES / 1024 / 1024);
      setError(
        `Anexos pequenos somam ${(inlineBytes / 1024 / 1024).toFixed(1)} MB — a IA aceita até ${limitMb} MB inline. Remova ou reduza algum.`,
      );
      return;
    }

    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      setError("Sessão expirada. Faça login novamente.");
      return;
    }

    let materialized;
    try {
      materialized = await materializeAttachmentsForExtraction(attachments, user.id);
    } catch (err) {
      setBusy(false);
      setError(`Falha ao preparar anexos: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (materialized.errors.length > 0) {
      setBusy(false);
      setError(`Falha no upload de anexo: ${materialized.errors.join(" · ")}`);
      return;
    }

    // Indexa os storage uploads — uploadAll precisa saber, ao fim, se cada
    // anexo já está no Storage (move) ou ainda precisa ir (upload completo).
    setStorageMap(new Map(materialized.storage.map((s) => [s.id, s])));

    const result = await extractDemand(
      trimmed,
      materialized.inline,
      materialized.storage,
      materialized.texts,
    );

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Matching nome→id e aplicação das regras de auto-classificação
    const e = result.extracted;
    const matchedClientId = matchClient(e.cliente, clients);
    const matchedAssigneeId = matchProfile(e.responsavel, profiles);

    const { result: applied, applied: appliedRules } = applyRules(
      {
        descricao: e.descricao,
        cliente: e.cliente,
        clientId: matchedClientId,
        responsavel: e.responsavel,
        assigneeId: matchedAssigneeId,
        prioridade: e.prioridade,
        tags: [...e.tags],
      },
      rules,
      clients,
    );

    setExtracted(e);
    setInitial({
      titulo: e.titulo,
      descricao: applied.descricao,
      prazo: e.prazo,
      prioridade: applied.prioridade,
      tags: applied.tags,
      clientId: applied.clientId,
      assigneeId: applied.assigneeId,
      infraestrutura: e.infraestrutura,
      appliedRules,
    });
    setMode("confirm");
  }

  /**
   * Vincula cada anexo pendente à demanda recém-criada. Pequenos (inline)
   * fazem upload completo agora; grandes (já no tmp do Storage) só são
   * movidos pro path final via storage.move(). Falhas individuais não
   * impedem as demais — a demanda em si já está salva.
   */
  async function uploadAll(demandId: string, userId: string): Promise<string[]> {
    if (attachments.length === 0) return [];
    const results = await Promise.all(
      attachments.map((a) => {
        const fromTmp = storageMap.get(a.id);
        if (fromTmp) return uploadAttachmentFromTmp(fromTmp, demandId, userId);
        return uploadAttachment(a, demandId, userId);
      }),
    );
    // Os arquivos do tmp já foram movidos pra path final pelo
    // uploadAttachmentFromTmp; zeramos o mapa pra que o closeWindow
    // não tente apagá-los como órfãos.
    setStorageMap(new Map());
    return results
      .map((r, i) => (r.ok ? null : `${attachments[i].file.name}: ${r.error}`))
      .filter((m): m is string => m !== null);
  }

  async function saveManual() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    const { data, error } = await createDemand({
      description: trimmed,
      captured_via: "hotkey",
    });
    if (error || !data) {
      setBusy(false);
      setError(error ?? "Falha ao salvar demanda.");
      return;
    }
    const uploadErrors = await uploadAll(data.id, data.created_by);
    setBusy(false);
    if (uploadErrors.length > 0) {
      setError(`Demanda salva, mas falhou: ${uploadErrors.join(" · ")}`);
      return;
    }
    await closeWindow();
  }

  async function saveExtracted(final: ConfirmedDemand) {
    setBusy(true);
    setError(null);

    const { data, error } = await createDemand({
      description: final.descricao,
      // Título gerado pela IA é o ponto de partida; usamos a primeira linha
      // da descrição como fallback se vier vazio depois da revisão.
      title: final.titulo.trim() || final.descricao.slice(0, 80),
      priority: final.prioridade,
      due_date: final.prazo,
      tags: final.tags,
      client_id: final.clientId,
      assignee_id: final.assigneeId,
      infrastructure: final.infraestrutura,
      captured_via: "hotkey",
    });

    if (error || !data) {
      setBusy(false);
      setError(error ?? "Falha ao salvar demanda.");
      return;
    }

    const uploadErrors = await uploadAll(data.id, data.created_by);
    setBusy(false);
    if (uploadErrors.length > 0) {
      setError(`Demanda salva, mas falhou: ${uploadErrors.join(" · ")}`);
      return;
    }
    await closeWindow();
  }

  if (mode === "confirm" && extracted && initial) {
    return (
      <ConfirmView
        extracted={extracted}
        initial={initial}
        clients={clients}
        profiles={profiles}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        busy={busy}
        error={error}
        onCancel={() => void closeWindow()}
        onBack={() => {
          setMode("input");
          setExtracted(null);
          setInitial(null);
        }}
        onConfirm={(final) => void saveExtracted(final)}
      />
    );
  }

  return (
    <InputView
      text={text}
      onTextChange={setText}
      attachments={attachments}
      onAddFiles={addFiles}
      onRemoveAttachment={removeAttachment}
      onPickerError={setError}
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
  attachments: PendingAttachment[];
  onAddFiles: (files: FileList | File[]) => Promise<void>;
  onRemoveAttachment: (id: string) => void;
  onPickerError: (msg: string) => void;
  busy: boolean;
  error: string | null;
  onExtract: () => void;
  onCancel: () => void;
  onManualSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Foca o textarea no mount e toda vez que a janela ganha foco — a
  // janela 'capture' do Tauri fica viva escondida entre invocações do
  // atalho global, então o useEffect roda só uma vez; sem o listener de
  // focus, o usuário precisaria clicar pra digitar nas próximas aberturas.
  useEffect(() => {
    function focusTextarea() {
      window.setTimeout(() => textareaRef.current?.focus(), 30);
    }
    focusTextarea();
    window.addEventListener("focus", focusTextarea);
    return () => window.removeEventListener("focus", focusTextarea);
  }, []);

  // Atalhos globais (window) — sobrevivem ao foco sair do textarea, ex.:
  // depois de clicar em "Salvar mesmo assim" ou em links no rodapé de erro.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onCancel();
      } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") return; // textarea já trata
        e.preventDefault();
        props.onExtract();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onCancel, props.onExtract]);

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

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      void props.onAddFiles(files);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void props.onAddFiles(e.dataTransfer.files);
    }
  }

  async function handlePickFiles() {
    const { files, errors } = await pickFilesNative();
    console.log("[InputView.handlePickFiles] files:", files.length, "errors:", errors);
    if (files.length > 0) await props.onAddFiles(files);
    if (errors.length > 0) {
      props.onPickerError(errors.join(" · "));
    }
  }

  const canSubmit = props.text.trim().length > 0;

  return (
    <div
      className="flex h-screen items-center justify-center bg-transparent p-2"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-tng-marine-700 shadow-2xl shadow-black/40 transition ${
          dragOver ? "border-tng-orange-400" : "border-tng-marine-600/60"
        }`}
      >
        <div
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-tng-marine-600/60 px-5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-tng-orange-400" />
            <span className="text-xs font-medium text-tng-marine-100">Nova captura</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-tng-marine-300">
              ⌘⇧D
            </span>
            <button
              type="button"
              onClick={props.onCancel}
              aria-label="Fechar"
              className="rounded-md p-1 text-tng-marine-300 hover:bg-tng-marine-600/40 hover:text-tng-marine-100"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />            </button>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={props.text}
          onChange={(e) => props.onTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="O que precisa ser feito? Descreva a demanda…"
          disabled={props.busy}
          className="flex-1 resize-none bg-transparent px-5 py-4 text-sm leading-relaxed text-tng-marine-50 placeholder:text-tng-marine-300 focus:outline-none disabled:opacity-60"
        />

        {props.attachments.length > 0 && (
          <ul className="max-h-32 overflow-y-auto border-t border-tng-marine-600/60 px-3 py-2 space-y-1">
            {props.attachments.map((a) => (
              <AttachmentRow
                key={a.id}
                pending={a}
                onRemove={() => props.onRemoveAttachment(a.id)}
              />
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-tng-marine-600/60 bg-tng-marine-800/40 px-5 py-2">
          <span className="text-[11px] text-tng-marine-300">
            {dragOver ? (
              <span className="text-tng-orange-400">Solte para anexar…</span>
            ) : (
              <><i className="fa-solid fa-paperclip mr-1" aria-hidden="true" /> Cole, arraste arquivos ou{" "}
                <button
                  type="button"
                  onClick={() => void handlePickFiles()}
                  className="underline-offset-2 hover:underline focus:underline focus:outline-none"
                >
                  escolha
                </button>
                <span className="ml-2 text-tng-marine-400">· Máx. 50MB por arquivo</span>
                {props.attachments.length > 0 && (
                  <span className="ml-2 text-tng-marine-400">
                    · {props.attachments.length} anexo
                    {props.attachments.length > 1 ? "s" : ""}
                  </span>
                )}
              </>
            )}
          </span>
        </div>

        {props.error && (
          <div className="border-t border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-300">
            <div className="flex items-center justify-between gap-3">
              <span>{props.error.includes("IA") || props.error.includes("Edge")
                ? `IA indisponível: ${props.error}`
                : props.error}</span>
              <button
                onClick={props.onManualSave}
                disabled={props.busy || !canSubmit}
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
            disabled={props.busy || !canSubmit}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.busy ? "Processando…" : "Processar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AttachmentRow({
  pending,
  onRemove,
}: {
  pending: PendingAttachment;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md bg-tng-marine-800/60 px-2 py-1.5 text-xs">
      {pending.previewUrl ? (
        <img
          src={pending.previewUrl}
          alt=""
          className="h-7 w-7 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-tng-marine-700 text-sm text-tng-marine-200">
          <i className={categoryIconClass(pending.category)} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-tng-marine-100">{pending.file.name}</p>
        <p className="text-[10px] text-tng-marine-300">{formatBytes(pending.file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remover ${pending.file.name}`}
        className="shrink-0 rounded p-1 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
      >
        <i className="fa-solid fa-xmark" aria-hidden="true" />      </button>
    </li>
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
  initial: Initial;
  clients: ClientOption[];
  profiles: ProfileOption[];
  attachments: PendingAttachment[];
  onRemoveAttachment: (id: string) => void;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: (final: ConfirmedDemand) => void;
}) {
  const [clientId, setClientId] = useState<string>(props.initial.clientId ?? "");
  const [assigneeId, setAssigneeId] = useState<string>(props.initial.assigneeId ?? "");
  const [prioridade, setPrioridade] = useState<DemandPriority>(props.initial.prioridade);
  const [prazo, setPrazo] = useState(props.initial.prazo ?? "");
  const [titulo, setTitulo] = useState(props.initial.titulo);
  const [descricao, setDescricao] = useState(props.initial.descricao);
  const [tags, setTags] = useState(props.initial.tags.join(", "));
  const [infraestrutura, setInfraestrutura] = useState<DemandInfrastructure | "">(
    props.initial.infraestrutura ?? "",
  );

  const conf = props.extracted.confianca;
  const lowConfidence = (v: number) => v < 0.7;

  const clienteHint =
    props.extracted.cliente && !clientId
      ? `IA sugeriu "${props.extracted.cliente}", mas não há cliente cadastrado com esse nome.`
      : null;
  const responsavelHint =
    props.extracted.responsavel && !assigneeId
      ? `IA sugeriu "${props.extracted.responsavel}", mas não há membro com esse nome.`
      : null;

  function handleConfirm() {
    props.onConfirm({
      titulo: titulo.trim(),
      prioridade,
      prazo: prazo.trim() || null,
      descricao: descricao.trim(),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      clientId: clientId || null,
      assigneeId: assigneeId || null,
      infraestrutura: infraestrutura || null,
    });
  }

  // Atalhos globais (window) — Esc fecha, ⌘↵ confirma. Substituem o
  // onKeyDown no div raiz, que só dispara quando o foco está no div.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleConfirm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleConfirm fecha sobre o estado local — recriado a cada render;
    // listamos as deps explícitas para evitar capturar valores antigos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, assigneeId, prioridade, prazo, titulo, descricao, tags, infraestrutura, props.onCancel]);

  return (
    <div className="flex h-screen items-center justify-center bg-transparent p-2">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-tng-marine-600/60 bg-tng-marine-700 shadow-2xl shadow-black/40">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-tng-marine-600/60 px-5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium text-tng-marine-100">Revisar captura</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={props.onBack}
              className="text-[10px] uppercase tracking-wider text-tng-marine-300 hover:text-tng-marine-100"
            >
              ← voltar
            </button>
            <button
              type="button"
              onClick={props.onCancel}
              aria-label="Fechar"
              className="rounded-md p-1 text-tng-marine-300 hover:bg-tng-marine-600/40 hover:text-tng-marine-100"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />            </button>
          </div>
        </div>

        {props.initial.appliedRules.length > 0 && (
          <div className="border-b border-tng-orange-400/30 bg-tng-orange-400/10 px-5 py-2 text-[10px] text-tng-orange-200">
            <span className="font-medium">Regra(s) aplicada(s):</span>{" "}
            {props.initial.appliedRules.map((a) => a.ruleName).join(", ")}
          </div>
        )}

        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto px-5 py-4">
          <Field
            label="Cliente"
            confidence={conf.cliente}
            warn={lowConfidence(conf.cliente) || !!clienteHint}
            hint={clienteHint}
          >
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={`tng-select ${fieldClass(lowConfidence(conf.cliente) || !!clienteHint)}`}
            >
              <option value="" className="bg-tng-marine-800">— Sem cliente</option>
              {props.clients.map((c) => (
                <option key={c.id} value={c.id} className="bg-tng-marine-800">
                  {c.alias || c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Responsável"
            confidence={conf.responsavel}
            warn={lowConfidence(conf.responsavel) || !!responsavelHint}
            hint={responsavelHint}
          >
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className={`tng-select ${fieldClass(lowConfidence(conf.responsavel) || !!responsavelHint)}`}
            >
              <option value="" className="bg-tng-marine-800">— Sem responsável</option>
              {props.profiles.map((p) => (
                <option key={p.id} value={p.id} className="bg-tng-marine-800">
                  {p.full_name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Prioridade"
            confidence={conf.prioridade}
            warn={lowConfidence(conf.prioridade)}
          >
            <select
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as DemandPriority)}
              className={`tng-select ${fieldClass(lowConfidence(conf.prioridade))}`}
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
            <Field label="Título">
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={80}
                placeholder="Verbo + objeto, ex.: Ajustar banner do header"
                className={fieldClass(false)}
              />
            </Field>
          </div>

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

          <Field label="Infraestrutura">
            <select
              value={infraestrutura}
              onChange={(e) =>
                setInfraestrutura(e.target.value as DemandInfrastructure | "")
              }
              className={`tng-select ${fieldClass(false)}`}
            >
              <option value="" className="bg-tng-marine-800">— Não classificada</option>
              <option value="wordpress" className="bg-tng-marine-800">WordPress</option>
              <option value="site_ia" className="bg-tng-marine-800">Site com IA</option>
            </select>
          </Field>

          <Field label="Tags (separadas por vírgula)">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="design, cliente-externo"
              className={fieldClass(false)}
            />
          </Field>

          {props.attachments.length > 0 && (
            <div className="col-span-2">
              <Field label={`Anexos (${props.attachments.length})`}>
                <ul className="space-y-1">
                  {props.attachments.map((a) => (
                    <AttachmentRow
                      key={a.id}
                      pending={a}
                      onRemove={() => props.onRemoveAttachment(a.id)}
                    />
                  ))}
                </ul>
              </Field>
            </div>
          )}
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
  hint,
}: {
  label: string;
  children: React.ReactNode;
  confidence?: number;
  warn?: boolean;
  hint?: string | null;
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
      {hint && <p className="text-[9px] text-tng-orange-300">{hint}</p>}
    </div>
  );
}

function fieldClass(warn: boolean): string {
  return `block w-full rounded-md border ${
    warn ? "border-tng-orange-400/60" : "border-tng-marine-600"
  } bg-tng-marine-800 px-2.5 py-1.5 text-sm text-tng-marine-50 placeholder:text-tng-marine-300 focus:border-tng-orange-400 focus:outline-none focus:ring-1 focus:ring-tng-orange-400/30`;
}
