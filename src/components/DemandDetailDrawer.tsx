import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { supabase } from "../lib/supabase/client";
import { deleteDemand, updateDemand, type DemandPatch } from "../lib/demands";
import type { ClientOption, ProfileOption } from "../lib/lookups";
import {
  buildPendingAttachment,
  categoryIconClass,
  categorize,
  disposePending,
  formatBytes,
  getSignedUrl,
  listAttachments,
  pickFilesNative,
  uploadAttachment,
} from "../lib/attachments";
import { openAttachmentPreview } from "../lib/preview";
import { htmlToPlainText, legacyToHtml, sanitizeHtml } from "../lib/htmlContent";
import {
  describeEvent,
  formatHistoryDate,
  listHistory,
} from "../lib/demandHistory";
import { CommentsThread } from "./CommentsThread";
import { RichTextEditor } from "./RichTextEditor";
import { StatusButtons } from "../screens/DashboardScreen";
import type {
  Attachment,
  Demand,
  DemandHistoryRow,
  DemandInfrastructure,
  DemandPriority,
} from "../types/database";

const PRIORITY_OPTIONS: { value: DemandPriority; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

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
  isAdmin,
  currentUserId,
  onClose,
}: {
  demand: Demand | null;
  clients: ClientOption[];
  profiles: ProfileOption[];
  // Propagado pra dentro: comments-thread usa pra esconder o botão "remover"
  // pra non-admins; futuramente o histórico também só aparece pra admin.
  isAdmin: boolean;
  // Pra liberar "Excluir demanda" pra autor (além de admin) e checar
  // permissão na thread de comentários.
  currentUserId: string | null;
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
            isAdmin={isAdmin}
            currentUserId={currentUserId}
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
  isAdmin,
  currentUserId,
  onClose,
}: {
  demand: Demand;
  clients: ClientOption[];
  profiles: ProfileOption[];
  isAdmin: boolean;
  currentUserId: string | null;
  onClose: () => void;
}) {
  const editor = useDemandEditor(demand);
  const canDelete = isAdmin || demand.created_by === currentUserId;
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await deleteDemand(demand.id);
    setDeleting(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    setShowDeleteConfirm(false);
    onClose();
  }

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-tng-marine-700 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[demand.priority]}`}
              title={`Prioridade: ${demand.priority}`}
            />
            <StatusButtons
              current={demand.status}
              onChange={(s) => editor.save({ status: s })}
              saving={editor.saving}
            />
            {/* Arquivar fica como ação secundária — não é fluxo comum. */}
            {demand.status === "done" ? (
              <button
                type="button"
                onClick={() => editor.save({ status: "archived" })}
                disabled={editor.saving}
                className="rounded-md border border-tng-marine-600 px-2 py-0.5 text-[10px] text-tng-marine-300 hover:border-tng-marine-400 hover:text-tng-marine-100 disabled:opacity-50"
                title="Arquivar — some da lista; usar pra demandas antigas que não vão reabrir"
              >
                Arquivar
              </button>
            ) : demand.status === "archived" ? (
              <button
                type="button"
                onClick={() => editor.save({ status: "done" })}
                disabled={editor.saving}
                className="rounded-md border border-tng-marine-600 px-2 py-0.5 text-[10px] text-tng-marine-300 hover:border-tng-marine-400 hover:text-tng-marine-100 disabled:opacity-50"
              >
                Desarquivar
              </button>
            ) : null}
            <SaveIndicator saving={editor.saving} error={editor.error} />
          </div>
          <h2 className="mt-2 font-sans text-base font-semibold text-tng-marine-50">
            {demand.title || demandPreview(demand.description)}
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <Section title="Descrição">
          <RichTextEditor
            value={editor.draft.description}
            onChange={(html) => editor.setField("description", html)}
            onBlur={() => editor.flush("description")}
            placeholder="Descreva a demanda…"
            variant="full"
            minHeight={180}
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

          <div className="col-span-2">
            <EditableSelect
              label="Infraestrutura"
              value={demand.infrastructure ?? ""}
              onChange={(v) =>
                editor.save({ infrastructure: (v as DemandInfrastructure) || null })
              }
              disabled={editor.saving}
            >
              <option value="" className="bg-tng-marine-800">— Não classificada</option>
              <option value="wordpress" className="bg-tng-marine-800">WordPress</option>
              <option value="site_ia" className="bg-tng-marine-800">Site com IA</option>
            </EditableSelect>
          </div>
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

        <ClientLinks clients={clients} clientId={demand.client_id} />

        <Section title="Anexos">
          <AttachmentsList demandId={demand.id} />
        </Section>

        <Section title="Comentários">
          <CommentsThread demandId={demand.id} profiles={profiles} isAdmin={isAdmin} />
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

        {isAdmin && (
          <Section title="Histórico (admin)">
            <HistoryList
              demandId={demand.id}
              clients={clients}
              profiles={profiles}
            />
          </Section>
        )}

        {canDelete && (
          <Section title="Zona de perigo">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 transition hover:border-red-500 hover:bg-red-500/20"
            >
              <i className="fa-solid fa-trash mr-1.5" aria-hidden="true" />
              Excluir demanda
            </button>
            <p className="mt-1 text-[10px] text-tng-marine-400">
              Apaga a demanda, todos os comentários, anexos e histórico. Esta
              ação não pode ser desfeita.
            </p>
          </Section>
        )}
      </div>

      {showDeleteConfirm && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !deleting && setShowDeleteConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-red-500/40 bg-tng-marine-800 p-5 shadow-2xl"
          >
            <h3 className="font-sans text-sm font-semibold text-tng-marine-50">
              Excluir demanda?
            </h3>
            <p className="mt-2 text-xs text-tng-marine-300">
              <span className="text-tng-marine-100">
                {demand.title || "(sem título)"}
              </span>{" "}
              será apagada permanentemente, junto com{" "}
              {demand.comments_count} comentário
              {demand.comments_count === 1 ? "" : "s"} e {demand.attachments_count} anexo
              {demand.attachments_count === 1 ? "" : "s"}. Esta ação não pode
              ser desfeita.
            </p>
            {deleteError && (
              <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="rounded-md border border-tng-marine-600 px-3 py-1.5 text-xs text-tng-marine-200 transition hover:border-tng-marine-400 hover:text-tng-marine-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-md border border-red-500 bg-red-500/20 px-3 py-1.5 text-xs text-red-200 transition hover:bg-red-500/30 disabled:opacity-50"
              >
                {deleting ? "Excluindo…" : "Excluir definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Links rápidos do cliente — só aparece quando a demanda tem client_id
// ---------------------------------------------------------------------------

function ClientLinks({
  clients,
  clientId,
}: {
  clients: ClientOption[];
  clientId: string | null;
}) {
  const client = clientId ? clients.find((c) => c.id === clientId) : null;
  if (!client) return null;

  const links: { label: string; href: string; iconClass: string }[] = [];
  if (client.google_business_url) {
    links.push({
      label: "Google Meu Negócio",
      href: client.google_business_url,
      iconClass: "fa-solid fa-store",
    });
  }
  if (client.whatsapp_group_url) {
    links.push({
      label: "Grupo no WhatsApp",
      href: client.whatsapp_group_url,
      iconClass: "fa-brands fa-whatsapp",
    });
  }
  for (let i = 0; i < client.drive_urls.length; i++) {
    links.push({
      label: client.drive_urls.length > 1 ? `Drive ${i + 1}` : "Google Drive",
      href: client.drive_urls[i],
      iconClass: "fa-brands fa-google-drive",
    });
  }
  if (links.length === 0) return null;

  async function open(href: string) {
    try {
      await openUrl(href);
    } catch (err) {
      console.error("[ClientLinks] openUrl falhou:", err);
    }
  }

  return (
    <Section title={`Links de ${client.alias || client.name}`}>
      <ul className="flex flex-wrap gap-1.5">
        {links.map((l, idx) => (
          <li key={`${l.label}-${idx}`}>
            <button
              type="button"
              onClick={() => void open(l.href)}
              title={l.href}
              className="flex items-center gap-1.5 rounded-md border border-tng-marine-600 bg-tng-marine-800/60 px-2 py-1 text-[11px] text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-300"
            >
              <i className={l.iconClass} aria-hidden="true" />
              <span>{l.label}</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[9px] text-tng-marine-400" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Histórico (admin) — Top 5 + Ver mais
// ---------------------------------------------------------------------------

const HISTORY_PREVIEW = 5;

function HistoryList({
  demandId,
  clients,
  profiles,
}: {
  demandId: string;
  clients: ClientOption[];
  profiles: ProfileOption[];
}) {
  const [rows, setRows] = useState<DemandHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const clientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.alias || c.name);
    return m;
  }, [clients]);

  const profileNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name);
    return m;
  }, [profiles]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    setExpanded(false);
    (async () => {
      const { data, error } = await listHistory(demandId);
      if (cancelled) return;
      if (error) setError(error);
      else setRows(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [demandId]);

  if (rows === null && error === null) {
    return <p className="text-xs text-tng-marine-400">Carregando…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-300">{error}</p>;
  }
  if (rows && rows.length === 0) {
    return <p className="text-xs text-tng-marine-400">Sem registros ainda.</p>;
  }

  const visible = expanded ? rows! : rows!.slice(0, HISTORY_PREVIEW);
  const hidden = rows!.length - visible.length;

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1">
        {visible.map((r) => (
          <HistoryRow
            key={r.id}
            row={r}
            actorName={
              r.actor_id ? profileNameById.get(r.actor_id) ?? "alguém" : "sistema"
            }
            ctx={{
              oldClientName:
                r.field === "client_id" && r.old_value
                  ? clientNameById.get(r.old_value)
                  : undefined,
              newClientName:
                r.field === "client_id" && r.new_value
                  ? clientNameById.get(r.new_value)
                  : undefined,
              oldProfileName:
                r.field === "assignee_id" && r.old_value
                  ? profileNameById.get(r.old_value)
                  : undefined,
              newProfileName:
                r.field === "assignee_id" && r.new_value
                  ? profileNameById.get(r.new_value)
                  : undefined,
            }}
          />
        ))}
      </ul>
      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[11px] text-tng-orange-300 hover:text-tng-orange-200"
        >
          Ver mais {hidden} registro{hidden === 1 ? "" : "s"}
        </button>
      )}
      {expanded && rows!.length > HISTORY_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[11px] text-tng-marine-300 hover:text-tng-marine-100"
        >
          Mostrar menos
        </button>
      )}
    </div>
  );
}

function HistoryRow({
  row,
  actorName,
  ctx,
}: {
  row: DemandHistoryRow;
  actorName: string;
  ctx: Parameters<typeof describeEvent>[1];
}) {
  return (
    <li className="rounded-md bg-tng-marine-800/40 px-3 py-1.5 text-[11px]">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-tng-marine-100">{actorName}</span>
        <span className="text-tng-marine-200">{describeEvent(row, ctx)}</span>
      </div>
      <p className="mt-0.5 text-[10px] text-tng-marine-400">
        {formatHistoryDate(row.created_at)}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Editor: encapsula o estado de rascunho para campos free-text, decide se há
// algo a persistir, dispara updateDemand e expõe estado de saving/error.
// ---------------------------------------------------------------------------

type DraftFields = "description" | "tags" | "due_date";

type Draft = { description: string; tags: string; due_date: string };

// Description vira HTML no draft. Conteúdo legacy do banco (markdown que a
// IA escreveu ou texto puro de capturas antigas) é normalizado pra HTML
// na entrada — assim o editor sempre recebe HTML e a comparação de
// baseline para flush funciona sem falsos positivos.
function draftFromDemand(d: Demand): Draft {
  return {
    description: legacyToHtml(d.description),
    tags: d.tags.join(", "),
    due_date: d.due_date ?? "",
  };
}

function demandPreview(htmlOrLegacy: string): string {
  const text = htmlToPlainText(legacyToHtml(htmlOrLegacy));
  return text.slice(0, 80);
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
        // Defesa em camada: sanitiza HTML antes de gravar (apesar do schema do
        // Tiptap já limitar tags, paste exótico pode escapar em casos raros).
        patch = { description: sanitizeHtml(current) };
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
        className="tng-select block w-full rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2.5 py-1.5 text-sm text-tng-marine-100 focus:border-tng-orange-400 focus:outline-none disabled:opacity-60"
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
  const [uploading, setUploading] = useState(false);
  // Mensagens de erro por arquivo durante upload — mostradas inline e
  // limpas no próximo clique em "Anexar".
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

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

  // Sobe N arquivos em sequência. Cada upload bem sucedido é empurrado na
  // lista já visível (otimista); falhas viram strings em uploadErrors.
  const handlePick = useCallback(async () => {
    setUploadErrors([]);
    const picked = await pickFilesNative();
    if (picked.errors.length > 0) {
      setUploadErrors((prev) => [...prev, ...picked.errors]);
    }
    if (picked.files.length === 0) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploadErrors((prev) => [...prev, "Sessão expirada. Faça login novamente."]);
      return;
    }

    setUploading(true);
    for (const file of picked.files) {
      const built = await buildPendingAttachment(file);
      if ("error" in built) {
        setUploadErrors((prev) => [...prev, `${file.name}: ${built.error}`]);
        continue;
      }
      const result = await uploadAttachment(built, demandId, user.id);
      disposePending(built);
      if (result.ok) {
        setItems((prev) => (prev ? [...prev, result.attachment] : [result.attachment]));
      } else {
        setUploadErrors((prev) => [...prev, `${file.name}: ${result.error}`]);
      }
    }
    setUploading(false);
  }, [demandId]);

  return (
    <div className="space-y-2">
      {items === null && error === null ? (
        <p className="text-xs text-tng-marine-400">Carregando…</p>
      ) : error ? (
        <p className="text-xs text-red-300">{error}</p>
      ) : items && items.length === 0 ? (
        <p className="text-xs text-tng-marine-400">Sem anexos.</p>
      ) : (
        <ul className="space-y-1.5">
          {items!.map((a) => (
            <AttachmentItem
              key={a.id}
              attachment={a}
              onOpenExternal={async () => {
                const result = await openAttachmentPreview(a, items ?? [a]);
                if (!result.ok) {
                  setUploadErrors((prev) => [
                    ...prev,
                    `Abrir ${a.file_name}: ${result.error}`,
                  ]);
                }
              }}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void handlePick()}
        disabled={uploading}
        className="rounded-md border border-dashed border-tng-marine-600 px-2.5 py-1.5 text-[11px] text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-300 disabled:opacity-60"
      >
        {uploading ? "Enviando…" : "+ Anexar arquivo"}
      </button>
      <p className="text-[10px] text-tng-marine-400">Máx. 50 MB por arquivo.</p>

      {uploadErrors.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-red-300">
          {uploadErrors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentItem({
  attachment,
  onOpenExternal,
}: {
  attachment: Attachment;
  onOpenExternal: () => void;
}) {
  const category = categorize(attachment.file_type);
  const [expanded, setExpanded] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Áudio toca dentro do próprio item — janela nova só faz sentido pra
  // arquivos visuais (imagem, vídeo, PDF) onde o zoom/área importa.
  const isAudio = category === "audio";

  async function toggleAudio() {
    const next = !expanded;
    setExpanded(next);
    if (next && !audioUrl && !audioError) {
      const signed = await getSignedUrl(attachment.file_path);
      if (signed) setAudioUrl(signed);
      else setAudioError("Não foi possível gerar o link do áudio.");
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={isAudio ? () => void toggleAudio() : onOpenExternal}
        className="flex w-full items-center gap-2 rounded-md bg-tng-marine-700/40 px-2.5 py-2 text-left transition hover:bg-tng-marine-700"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-tng-marine-800 text-sm text-tng-marine-300">
          <i className={categoryIconClass(category)} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-tng-marine-100">{attachment.file_name}</p>
          <p className="text-[10px] text-tng-marine-400">
            {formatBytes(attachment.file_size_bytes)} · {attachment.file_type}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-tng-marine-300">
          {isAudio ? (expanded ? "Recolher" : "Tocar") : "Abrir"}
        </span>
      </button>
      {isAudio && expanded && (
        <div className="mt-1 rounded-md bg-tng-marine-800/60 px-2.5 py-2">
          {audioError ? (
            <p className="text-[11px] text-red-300">{audioError}</p>
          ) : audioUrl ? (
            <audio controls src={audioUrl} className="w-full" />
          ) : (
            <p className="text-[11px] text-tng-marine-300">Carregando…</p>
          )}
        </div>
      )}
    </li>
  );
}

