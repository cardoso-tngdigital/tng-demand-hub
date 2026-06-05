import { useCallback, useEffect, useRef, useState } from "react";
import { updateDemand, type DemandPatch } from "../lib/demands";
import type { ClientOption, ProfileOption } from "../lib/lookups";
import {
  categoryIcon,
  categorize,
  formatBytes,
  getSignedUrl,
  listAttachments,
} from "../lib/attachments";
import type { Attachment, Demand, DemandPriority, DemandStatus } from "../types/database";

const STATUS_OPTIONS: { value: DemandStatus; label: string }[] = [
  { value: "todo", label: "A fazer" },
  { value: "doing", label: "Em andamento" },
  { value: "done", label: "Concluída" },
  { value: "archived", label: "Arquivada" },
];

const PRIORITY_OPTIONS: { value: DemandPriority; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

const STATUS_STYLE: Record<DemandStatus, string> = {
  todo: "bg-tng-marine-600/60 text-tng-marine-100",
  doing: "bg-tng-orange-400/15 text-tng-orange-300",
  done: "bg-emerald-500/15 text-emerald-300",
  archived: "bg-tng-marine-700 text-tng-marine-300",
};

const PRIORITY_DOT: Record<DemandPriority, string> = {
  baixa: "bg-tng-marine-400",
  media: "bg-sky-400",
  alta: "bg-tng-orange-400",
  urgente: "bg-red-500",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DemandDetailDrawer({
  demand,
  clients,
  profiles,
  onClose,
}: {
  demand: Demand | null;
  clients: ClientOption[];
  profiles: ProfileOption[];
  onClose: () => void;
}) {
  const open = demand !== null;

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-40 transition-opacity ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Fechar painel"
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-tng-marine-700 bg-tng-marine-800 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        {demand && (
          <DemandDetailBody
            demand={demand}
            clients={clients}
            profiles={profiles}
            onClose={onClose}
          />
        )}
      </aside>
    </div>
  );
}

function DemandDetailBody({
  demand,
  clients,
  profiles,
  onClose,
}: {
  demand: Demand;
  clients: ClientOption[];
  profiles: ProfileOption[];
  onClose: () => void;
}) {
  const editor = useDemandEditor(demand);

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-tng-marine-700 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[demand.priority]}`}
            />
            <select
              value={demand.status}
              onChange={(e) => editor.save({ status: e.target.value as DemandStatus })}
              disabled={editor.saving}
              className={`rounded-full border border-transparent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider focus:border-tng-orange-400 focus:outline-none ${STATUS_STYLE[demand.status]}`}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-tng-marine-800">
                  {o.label}
                </option>
              ))}
            </select>
            <SaveIndicator saving={editor.saving} error={editor.error} />
          </div>
          <h2 className="mt-2 font-sans text-base font-semibold text-tng-marine-50">
            {demand.title || demand.description.slice(0, 80)}
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <Section title="Descrição">
          <textarea
            value={editor.draft.description}
            onChange={(e) => editor.setField("description", e.target.value)}
            onBlur={() => editor.flush("description")}
            rows={6}
            className="block w-full resize-y rounded-md border border-tng-marine-600 bg-tng-marine-800 px-3 py-2 text-sm leading-relaxed text-tng-marine-100 placeholder:text-tng-marine-400 focus:border-tng-orange-400 focus:outline-none"
          />
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <EditableSelect
            label="Cliente"
            value={demand.client_id ?? ""}
            onChange={(v) => editor.save({ client_id: v || null })}
            disabled={editor.saving}
          >
            <option value="" className="bg-tng-marine-800">— Sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id} className="bg-tng-marine-800">
                {c.alias || c.name}
              </option>
            ))}
          </EditableSelect>

          <EditableSelect
            label="Responsável"
            value={demand.assignee_id ?? ""}
            onChange={(v) => editor.save({ assignee_id: v || null })}
            disabled={editor.saving}
          >
            <option value="" className="bg-tng-marine-800">— Sem responsável</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id} className="bg-tng-marine-800">
                {p.full_name}
              </option>
            ))}
          </EditableSelect>

          <EditableSelect
            label="Prioridade"
            value={demand.priority}
            onChange={(v) => editor.save({ priority: v as DemandPriority })}
            disabled={editor.saving}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value} className="bg-tng-marine-800">
                {p.label}
              </option>
            ))}
          </EditableSelect>

          <EditableField label="Prazo">
            <input
              type="date"
              value={editor.draft.due_date}
              onChange={(e) => editor.setField("due_date", e.target.value)}
              onBlur={() => editor.flush("due_date")}
              className="block w-full rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2 py-1 text-sm text-tng-marine-100 focus:border-tng-orange-400 focus:outline-none"
            />
          </EditableField>
        </div>

        <Section title="Tags (separadas por vírgula)">
          <input
            value={editor.draft.tags}
            onChange={(e) => editor.setField("tags", e.target.value)}
            onBlur={() => editor.flush("tags")}
            placeholder="design, cliente-externo"
            className="block w-full rounded-md border border-tng-marine-600 bg-tng-marine-800 px-3 py-1.5 text-sm text-tng-marine-100 placeholder:text-tng-marine-400 focus:border-tng-orange-400 focus:outline-none"
          />
        </Section>

        <Section title="Anexos">
          <AttachmentsList demandId={demand.id} />
        </Section>

        <Section title="Metadados">
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-[11px] text-tng-marine-300">
            <dt>Criada em</dt>
            <dd className="text-tng-marine-100">{formatDate(demand.created_at)}</dd>
            <dt>Atualizada em</dt>
            <dd className="text-tng-marine-100">{formatDate(demand.updated_at)}</dd>
            <dt>Capturada via</dt>
            <dd className="text-tng-marine-100">{demand.captured_via}</dd>
          </dl>
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Editor: encapsula o estado de rascunho para campos free-text, decide se há
// algo a persistir, dispara updateDemand e expõe estado de saving/error.
// ---------------------------------------------------------------------------

type DraftFields = "description" | "tags" | "due_date";

type Draft = { description: string; tags: string; due_date: string };

function draftFromDemand(d: Demand): Draft {
  return {
    description: d.description,
    tags: d.tags.join(", "),
    due_date: d.due_date ?? "",
  };
}

function useDemandEditor(demand: Demand) {
  const [draft, setDraft] = useState<Draft>(() => draftFromDemand(demand));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baselineRef = useRef<Draft>(draftFromDemand(demand));

  // Quando muda a demanda selecionada OU quando o realtime traz nova versão,
  // reconcilia o rascunho com o banco — preservando edição local de campos
  // que ainda divergem da baseline (usuário ainda digitando).
  useEffect(() => {
    const next = draftFromDemand(demand);
    setDraft((current) => ({
      description:
        current.description === baselineRef.current.description ? next.description : current.description,
      tags: current.tags === baselineRef.current.tags ? next.tags : current.tags,
      due_date: current.due_date === baselineRef.current.due_date ? next.due_date : current.due_date,
    }));
    baselineRef.current = next;
  }, [demand]);

  const save = useCallback(
    async (patch: DemandPatch) => {
      setSaving(true);
      setError(null);
      const { error } = await updateDemand(demand.id, patch);
      setSaving(false);
      if (error) setError(error);
    },
    [demand.id],
  );

  const setField = useCallback((field: DraftFields, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  /**
   * Persiste o campo se o valor atual diverge da baseline (último valor
   * conhecido do banco). Evita chamadas redundantes em blurs sem alteração.
   */
  const flush = useCallback(
    async (field: DraftFields) => {
      const current = draft[field];
      const baseline = baselineRef.current[field];
      if (current === baseline) return;

      let patch: DemandPatch;
      if (field === "tags") {
        patch = {
          tags: current
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        };
      } else if (field === "due_date") {
        patch = { due_date: current.trim() || null };
      } else {
        patch = { description: current };
      }
      await save(patch);
    },
    [draft, save],
  );

  return { draft, setField, flush, save, saving, error };
}

function SaveIndicator({ saving, error }: { saving: boolean; error: string | null }) {
  if (error) {
    return (
      <span className="text-[10px] text-red-300" title={error}>
        erro ao salvar
      </span>
    );
  }
  if (saving) {
    return <span className="text-[10px] text-tng-marine-300">salvando…</span>;
  }
  return null;
}

function EditableField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-tng-marine-300">
        {label}
      </div>
      {children}
    </div>
  );
}

function EditableSelect({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <EditableField label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="block w-full rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2 py-1 text-sm text-tng-marine-100 focus:border-tng-orange-400 focus:outline-none disabled:opacity-60"
      >
        {children}
      </select>
    </EditableField>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-300">
        {title}
      </h3>
      {children}
    </section>
  );
}

function AttachmentsList({ demandId }: { demandId: string }) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    (async () => {
      const { data, error } = await listAttachments(demandId);
      if (cancelled) return;
      if (error) setError(error);
      else setItems(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [demandId]);

  if (items === null && error === null) {
    return <p className="text-xs text-tng-marine-400">Carregando…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-300">{error}</p>;
  }
  if (items && items.length === 0) {
    return <p className="text-xs text-tng-marine-400">Sem anexos.</p>;
  }
  return (
    <>
      <ul className="space-y-1.5">
        {items!.map((a) => (
          <AttachmentItem
            key={a.id}
            attachment={a}
            onOpen={() => setViewing(a)}
          />
        ))}
      </ul>
      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function AttachmentItem({
  attachment,
  onOpen,
}: {
  attachment: Attachment;
  onOpen: () => void;
}) {
  const category = categorize(attachment.file_type);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-md bg-tng-marine-700/40 px-2.5 py-2 text-left transition hover:bg-tng-marine-700"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-tng-marine-800 text-sm">
          {categoryIcon(category)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-tng-marine-100">{attachment.file_name}</p>
          <p className="text-[10px] text-tng-marine-400">
            {formatBytes(attachment.file_size_bytes)} · {attachment.file_type}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-tng-marine-300">Abrir</span>
      </button>
    </li>
  );
}

function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: Attachment | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!attachment) {
      setUrl(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setUrl(null);
    setLoadError(null);
    (async () => {
      const signed = await getSignedUrl(attachment.file_path);
      if (cancelled) return;
      if (!signed) setLoadError("Não foi possível gerar o link do arquivo.");
      else setUrl(signed);
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  useEffect(() => {
    if (!attachment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attachment, onClose]);

  if (!attachment) return null;

  const category = categorize(attachment.file_type);

  function handleDownload() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = attachment!.file_name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-tng-marine-700/60 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-tng-marine-50">
            {attachment.file_name}
          </p>
          <p className="text-[11px] text-tng-marine-300">
            {formatBytes(attachment.file_size_bytes)} · {attachment.file_type}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!url}
            className="rounded-md border border-tng-marine-600 px-3 py-1 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-400 disabled:opacity-40"
          >
            Baixar
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-auto p-5">
        {loadError ? (
          <p className="text-sm text-red-300">{loadError}</p>
        ) : !url ? (
          <p className="text-sm text-tng-marine-300">Carregando…</p>
        ) : category === "image" ? (
          <img
            src={url}
            alt={attachment.file_name}
            className="max-h-full max-w-full rounded shadow-lg"
          />
        ) : category === "audio" ? (
          <div className="w-full max-w-xl rounded-lg bg-tng-marine-800/80 p-6 text-center">
            <div className="mb-4 text-5xl">🎵</div>
            <audio controls src={url} className="w-full" />
          </div>
        ) : category === "video" ? (
          <video
            controls
            src={url}
            className="max-h-full max-w-full rounded shadow-lg"
          />
        ) : category === "pdf" ? (
          <iframe
            src={url}
            title={attachment.file_name}
            className="h-full w-full max-w-5xl rounded bg-white shadow-lg"
          />
        ) : (
          <div className="rounded-lg bg-tng-marine-800/80 p-8 text-center">
            <div className="mb-3 text-5xl">{categoryIcon(category)}</div>
            <p className="mb-1 text-sm text-tng-marine-100">{attachment.file_name}</p>
            <p className="text-xs text-tng-marine-300">
              Pré-visualização não suportada para este tipo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
