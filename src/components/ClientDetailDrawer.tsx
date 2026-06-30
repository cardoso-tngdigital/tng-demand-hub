// =============================================================================
// ClientDetailDrawer — drawer lateral do cliente (Sprint 20)
// =============================================================================
// Aberto a partir dos cards do `ClientsPanelView` (3o modo da Dashboard).
// Mostra dados do cliente + lista de demandas vinculadas como mini-cards.
// Click numa demanda abre o `DemandDetailDrawer` empilhado por cima.
//
// O ESC do drawer respeita a prop `escDisabled` (true quando há outro drawer
// aberto sobre este) — assim só o topo da pilha responde à tecla.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listDemandsByClient } from "../lib/demands";
import { updateClient } from "../lib/clients";
import { ClientCommentsThread } from "./ClientCommentsThread";
import type { ProfileOption } from "../lib/lookups";
import {
  CLIENT_PROJECT_PHASE_LABELS,
  type Client,
  type ClientProjectPhase,
  type Demand,
  type DemandStatus,
} from "../types/database";

const PHASE_BADGE: Record<ClientProjectPhase, string> = {
  not_started: "border-tng-marine-600 bg-tng-marine-800/60 text-tng-marine-300",
  in_development: "border-tng-orange-400/40 bg-tng-orange-400/15 text-tng-orange-300",
  developed: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
};

// Versão "ativa" do badge (estado selecionado nos botões de fase).
const PHASE_BADGE_ACTIVE: Record<ClientProjectPhase, string> = {
  not_started: "border-tng-marine-400 bg-tng-marine-600 text-tng-marine-50",
  in_development: "border-tng-orange-400 bg-tng-orange-400/80 text-tng-marine-900",
  developed: "border-emerald-400 bg-emerald-500/80 text-emerald-50",
};

const STATUS_DOT: Record<DemandStatus, string> = {
  todo: "bg-tng-marine-400",
  doing: "bg-tng-orange-300",
  done: "bg-emerald-400",
  archived: "bg-tng-marine-600",
};

const STATUS_LABEL: Record<DemandStatus, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  done: "Concluída",
  archived: "Arquivada",
};

type DemandFilter = "all" | "open" | "done";

