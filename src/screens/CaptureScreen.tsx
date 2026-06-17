import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  createDemand,
  listDemands,
  subscribeToDemands,
  updateDemand,
} from "../lib/demands";
import { createComment } from "../lib/comments";
import { extractDemand, type ExtractedDemand } from "../lib/ai";
import { findCandidateDemands } from "../lib/demandSearch";
import {
  diffDemand,
  diffsToPatch,
  type FieldDiff,
} from "../lib/demandEdit";
import { htmlToPlainText, legacyToHtml } from "../lib/htmlContent";
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
  readPathsAsFiles,
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
  Demand,
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

// "input" mostra o textarea. "target" só aparece quando a IA detecta
// intencao=editar|comentar e precisa que o user confirme qual demanda
// existente é o alvo. "confirm" é a tela final de revisão (criar/editar/
// comentar, view varia por intencao).
type Mode = "input" | "target" | "confirm";

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
  // Lista de todas as demandas. Necessária pra fluxos de editar/comentar
  // — usamos pra filtrar candidatas localmente antes de mostrar pro user.
  // Mantida em sync via realtime de demands.
  const [allDemands, setAllDemands] = useState<Demand[]>([]);
  const [candidates, setCandidates] = useState<Demand[]>([]);
  const [targetDemand, setTargetDemand] = useState<Demand | null>(null);
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

  // Carrega lista de demandas (cap 200) + realtime. Usado pelos fluxos de
  // editar/comentar pra propor candidatas.
  useEffect(() => {
    (async () => {
      const { data } = await listDemands(200);
      setAllDemands(data);
    })();
    const unsub = subscribeToDemands((event, change) => {
      setAllDemands((prev) => {
        if (event === "INSERT" && change.new) {
          if (prev.some((d) => d.id === change.new!.id)) return prev;
          return [change.new, ...prev];
        }
        if (event === "UPDATE" && change.new) {
          return prev.map((d) => (d.id === change.new!.id ? change.new! : d));
        }
        if (event === "DELETE" && change.old) {
          return prev.filter((d) => d.id !== change.old!.id);
        }
        return prev;
      });
    });
    return unsub;
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

  // `cancelled=true` significa que o user fechou sem enviar (Esc ou botão
  // Cancelar). Nesse caso a janela main também é escondida — caso contrário
  // o macOS dá foco automaticamente pra próxima janela do app, "abrindo" o
  // painel principal sem o user pedir. Quando uma demanda é enviada com
  // sucesso, a janela main aparece naturalmente (comportamento desejado).
  async function closeWindow(opts?: { cancelled?: boolean }) {
    const cancelled = opts?.cancelled === true;
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
    setCandidates([]);
    setTargetDemand(null);
    try {
      if (cancelled) {
        // Esconde a main ANTES da capture pra evitar flash do painel
        // principal aparecendo por um frame.
        await invoke("hide_main_window");
      }
      await invoke("hide_capture_window");
    } catch (err) {
      console.error("[Capture] hide failed:", err);
    }
  }

  async function runExtraction() {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) {
      await closeWindow({ cancelled: true });
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

    // Rota por intenção: criar segue direto pro confirm; editar/comentar
    // passa antes pela tela "target" pra user escolher a demanda alvo.
    if (e.intencao !== "criar") {
      const cands = findCandidateDemands(
        trimmed,
        applied.clientId,
        allDemands,
        8,
      );
      setCandidates(cands);
      // Atalho: única candidata óbvia → pula direto pro confirm com ela
      // selecionada. User ainda pode "voltar" se errou.
      if (cands.length === 1) {
        setTargetDemand(cands[0]);
        setMode("confirm");
      } else {
        setMode("target");
      }
      return;
    }

    setMode("confirm");
  }

  // ----- Handlers de target / edit / comment -----

  function pickTarget(d: Demand) {
    setTargetDemand(d);
    setMode("confirm");
  }

  // Fallback: usuário decide criar nova mesmo quando IA detectou edit/comment.
  // Útil quando a IA classifica errado ou a demanda alvo não existe na lista.
  function convertToCreate() {
    if (extracted) {
      setExtracted({ ...extracted, intencao: "criar" });
    }
    setTargetDemand(null);
    setMode("confirm");
  }

  async function saveEditMode(diffs: FieldDiff[]) {
    if (!targetDemand) return;
    setBusy(true);
    setError(null);
    const patch = diffsToPatch(diffs);
    const hasPatch = Object.keys(patch).length > 0;
    if (!hasPatch && attachments.length === 0) {
      setBusy(false);
      setError("Nenhuma mudança marcada.");
      return;
    }

    if (hasPatch) {
      const { error } = await updateDemand(targetDemand.id, patch);
      if (error) {
        setBusy(false);
        setError(error);
        return;
      }
    }

    if (attachments.length > 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setBusy(false);
        setError("Sessão expirada. Faça login novamente.");
        return;
      }
      const uploadErrors = await uploadAll(targetDemand.id, user.id);
      if (uploadErrors.length > 0) {
        setBusy(false);
        setError(
          hasPatch
            ? `Mudanças aplicadas, mas anexos falharam: ${uploadErrors.join(" · ")}`
            : `Falha no envio de anexos: ${uploadErrors.join(" · ")}`,
        );
        return;
      }
    }

    setBusy(false);
    await closeWindow();
  }

  async function saveCommentMode(content: string) {
    if (!targetDemand) return;
    const trimmed = content.trim();
    if (!trimmed) {
      setError("Comentário vazio.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await createComment(targetDemand.id, trimmed);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    await closeWindow();
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

  // Tela intermediária pra editar/comentar: escolher demanda alvo.
  if (mode === "target" && extracted && initial) {
    return (
      <TargetView
        extracted={extracted}
        candidates={candidates}
        clients={clients}
        profiles={profiles}
        onPick={pickTarget}
        onConvertToCreate={convertToCreate}
        onCancel={() => void closeWindow({ cancelled: true })}
        onBack={() => {
          setMode("input");
          setExtracted(null);
          setInitial(null);
          setCandidates([]);
        }}
      />
    );
  }

  if (mode === "confirm" && extracted && initial) {
    // Editar e comentar têm telas próprias — usam targetDemand. Se por
    // algum motivo não houver target ainda, cai pro fluxo de criar.
    if (extracted.intencao === "editar" && targetDemand) {
      const proposedDiffs = diffDemand({
        current: targetDemand,
        proposed: extracted,
        proposedClientId: initial.clientId,
        proposedAssigneeId: initial.assigneeId,
      });
      return (
        <EditConfirmView
          target={targetDemand}
          diffs={proposedDiffs}
          clients={clients}
          profiles={profiles}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          busy={busy}
          error={error}
          onCancel={() => void closeWindow({ cancelled: true })}
          onBack={() => setMode("target")}
          onConfirm={(selected) => void saveEditMode(selected)}
        />
      );
    }
    if (extracted.intencao === "comentar" && targetDemand) {
      return (
        <CommentConfirmView
          target={targetDemand}
          initialContent={initial.descricao}
          busy={busy}
          error={error}
          onCancel={() => void closeWindow({ cancelled: true })}
          onBack={() => setMode("target")}
          onConfirm={(content) => void saveCommentMode(content)}
        />
      );
    }
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
        onCancel={() => void closeWindow({ cancelled: true })}
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
      onCancel={() => void closeWindow({ cancelled: true })}
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

  // Drag-and-drop de arquivos via eventos do Tauri runtime
  // (dragDropEnabled:true no tauri.conf.json). O Tauri intercepta o drop
  // no nível do sistema, ANTES do WKWebView abrir o arquivo como
  // conteúdo, e nos entrega os paths absolutos via 3 eventos:
  //   - tauri://drag-enter / tauri://drag-leave: feedback visual
  //   - tauri://drag-drop: paths absolutos pra ler via Rust
  //
  // Import estático + try/catch por listener — a tentativa anterior com
  // dynamic import dentro de (async () => {})() engolia erros silenciosos
  // e deixava a janela em estado inválido se algum listen() rejeitasse.
  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    let cancelled = false;

    async function setupListener<T = unknown>(
      event: string,
      handler: (payload: T) => void,
    ) {
      try {
        const un = await listen<T>(event, (e) => handler(e.payload as T));
        if (cancelled) {
          un();
        } else {
          unlistens.push(un);
        }
      } catch (err) {
        console.error(`[capture] listen("${event}") falhou:`, err);
      }
    }

    void setupListener("tauri://drag-enter", () => setDragOver(true));
    void setupListener("tauri://drag-leave", () => setDragOver(false));
    void setupListener<{ paths: string[] }>(
      "tauri://drag-drop",
      async (payload) => {
        setDragOver(false);
        const paths = payload?.paths ?? [];
        if (paths.length === 0) return;
        try {
          const { files, errors } = await readPathsAsFiles(paths);
          if (files.length > 0) await props.onAddFiles(files);
          if (errors.length > 0) props.onPickerError(errors.join(" · "));
        } catch (err) {
          console.error("[capture] readPathsAsFiles falhou:", err);
        }
      },
    );

    return () => {
      cancelled = true;
      unlistens.forEach((un) => {
        try {
          un();
        } catch {
          /* ignore */
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="flex h-screen items-center justify-center bg-tng-marine-700">
      <div
        className={`flex h-full w-full flex-col overflow-hidden border bg-tng-marine-700 transition ${
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
          <button
            type="button"
            onClick={props.onCancel}
            aria-label="Fechar"
            className="rounded-md p-1 text-tng-marine-300 hover:bg-tng-marine-600/40 hover:text-tng-marine-100"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
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
              <>
                <i className="fa-solid fa-paperclip mr-1" aria-hidden="true" /> Cole, arraste arquivos ou{" "}
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
    <div className="flex h-screen items-center justify-center bg-tng-marine-700">
      <div className="flex h-full w-full flex-col overflow-hidden border border-tng-marine-600/60 bg-tng-marine-700">
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

// ---------------------------------------------------------------------------
// View 3 — Target picker (escolher demanda alvo de editar/comentar)
// ---------------------------------------------------------------------------

function TargetView(props: {
  extracted: ExtractedDemand;
  candidates: Demand[];
  clients: ClientOption[];
  profiles: ProfileOption[];
  onPick: (demand: Demand) => void;
  onConvertToCreate: () => void;
  onCancel: () => void;
  onBack: () => void;
}) {
  const intencaoLabel = props.extracted.intencao === "editar" ? "Editar" : "Comentar";
  const intencaoVerb =
    props.extracted.intencao === "editar"
      ? "Qual demanda você quer editar?"
      : "Em qual demanda você quer comentar?";

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onCancel]);

  return (
    <div className="flex h-screen items-center justify-center bg-tng-marine-700">
      <div className="flex h-full w-full flex-col overflow-hidden border border-tng-marine-600/60 bg-tng-marine-700">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-tng-marine-600/60 px-5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-sky-400" />
            <span className="text-xs font-medium text-tng-marine-100">
              {intencaoLabel} demanda existente
            </span>
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
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-sm text-tng-marine-100">{intencaoVerb}</p>
          {props.candidates.length === 0 ? (
            <p className="text-[12px] text-tng-marine-300">
              Nenhuma demanda parecida foi encontrada. Você pode criar uma nova
              ou voltar e refazer a captura mencionando mais detalhes.
            </p>
          ) : (
            <ul className="space-y-2">
              {props.candidates.map((d) => (
                <CandidateRow
                  key={d.id}
                  demand={d}
                  clients={props.clients}
                  profiles={props.profiles}
                  onClick={() => props.onPick(d)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-tng-marine-600/60 bg-tng-marine-800/40 px-5 py-3">
          <button
            type="button"
            onClick={props.onConvertToCreate}
            className="text-[11px] text-tng-marine-300 underline-offset-2 hover:text-tng-marine-100 hover:underline"
          >
            Não é nenhuma dessas — criar nova demanda
          </button>
          <span className="text-[11px] text-tng-marine-300">
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">
              Esc
            </kbd>{" "}
            cancela
          </span>
        </div>
      </div>
    </div>
  );
}

function CandidateRow(props: {
  demand: Demand;
  clients: ClientOption[];
  profiles: ProfileOption[];
  onClick: () => void;
}) {
  const clientName = props.demand.client_id
    ? props.clients.find((c) => c.id === props.demand.client_id)?.name
    : null;
  const assigneeName = props.demand.assignee_id
    ? props.profiles.find((p) => p.id === props.demand.assignee_id)?.full_name
    : null;
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        className="block w-full rounded-md border border-tng-marine-600 bg-tng-marine-800/40 px-3 py-2.5 text-left transition hover:border-tng-orange-400 hover:bg-tng-marine-800"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="line-clamp-1 text-sm font-medium text-tng-marine-50">
            {props.demand.title ||
              htmlToPlainText(legacyToHtml(props.demand.description)).slice(0, 80)}
          </p>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-tng-marine-400">
            {props.demand.status === "todo"
              ? "a fazer"
              : props.demand.status === "doing"
              ? "em andamento"
              : props.demand.status === "done"
              ? "concluída"
              : props.demand.status}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[10px] text-tng-marine-400">
          {clientName && (
            <span>
              <i
                className="fa-solid fa-building mr-1"
                aria-hidden="true"
              />
              {clientName}
            </span>
          )}
          {assigneeName && (
            <span>
              <i className="fa-solid fa-user mr-1" aria-hidden="true" />
              {assigneeName}
            </span>
          )}
          {props.demand.due_date && (
            <span>
              <i
                className="fa-solid fa-calendar-day mr-1"
                aria-hidden="true"
              />
              {formatDueDate(props.demand.due_date)}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function formatDueDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

// ---------------------------------------------------------------------------
// View 4 — Edit confirm (revisar diffs propostos pela IA)
// ---------------------------------------------------------------------------

const PRIORITY_LABELS_DISPLAY: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};
const INFRA_LABELS_DISPLAY: Record<string, string> = {
  wordpress: "WordPress",
  site_ia: "Site com IA",
};

function formatDiffValue(
  field: FieldDiff["field"],
  value: unknown,
  clients: ClientOption[],
  profiles: ProfileOption[],
): string {
  if (value === null || value === undefined) return "—";
  if (field === "client_id") {
    return (
      clients.find((c) => c.id === value)?.name ?? String(value)
    );
  }
  if (field === "assignee_id") {
    return (
      profiles.find((p) => p.id === value)?.full_name ?? String(value)
    );
  }
  if (field === "priority") {
    return PRIORITY_LABELS_DISPLAY[String(value)] ?? String(value);
  }
  if (field === "infrastructure") {
    return INFRA_LABELS_DISPLAY[String(value)] ?? String(value);
  }
  if (field === "due_date") return formatDueDate(String(value));
  if (field === "tags") {
    const arr = value as string[];
    if (arr.length === 0) return "—";
    return arr.join(", ");
  }
  return String(value);
}

function EditConfirmView(props: {
  target: Demand;
  diffs: FieldDiff[];
  clients: ClientOption[];
  profiles: ProfileOption[];
  attachments: PendingAttachment[];
  onRemoveAttachment: (id: string) => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onBack: () => void;
  onConfirm: (selected: FieldDiff[]) => void;
}) {
  // Por padrão todos os diffs propostos vêm marcados. User pode desmarcar
  // os que não quer aplicar.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(props.diffs.map((d) => d.field)),
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  function toggle(field: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function handleConfirm() {
    const selected = props.diffs.filter((d) => checked.has(d.field));
    props.onConfirm(selected);
  }

  const targetLabel =
    props.target.title ||
    htmlToPlainText(legacyToHtml(props.target.description)).slice(0, 80);

  const selectedCount = checked.size;
  const attachmentCount = props.attachments.length;
  const totalActions = selectedCount + attachmentCount;

  return (
    <div className="flex h-screen items-center justify-center bg-tng-marine-700">
      <div className="flex h-full w-full flex-col overflow-hidden border border-tng-marine-600/60 bg-tng-marine-700">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-tng-marine-600/60 px-5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-sky-400" />
            <span className="text-xs font-medium text-tng-marine-100">
              Editar demanda
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={props.onBack}
              className="text-[10px] uppercase tracking-wider text-tng-marine-300 hover:text-tng-marine-100"
            >
              ← trocar demanda
            </button>
            <button
              type="button"
              onClick={props.onCancel}
              aria-label="Fechar"
              className="rounded-md p-1 text-tng-marine-300 hover:bg-tng-marine-600/40 hover:text-tng-marine-100"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="border-b border-tng-marine-600/60 px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-tng-marine-300">
            Alvo
          </p>
          <p className="mt-0.5 text-sm font-medium text-tng-marine-50">
            {targetLabel}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {props.diffs.length === 0 && attachmentCount === 0 ? (
            <p className="text-[12px] text-tng-marine-300">
              A IA não detectou nenhuma mudança em relação à demanda atual.
              Volta e refaz a captura mencionando o que precisa alterar.
            </p>
          ) : props.diffs.length === 0 ? (
            <p className="text-[12px] text-tng-marine-300">
              Sem alterações de campos. {attachmentCount} anexo
              {attachmentCount > 1 ? "s serão adicionados" : " será adicionado"} à
              demanda.
            </p>
          ) : (
            <ul className="space-y-2">
              {props.diffs.map((d) => {
                const active = checked.has(d.field);
                return (
                  <li
                    key={d.field}
                    className={`rounded-md border px-3 py-2.5 transition ${
                      active
                        ? "border-tng-orange-400/60 bg-tng-orange-400/5"
                        : "border-tng-marine-600 bg-tng-marine-800/30 opacity-60"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggle(d.field)}
                        className="mt-0.5 h-4 w-4 cursor-pointer accent-tng-orange-400"
                      />
                      <div className="flex-1">
                        <div className="text-[10px] uppercase tracking-wider text-tng-marine-300">
                          {d.label}
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-2 text-sm text-tng-marine-100">
                          <span className="text-tng-marine-400 line-through">
                            {formatDiffValue(
                              d.field,
                              d.oldValue,
                              props.clients,
                              props.profiles,
                            )}
                          </span>
                          <i
                            className="fa-solid fa-arrow-right text-[10px] text-tng-marine-400"
                            aria-hidden="true"
                          />
                          <span className="text-tng-orange-200">
                            {formatDiffValue(
                              d.field,
                              d.newValue,
                              props.clients,
                              props.profiles,
                            )}
                          </span>
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {attachmentCount > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-tng-marine-300">
                Anexos a adicionar ({attachmentCount})
              </div>
              <ul className="space-y-1">
                {props.attachments.map((a) => (
                  <AttachmentRow
                    key={a.id}
                    pending={a}
                    onRemove={() => props.onRemoveAttachment(a.id)}
                  />
                ))}
              </ul>
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
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">
              Esc
            </kbd>{" "}
            cancela &nbsp;·&nbsp;
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">
              ⌘↵
            </kbd>{" "}
            aplica
          </span>
          <button
            onClick={handleConfirm}
            disabled={props.busy || totalActions === 0}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.busy
              ? "Aplicando…"
              : totalActions === 0
              ? "Marque ao menos um campo"
              : confirmButtonLabel(selectedCount, attachmentCount)}
          </button>
        </div>
      </div>
    </div>
  );
}

function confirmButtonLabel(diffCount: number, attachmentCount: number): string {
  const parts: string[] = [];
  if (diffCount > 0) {
    parts.push(`${diffCount} mudança${diffCount > 1 ? "s" : ""}`);
  }
  if (attachmentCount > 0) {
    parts.push(`${attachmentCount} anexo${attachmentCount > 1 ? "s" : ""}`);
  }
  return `Aplicar ${parts.join(" + ")}`;
}

// ---------------------------------------------------------------------------
// View 5 — Comment confirm (adicionar comentário a demanda existente)
// ---------------------------------------------------------------------------

function CommentConfirmView(props: {
  target: Demand;
  initialContent: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onBack: () => void;
  onConfirm: (content: string) => void;
}) {
  // A IA devolve descrição com possível bloco de anexos junto ("---" como
  // separador). Pra comentário, queremos só a parte principal por default.
  const initialContent = props.initialContent.split(/\n\n---\n\n/)[0].trim();
  const [content, setContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        props.onConfirm(content);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const targetLabel =
    props.target.title ||
    htmlToPlainText(legacyToHtml(props.target.description)).slice(0, 80);

  return (
    <div className="flex h-screen items-center justify-center bg-tng-marine-700">
      <div className="flex h-full w-full flex-col overflow-hidden border border-tng-marine-600/60 bg-tng-marine-700">
        <div
          data-tauri-drag-region
          className="flex items-center justify-between border-b border-tng-marine-600/60 px-5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-sky-400" />
            <span className="text-xs font-medium text-tng-marine-100">
              Comentar em demanda
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={props.onBack}
              className="text-[10px] uppercase tracking-wider text-tng-marine-300 hover:text-tng-marine-100"
            >
              ← trocar demanda
            </button>
            <button
              type="button"
              onClick={props.onCancel}
              aria-label="Fechar"
              className="rounded-md p-1 text-tng-marine-300 hover:bg-tng-marine-600/40 hover:text-tng-marine-100"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="border-b border-tng-marine-600/60 px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-tng-marine-300">
            Alvo
          </p>
          <p className="mt-0.5 text-sm font-medium text-tng-marine-50">
            {targetLabel}
          </p>
        </div>

        <div className="flex-1 overflow-hidden px-5 py-4">
          <label className="mb-2 block text-[10px] uppercase tracking-wider text-tng-marine-300">
            Comentário
          </label>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="block h-[calc(100%-2rem)] w-full resize-none rounded-md border border-tng-marine-600 bg-tng-marine-800 px-3 py-2 text-sm text-tng-marine-50 focus:border-tng-orange-400 focus:outline-none focus:ring-1 focus:ring-tng-orange-400/30"
            disabled={props.busy}
          />
        </div>

        {props.error && (
          <div className="border-t border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-300">
            {props.error}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-tng-marine-600/60 bg-tng-marine-800/40 px-5 py-3">
          <span className="text-[11px] text-tng-marine-300">
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">
              Esc
            </kbd>{" "}
            cancela &nbsp;·&nbsp;
            <kbd className="rounded bg-tng-marine-600 px-1.5 py-0.5 text-tng-marine-100">
              ⌘↵
            </kbd>{" "}
            envia
          </span>
          <button
            onClick={() => props.onConfirm(content)}
            disabled={props.busy || content.trim().length === 0}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.busy ? "Enviando…" : "Enviar comentário"}
          </button>
        </div>
      </div>
    </div>
  );
}
