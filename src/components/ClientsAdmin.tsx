import { useCallback, useEffect, useState } from "react";
import {
  createClient,
  deleteClient,
  listAllClients,
  updateClient,
  type ClientInput,
} from "../lib/clients";
import type { Client, ClientLink } from "../types/database";

// Garante pelo menos uma linha vazia visível pra UX previsível dos forms.
const emptyLink = (): ClientLink => ({ label: "", url: "" });
const initLinks = (existing: ClientLink[] | undefined): ClientLink[] =>
  existing && existing.length > 0 ? existing.map((l) => ({ ...l })) : [emptyLink()];

export function ClientsAdmin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listAllClients();
    if (error) setError(error);
    else setClients(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleCreate(input: ClientInput) {
    setError(null);
    const { data, error } = await createClient(input);
    if (error) {
      setError(error);
      return false;
    }
    if (data) setClients((prev) => [data, ...prev]);
    setCreating(false);
    return true;
  }

  async function handleUpdate(id: string, input: ClientInput) {
    setError(null);
    const { data, error } = await updateClient(id, input);
    if (error) {
      setError(error);
      return false;
    }
    if (data) setClients((prev) => prev.map((c) => (c.id === id ? data : c)));
    setEditingId(null);
    return true;
  }

  async function handleToggleStatus(c: Client) {
    setError(null);
    const newStatus = c.status === "active" ? "inactive" : "active";
    const { data, error } = await updateClient(c.id, { status: newStatus });
    if (error) {
      setError(error);
      return;
    }
    if (data) setClients((prev) => prev.map((x) => (x.id === c.id ? data : x)));
  }

  async function handleDelete(c: Client) {
    if (!window.confirm(`Excluir "${c.name}" definitivamente?`)) return;
    setError(null);
    const { error } = await deleteClient(c.id);
    if (error) {
      setError(error);
      return;
    }
    setClients((prev) => prev.filter((x) => x.id !== c.id));
  }

  if (!open) return null;

  const activeCount = clients.filter((c) => c.status === "active").length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-tng-marine-900/95 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-sans text-base font-semibold text-tng-marine-50">Clientes</h2>
          <span className="text-[11px] text-tng-marine-400">
            {clients.length} cadastrados · {activeCount} ativos
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300"
          >
            {creating ? "Cancelar" : "Novo cliente"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {creating && (
          <div className="mb-4">
            <ClientForm
              key="new"
              onSubmit={handleCreate}
              onCancel={() => setCreating(false)}
              submitLabel="Criar cliente"
            />
          </div>
        )}

        {loading ? (
          <p className="text-sm text-tng-marine-300">Carregando…</p>
        ) : clients.length === 0 ? (
          <p className="text-sm text-tng-marine-300">Nenhum cliente cadastrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {clients.map((c) =>
              editingId === c.id ? (
                <li key={c.id} className="rounded-lg border border-tng-orange-400/40 bg-tng-marine-800/40 p-3">
                  <ClientForm
                    initial={c}
                    submitLabel="Salvar alterações"
                    onSubmit={(input) => handleUpdate(c.id, input)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <ClientRow
                  key={c.id}
                  client={c}
                  onEdit={() => setEditingId(c.id)}
                  onToggleStatus={() => void handleToggleStatus(c)}
                  onDelete={() => void handleDelete(c)}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function ClientRow({
  client,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  client: Client;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const inactive = client.status === "inactive";
  return (
    <li
      className={`rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 px-4 py-3 transition ${
        inactive ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-tng-marine-50">{client.name}</h3>
            {client.alias && (
              <span className="text-xs text-tng-marine-400">· {client.alias}</span>
            )}
            <span
              className={`ml-1 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${
                inactive
                  ? "bg-tng-marine-700 text-tng-marine-300"
                  : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {inactive ? "inativo" : "ativo"}
            </span>
          </div>
          {(client.email || client.phone) && (
            <p className="mt-1 text-[11px] text-tng-marine-300">
              {[client.email, client.phone].filter(Boolean).join(" · ")}
            </p>
          )}
          {client.notes && (
            <p className="mt-1 line-clamp-2 text-[11px] text-tng-marine-400">{client.notes}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-tng-marine-600 px-2 py-1 text-[10px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-400"
          >
            editar
          </button>
          <button
            type="button"
            onClick={onToggleStatus}
            className="rounded-md border border-tng-marine-600 px-2 py-1 text-[10px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-400"
          >
            {inactive ? "reativar" : "desativar"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-tng-marine-600 px-2 py-1 text-[10px] text-tng-marine-300 hover:border-red-400 hover:text-red-300"
            title="Excluir definitivamente (admin)"
          >
            excluir
          </button>
        </div>
      </div>
    </li>
  );
}

function ClientForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Client;
  submitLabel: string;
  onSubmit: (input: ClientInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // 3 arrays dinâmicos de {label,url}. Cada um sempre tem pelo menos 1 linha
  // visível pra UX previsível. Vazios são limpos no lib/clients.ts antes do save.
  const [gmnLinks, setGmnLinks] = useState<ClientLink[]>(initLinks(initial?.google_business_urls));
  const [waLinks, setWaLinks] = useState<ClientLink[]>(initLinks(initial?.whatsapp_group_urls));
  const [driveLinks, setDriveLinks] = useState<ClientLink[]>(initLinks(initial?.drive_urls));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await onSubmit({
      name,
      alias: alias || null,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
      google_business_urls: gmnLinks,
      drive_urls: driveLinks,
      whatsapp_group_urls: waLinks,
    });
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-2 gap-3 rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-4"
    >
      <Field label="Nome *">
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Apelido (alias)">
        <input value={alias} onChange={(e) => setAlias(e.target.value)} className={inputClass} />
      </Field>
      <Field label="E-mail">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Telefone">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
      </Field>
      <div className="col-span-2">
        <Field label="Notas internas">
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inputClass} resize-none`}
          />
        </Field>
      </div>

      <div className="col-span-2 grid grid-cols-1 gap-4 border-t border-tng-marine-700 pt-4 md:grid-cols-3">
        <LinkArrayInput
          fieldLabel="Google Meu Negócio"
          iconClass="fa-solid fa-store"
          accent="sky"
          items={gmnLinks}
          onChange={setGmnLinks}
          urlPlaceholder="https://share.google/…"
          labelPlaceholder="Ex: Unidade Centro"
        />
        <LinkArrayInput
          fieldLabel="Grupo do WhatsApp"
          iconClass="fa-brands fa-whatsapp"
          accent="emerald"
          items={waLinks}
          onChange={setWaLinks}
          urlPlaceholder="https://chat.whatsapp.com/…"
          labelPlaceholder="Ex: Unidade Centro"
        />
        <LinkArrayInput
          fieldLabel="Google Drive"
          iconClass="fa-brands fa-google-drive"
          accent="orange"
          items={driveLinks}
          onChange={setDriveLinks}
          urlPlaceholder="https://drive.google.com/…"
          labelPlaceholder="Ex: Materiais gerais"
        />
      </div>

      <div className="col-span-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs text-tng-marine-300 hover:text-tng-marine-100"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Salvando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

type LinkAccent = "sky" | "emerald" | "orange";

// Lista dinâmica de pares (label, url). Reusada nas 3 categorias de link do
// cliente. Visualmente: header com ícone colorido pra identificar a categoria,
// cards leves sem borda, fundo do WhatsApp levemente esverdeado pra diferenciar.
function LinkArrayInput({
  fieldLabel,
  iconClass,
  accent,
  items,
  onChange,
  urlPlaceholder,
  labelPlaceholder,
}: {
  fieldLabel: string;
  iconClass: string;
  accent: LinkAccent;
  items: ClientLink[];
  onChange: (next: ClientLink[]) => void;
  urlPlaceholder: string;
  labelPlaceholder: string;
}) {
  function update(idx: number, patch: Partial<ClientLink>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function add() {
    onChange([...items, emptyLink()]);
  }
  function remove(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.length === 0 ? [emptyLink()] : next);
  }

  const iconColor =
    accent === "emerald"
      ? "text-emerald-400"
      : accent === "orange"
        ? "text-tng-orange-300"
        : "text-sky-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <i className={`${iconClass} ${iconColor} text-xs`} aria-hidden="true" />
        <span className="text-[10px] uppercase tracking-wider text-tng-marine-200">
          {fieldLabel}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((it, idx) => (
          <div key={idx} className="group relative rounded-md bg-tng-marine-900/40 p-2 pr-7">
            <input
              type="text"
              placeholder={labelPlaceholder}
              value={it.label}
              onChange={(e) => update(idx, { label: e.target.value })}
              className={`${inputClass} mb-1 text-xs`}
            />
            <input
              type="url"
              placeholder={urlPlaceholder}
              value={it.url}
              onChange={(e) => update(idx, { url: e.target.value })}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              disabled={items.length === 1 && it.label === "" && it.url === ""}
              aria-label="Remover link"
              title="Remover este link"
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-[11px] text-tng-marine-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-0"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="text-[11px] font-medium text-tng-orange-300 hover:text-tng-orange-200"
      >
        + adicionar link
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wider text-tng-marine-300">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2.5 py-1.5 text-sm text-tng-marine-100 placeholder:text-tng-marine-400 focus:border-tng-orange-400 focus:outline-none";