export function ClientDetailDrawer({
  client,
  profiles,
  isAdmin,
  currentUserId,
  onClose,
  onSelectDemand,
  onPatchClient,
  escDisabled,
}: {
  client: Client | null;
  profiles: ProfileOption[];
  isAdmin: boolean;
  currentUserId: string | null;
  onClose: () => void;
  onSelectDemand: (demandId: string) => void;
  // Notifica o caller (Dashboard) sobre mudanças no cliente pra que ele
  // atualize a lista local — assim a Sprint 16 (links) e o badge da fase
  // refletem em tempo real no painel.
  onPatchClient: (next: Client) => void;
  escDisabled?: boolean;
}) {
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DemandFilter>("all");
  const [savingPhase, setSavingPhase] = useState(false);
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  // Sincroniza o textarea local com o client passado (cliente trocou, ou
  // outro device editou via realtime e o caller renovou o objeto Client).
  useEffect(() => {
    setNotes(client?.notes ?? "");
  }, [client?.id, client?.notes]);

  useEffect(() => {
    if (!client) {
      setDemands([]);
      setFilter("all");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listDemandsByClient(client.id).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      else setDemands(res.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // ESC fecha o drawer — mas só se nenhum drawer empilhado estiver aberto.
  useEffect(() => {
    if (!client || escDisabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client, escDisabled, onClose]);

  const filteredDemands = useMemo(() => {
    if (filter === "open") {
      return demands.filter((d) => d.status === "todo" || d.status === "doing");
    }
    if (filter === "done") {
      return demands.filter((d) => d.status === "done");
    }
    return demands;
  }, [demands, filter]);

  const counts = useMemo(() => {
    let open = 0;
    let done = 0;
    for (const d of demands) {
      if (d.status === "todo" || d.status === "doing") open += 1;
      else if (d.status === "done") done += 1;
    }
    return { all: demands.length, open, done };
  }, [demands]);

  async function changePhase(nextPhase: ClientProjectPhase) {
    if (!client || savingPhase || nextPhase === client.project_phase) return;
    setSavingPhase(true);
    const { data, error } = await updateClient(client.id, { project_phase: nextPhase });
    setSavingPhase(false);
    if (error || !data) {
      setError(error ?? "Falha ao atualizar fase.");
      return;
    }
    onPatchClient(data);
  }

  async function saveNotes() {
    if (!client || savingNotes) return;
    const trimmed = notes.trim();
    const current = (client.notes ?? "").trim();
    if (trimmed === current) return;
    setSavingNotes(true);
    const { data, error } = await updateClient(client.id, { notes: trimmed || null });
    setSavingNotes(false);
    if (error || !data) {
      setError(error ?? "Falha ao salvar notas.");
      return;
    }
    onPatchClient(data);
  }

  async function openHref(href: string) {
    try {
      await openUrl(href);
    } catch (err) {
      console.error("[ClientDetailDrawer] openUrl falhou:", err);
    }
  }

  if (!client) return null;

  const links: { label: string; href: string; iconClass: string }[] = [];
  for (const item of client.google_business_urls) {
    links.push({
      label: item.label || "Google Meu Negócio",
      href: item.url,
      iconClass: "fa-solid fa-store",
    });
  }
  for (const item of client.whatsapp_group_urls) {
    links.push({
      label: item.label || "Grupo no WhatsApp",
      href: item.url,
      iconClass: "fa-brands fa-whatsapp",
    });
  }
  client.drive_urls.forEach((item, i) => {
    const fallback = client.drive_urls.length > 1 ? `Drive ${i + 1}` : "Google Drive";
    links.push({
      label: item.label || fallback,
      href: item.url,
      iconClass: "fa-brands fa-google-drive",
    });
  });

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[680px] flex-col border-l border-tng-marine-700 bg-tng-marine-900 shadow-2xl"
        role="dialog"
        aria-label={`Detalhes do cliente ${client.name}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-tng-marine-700 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-sans text-base font-semibold text-tng-marine-50">
              {client.name}
            </h2>
            {client.alias && (
              <p className="truncate text-xs text-tng-marine-400">{client.alias}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] uppercase tracking-wider text-tng-marine-400">
                Fase
              </span>
              {(Object.keys(CLIENT_PROJECT_PHASE_LABELS) as ClientProjectPhase[]).map((k) => {
                const active = client.project_phase === k;
                const cls = active ? PHASE_BADGE_ACTIVE[k] : PHASE_BADGE[k];
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={savingPhase}
                    onClick={() => void changePhase(k)}
                    aria-pressed={active}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition disabled:opacity-60 ${cls} ${active ? "" : "hover:brightness-125"}`}
                  >
                    {CLIENT_PROJECT_PHASE_LABELS[k]}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Info bar */}
          {(client.email || client.phone || client.status === "inactive") && (
            <dl className="mb-4 grid grid-cols-[80px_1fr] gap-y-1 text-[11px]">
              {client.email && (
                <>
                  <dt className="text-tng-marine-400">E-mail</dt>
                  <dd className="text-tng-marine-100">{client.email}</dd>
                </>
              )}
              {client.phone && (
                <>
                  <dt className="text-tng-marine-400">Telefone</dt>
                  <dd className="text-tng-marine-100">{client.phone}</dd>
                </>
              )}
              {client.status === "inactive" && (
                <>
                  <dt className="text-tng-marine-400">Status</dt>
                  <dd className="text-amber-300">Inativo</dd>
                </>
              )}
            </dl>
          )}

          {/* Links */}
          {links.length > 0 && (
            <section className="mb-5">
              <h3 className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-400">
                Links
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {links.map((l, idx) => (
                  <li key={`${l.label}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => void openHref(l.href)}
                      title={l.href}
                      className="flex items-center gap-1.5 rounded-md border border-tng-marine-600 bg-tng-marine-800/60 px-2 py-1 text-[11px] text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-300"
                    >
                      <i className={l.iconClass} aria-hidden="true" />
                      <span>{l.label}</span>
                      <i
                        className="fa-solid fa-arrow-up-right-from-square text-[9px] text-tng-marine-400"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Notas internas — editáveis, salva on blur */}
          <section className="mb-5">
            <h3 className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-400">
              Notas internas
            </h3>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => void saveNotes()}
              disabled={savingNotes}
              placeholder="Adicione observações internas sobre o cliente…"
              className="w-full resize-none rounded-md border border-tng-marine-700 bg-tng-marine-800/40 px-3 py-2 text-xs text-tng-marine-100 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none disabled:opacity-60"
            />
          </section>

          {/* Demandas */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-[10px] uppercase tracking-wider text-tng-marine-400">
                Demandas
              </h3>
              <div className="flex overflow-hidden rounded-md border border-tng-marine-600 text-[10px]">
                <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
                  Todas <span className="opacity-60">({counts.all})</span>
                </FilterButton>
                <FilterButton active={filter === "open"} onClick={() => setFilter("open")}>
                  Abertas <span className="opacity-60">({counts.open})</span>
                </FilterButton>
                <FilterButton active={filter === "done"} onClick={() => setFilter("done")}>
                  Concluídas <span className="opacity-60">({counts.done})</span>
                </FilterButton>
              </div>
            </div>

            {loading ? (
              <p className="text-xs text-tng-marine-300">Carregando…</p>
            ) : error ? (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            ) : filteredDemands.length === 0 ? (
              <p className="text-xs text-tng-marine-400">
                {demands.length === 0
                  ? "Esse cliente ainda não tem demandas."
                  : "Nenhuma demanda neste filtro."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {filteredDemands.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => onSelectDemand(d.id)}
                      className="group flex w-full items-start gap-2 rounded-md border border-tng-marine-700 bg-tng-marine-800/40 px-3 py-2 text-left transition hover:border-tng-orange-400/60 hover:bg-tng-marine-800/70"
                    >
                      <span
                        className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[d.status]}`}
                        title={STATUS_LABEL[d.status]}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-tng-marine-50 group-hover:text-tng-orange-300">
                          {d.title || d.description.split("\n")[0] || "(sem título)"}
                        </span>
                        <span className="text-[10px] text-tng-marine-400">
                          {STATUS_LABEL[d.status]} · {formatShortDate(d.created_at)}
                          {d.due_date && ` · Prazo ${formatShortDate(d.due_date)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Comentários do cliente — observações coletivas que não são
              específicas de uma demanda. */}
          <section className="mt-6">
            <h3 className="mb-2 text-[10px] uppercase tracking-wider text-tng-marine-400">
              Comentários
            </h3>
            <ClientCommentsThread
              clientId={client.id}
              profiles={profiles}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
            />
          </section>
        </div>
      </aside>
    </>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 transition ${
        active
          ? "bg-tng-marine-600 text-tng-marine-50"
          : "text-tng-marine-300 hover:bg-tng-marine-700/60 hover:text-tng-marine-100"
      }`}
    >
      {children}
    </button>
  );
}

function formatShortDate(iso: string): string {
  // YYYY-MM-DD pra evitar surpresas com timezones (Sprint 11 fix).
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}
