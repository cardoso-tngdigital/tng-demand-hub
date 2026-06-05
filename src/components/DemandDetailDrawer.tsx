import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase/client";
import {
  categoryIcon,
  categorize,
  formatBytes,
  getSignedUrl,
  listAttachments,
} from "../lib/attachments";
import type { Attachment, Demand, DemandPriority, DemandStatus } from "../types/database";

const STATUS_LABEL: Record<DemandStatus, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  done: "Concluída",
  archived: "Arquivada",
};

const STATUS_STYLE: Record<DemandStatus, string> = {
  todo: "bg-tng-marine-600/60 text-tng-marine-100",
  doing: "bg-tng-orange-400/15 text-tng-orange-300",
  done: "bg-emerald-500/15 text-emerald-300",
  archived: "bg-tng-marine-700 text-tng-marine-300",
};

const PRIORITY_LABEL: Record<DemandPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
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

function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

export function DemandDetailDrawer({
  demand,
  onClose,
}: {
  demand: Demand | null;
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
        {demand && <DemandDetailBody demand={demand} onClose={onClose} />}
      </aside>
    </div>
  );
}

function DemandDetailBody({ demand, onClose }: { demand: Demand; onClose: () => void }) {
  const clientName = useClientName(demand.client_id);
  const assigneeName = useAssigneeName(demand.assignee_id);

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-tng-marine-700 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[demand.priority]}`}
            />
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[demand.status]}`}
            >
              {STATUS_LABEL[demand.status]}
            </span>
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
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-tng-marine-100">
            {demand.description}
          </p>
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <MetaField label="Cliente" value={clientName ?? "—"} />
          <MetaField label="Responsável" value={assigneeName ?? "—"} />
          <MetaField label="Prioridade" value={PRIORITY_LABEL[demand.priority]} />
          <MetaField label="Prazo" value={formatDateOnly(demand.due_date)} />
        </div>

        {demand.tags.length > 0 && (
          <Section title="Tags">
            <ul className="flex flex-wrap gap-1.5">
              {demand.tags.map((t) => (
                <li
                  key={t}
                  className="rounded-full bg-tng-marine-700 px-2 py-0.5 text-[11px] text-tng-marine-200"
                >
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        )}

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

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-tng-marine-300">
        {label}
      </div>
      <div className="text-sm text-tng-marine-100">{value}</div>
    </div>
  );
}

function useClientName(clientId: string | null): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) {
      setName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("name, alias")
        .eq("id", clientId)
        .maybeSingle();
      if (cancelled || !data) return;
      setName(data.alias || data.name);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  return name;
}

function useAssigneeName(assigneeId: string | null): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!assigneeId) {
      setName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", assigneeId)
        .maybeSingle();
      if (cancelled || !data) return;
      setName(data.full_name);
    })();
    return () => {
      cancelled = true;
    };
  }, [assigneeId]);
  return name;
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
