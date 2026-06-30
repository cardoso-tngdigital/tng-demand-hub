// =============================================================================
// ClientsPanelView — terceiro modo de visualização da Dashboard (Sprint 20)
// =============================================================================
// Renderiza uma grade de cards de cliente como alternativa à Lista/Kanban
// (orientados por demanda). Cada card mostra nome, alias, badge de fase do
// projeto e contagem de demandas (abertas/totais). Filtragem por busca em
// nome+alias+email (mesmo padrão da ClientsAdmin).
//
// Click no card abre o `ClientDetailDrawer` — passado pelo callback `onSelect`.
// =============================================================================

import { useMemo, useState } from "react";
import {
  CLIENT_PROJECT_PHASE_LABELS,
  type Client,
  type ClientProjectPhase,
} from "../types/database";
import type { ClientDemandCount } from "../lib/demands";

const PHASE_BADGE: Record<ClientProjectPhase, string> = {
  not_started: "border-tng-marine-600 bg-tng-marine-800/60 text-tng-marine-300",
  in_development: "border-tng-orange-400/40 bg-tng-orange-400/15 text-tng-orange-300",
  developed: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
};

function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function ClientsPanelView({
  clients,
  demandCounts,
  onSelectClient,
}: {
  clients: Client[];
  demandCounts: Record<string, ClientDemandCount>;
  onSelectClient: (clientId: string) => void;
}) {
  const [search, setSearch] = useState("");

  // Só ativos por padrão — não tem motivo pra um cliente inativo encher
  // a grade do painel. Se precisar, o user vai pra ClientsAdmin.
  const activeClients = useMemo(
    () => clients.filter((c) => c.status === "active"),
    [clients],
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(search.trim());
    if (!q) return activeClients;
    return activeClients.filter((c) => {
      const haystack = normalizeSearch(
        [c.name, c.alias ?? "", c.email ?? ""].join(" "),
      );
      return haystack.includes(q);
    });
  }, [activeClients, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <i
            className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-tng-marine-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente…"
            className="w-full rounded-md border border-tng-marine-700 bg-tng-marine-800/40 py-2 pl-9 pr-3 text-sm text-tng-marine-50 placeholder:text-tng-marine-400 focus:border-tng-orange-400 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-tng-marine-400 hover:bg-tng-marine-700 hover:text-tng-marine-100"
            >
              <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
            </button>
          )}
        </div>
        <span className="text-[11px] text-tng-marine-400 tabular-nums">
          {search
            ? `${filtered.length} de ${activeClients.length}`
            : `${activeClients.length} ativos`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-tng-marine-300">
          {search
            ? `Nenhum cliente bate com "${search}".`
            : "Nenhum cliente ativo. Cadastre um pelo botão 'Clientes' no header."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => {
            const counts = demandCounts[c.id] ?? { open: 0, total: 0 };
            const phaseLabel = CLIENT_PROJECT_PHASE_LABELS[c.project_phase];
            const phaseClasses = PHASE_BADGE[c.project_phase];
            const linksCount =
              c.google_business_urls.length +
              c.whatsapp_group_urls.length +
              c.drive_urls.length;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectClient(c.id)}
                  className="group flex w-full items-center gap-4 rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 px-4 py-3 text-left transition hover:border-tng-orange-400/60 hover:bg-tng-marine-800/70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <h3 className="truncate text-sm font-medium text-tng-marine-50 group-hover:text-tng-orange-300">
                        {c.name}
                      </h3>
                      {c.alias && (
                        <span className="truncate text-[11px] text-tng-marine-400">
                          · {c.alias}
                        </span>
                      )}
                    </div>
                  </div>

                  <span
                    className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${phaseClasses}`}
                  >
                    {phaseLabel}
                  </span>

                  <div className="shrink-0 flex items-center gap-3 text-[11px] text-tng-marine-300 tabular-nums">
                    {linksCount > 0 && (
                      <span title={`${linksCount} link(s) cadastrado(s)`} className="text-tng-marine-400">
                        <i className="fa-solid fa-link mr-0.5" aria-hidden="true" />
                        {linksCount}
                      </span>
                    )}
                    <span title="Demandas em aberto · totais">
                      <i
                        className="fa-regular fa-circle-dot mr-1 text-tng-orange-300"
                        aria-hidden="true"
                      />
                      {counts.open}
                      <span className="text-tng-marine-500"> · {counts.total}</span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
