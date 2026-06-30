// =============================================================================
// SearchPalette — busca rápida estilo Linear (Cmd/Ctrl + K)
// =============================================================================
// Agrupa resultados em 3 seções: Clientes, Demandas, Comentários.
// - Clientes: matches em name/alias/email/notes (client-side).
// - Demandas: matches em title/descrição (em texto plano)/tags (client-side),
//   sempre com o nome do cliente (quando houver) concatenado pro haystack,
//   pra que digitar o nome do cliente liste suas demandas.
// - Comentários: server-side via RPC `search_comment_demand_ids` (Sprint 14).
//
// Normalização: todos os campos passam por NFD + lowercase pra que "metodo"
// case com "Método Ambiental" (sem isso, "é" ≠ "e" em string compare).
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { htmlToPlainText, legacyToHtml } from "../lib/htmlContent";
import { supabase } from "../lib/supabase/client";
import type {
  Client,
  Demand,
  DemandPriority,
  DemandStatus,
} from "../types/database";

type CommentMatch = { demand_id: string; excerpt: string };

const STATUS_LABEL: Record<DemandStatus, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  done: "Concluída",
  archived: "Arquivada",
};

const PRIORITY_DOT: Record<DemandPriority, string> = {
  baixa: "bg-tng-marine-400",
  media: "bg-sky-400",
  alta: "bg-tng-orange-400",
  urgente: "bg-red-500",
};

const MAX_PER_GROUP = 8;
const COMMENT_DEBOUNCE_MS = 250;

// NFD decompõe acentos em letras base + diacrítico; o regex tira só os
// diacríticos. Resultado: "Método" → "metodo", "ação" → "acao". Casamento
// fica resistente a digitação sem acento, que é o caso comum.
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

type ClientResult = {
  kind: "client";
  client: Client;
  score: number;
};

type DemandResult = {
  kind: "demand";
  demand: Demand;
  clientName: string | null;
  score: number;
};

type CommentResult = {
  kind: "comment";
  demand: Demand;
  clientName: string | null;
  excerpt: string;
};

type AnyResult = ClientResult | DemandResult | CommentResult;

export function SearchPalette({
  open,
  demands,
  clients,
  onClose,
  onSelectDemand,
  onSelectClient,
}: {
  open: boolean;
  demands: Demand[];
  // Pode ser null (Dashboard ainda não carregou clientes completos —
  // sem dados de cliente, busca de clientes fica vazia mas demandas
  // e comentários continuam funcionando).
  clients: Client[] | null;
  onClose: () => void;
  onSelectDemand: (demandId: string) => void;
  onSelectClient: (clientId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [commentMatches, setCommentMatches] = useState<CommentMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setCommentMatches([]);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // Busca em comentários: debounced, só dispara após 2 chars.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setCommentMatches([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_comment_demand_ids", {
        q: trimmed,
      });
      if (cancelled) return;
      if (error) {
        console.error("[SearchPalette] busca em comentários falhou:", error);
        setCommentMatches([]);
        return;
      }
      setCommentMatches((data ?? []) as CommentMatch[]);
    }, COMMENT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, query]);

  // Mapa rápido client_id → Client pra hidratar nome do cliente nas demandas.
  const clientById = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients ?? []) map.set(c.id, c);
    return map;
  }, [clients]);

  const grouped = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return { clients: [] as ClientResult[], demands: [] as DemandResult[], comments: [] as CommentResult[] };
    }
    const q = normalize(trimmed);

    // ---- Clientes ----
    const clientResults: ClientResult[] = [];
    for (const c of clients ?? []) {
      const haystack = normalize(
        [c.name, c.alias ?? "", c.email ?? "", c.notes ?? ""].join(" "),
      );
      if (!haystack.includes(q)) continue;
      // Score: nome 5, alias 3, email 2, notas 1.
      let score = 0;
      if (normalize(c.name).includes(q)) score += 5;
      if (c.alias && normalize(c.alias).includes(q)) score += 3;
      if (c.email && normalize(c.email).includes(q)) score += 2;
      if (c.notes && normalize(c.notes).includes(q)) score += 1;
      clientResults.push({ kind: "client", client: c, score });
    }
    clientResults.sort((a, b) => b.score - a.score || a.client.name.localeCompare(b.client.name));

    // ---- Demandas ----
    const demandResults: DemandResult[] = [];
    for (const d of demands) {
      const client = d.client_id ? clientById.get(d.client_id) ?? null : null;
      const clientName = client?.name ?? null;
      const titleN = normalize(d.title);
      const descN = normalize(htmlToPlainText(legacyToHtml(d.description)));
      const tagsN = d.tags.map(normalize);
      const clientN = clientName ? normalize(clientName) : "";
      const aliasN = client?.alias ? normalize(client.alias) : "";

      let score = 0;
      if (titleN.includes(q)) score += 5;
      if (descN.includes(q)) score += 3;
      if (tagsN.some((t) => t.includes(q))) score += 2;
      // Match no nome do cliente sobe a demanda — comum usuário digitar
      // "metodo" pra achar as demandas do cliente Método Ambiental.
      if (clientN.includes(q) || aliasN.includes(q)) score += 2;
      if (score > 0) {
        demandResults.push({ kind: "demand", demand: d, clientName, score });
      }
    }
    demandResults.sort((a, b) => b.score - a.score || (a.demand.title || "").localeCompare(b.demand.title || ""));

    // ---- Comentários (server-side, já filtrado por similaridade) ----
    const commentResults: CommentResult[] = [];
    const demandById = new Map(demands.map((d) => [d.id, d]));
    for (const m of commentMatches) {
      const d = demandById.get(m.demand_id);
      if (!d) continue;
      const client = d.client_id ? clientById.get(d.client_id) ?? null : null;
      commentResults.push({
        kind: "comment",
        demand: d,
        clientName: client?.name ?? null,
        excerpt: m.excerpt,
      });
    }

    return {
      clients: clientResults.slice(0, MAX_PER_GROUP),
      demands: demandResults.slice(0, MAX_PER_GROUP),
      comments: commentResults.slice(0, MAX_PER_GROUP),
    };
  }, [clients, demands, query, commentMatches, clientById]);

  // Lista flat unificada na ordem de exibição — pra navegação por setas.
  const flat = useMemo<AnyResult[]>(
    () => [...grouped.clients, ...grouped.demands, ...grouped.comments],
    [grouped],
  );

  useEffect(() => {
    if (activeIndex >= flat.length) {
      setActiveIndex(Math.max(0, flat.length - 1));
    }
  }, [flat, activeIndex]);

  if (!open) return null;

  function pick(r: AnyResult) {
    if (r.kind === "client") {
      onSelectClient(r.client.id);
    } else {
      onSelectDemand(r.demand.id);
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen = flat[activeIndex];
      if (chosen) pick(chosen);
    }
  }

  // Calcula o índice global de cada resultado dentro de cada grupo, pra
  // saber qual está "ativo" durante a renderização.
  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-tng-marine-600 bg-tng-marine-800 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-tng-marine-700 px-4 py-3">
          <i className="fa-solid fa-magnifying-glass text-tng-marine-400" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar clientes, demandas e comentários…"
            className="flex-1 bg-transparent text-sm text-tng-marine-50 placeholder:text-tng-marine-400 focus:outline-none"
          />
          <kbd className="rounded bg-tng-marine-700 px-1.5 py-0.5 text-[10px] text-tng-marine-300">
            esc
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {flat.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-tng-marine-400">
              {query.trim() ? "Nada encontrado." : "Digite para buscar."}
            </p>
          ) : (
            <>
              {grouped.clients.length > 0 && (
                <Group label="Clientes" count={grouped.clients.length}>
                  {grouped.clients.map((r) => {
                    const i = runningIndex++;
                    return (
                      <ClientRow
                        key={`c-${r.client.id}`}
                        client={r.client}
                        active={i === activeIndex}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => pick(r)}
                      />
                    );
                  })}
                </Group>
              )}

              {grouped.demands.length > 0 && (
                <Group label="Demandas" count={grouped.demands.length}>
                  {grouped.demands.map((r) => {
                    const i = runningIndex++;
                    return (
                      <DemandRow
                        key={`d-${r.demand.id}`}
                        demand={r.demand}
                        clientName={r.clientName}
                        active={i === activeIndex}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => pick(r)}
                      />
                    );
                  })}
                </Group>
              )}

              {grouped.comments.length > 0 && (
                <Group label="Comentários" count={grouped.comments.length}>
                  {grouped.comments.map((r) => {
                    const i = runningIndex++;
                    return (
                      <CommentRow
                        key={`cm-${r.demand.id}`}
                        demand={r.demand}
                        clientName={r.clientName}
                        excerpt={r.excerpt}
                        active={i === activeIndex}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => pick(r)}
                      />
                    );
                  })}
                </Group>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-tng-marine-700 bg-tng-marine-800/60 px-4 py-2 text-[10px] text-tng-marine-400">
          <span>
            <kbd className="rounded bg-tng-marine-700 px-1 py-0.5">↑</kbd>{" "}
            <kbd className="rounded bg-tng-marine-700 px-1 py-0.5">↓</kbd> navegar
          </span>
          <span>
            <kbd className="rounded bg-tng-marine-700 px-1 py-0.5">↵</kbd> abrir
          </span>
          <span>{flat.length} resultado{flat.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="sticky top-0 z-[1] flex items-center justify-between border-b border-tng-marine-700/60 bg-tng-marine-800/95 px-4 py-1.5 text-[9px] uppercase tracking-wider text-tng-marine-400 backdrop-blur">
        <span>{label}</span>
        <span className="tabular-nums">{count}</span>
      </header>
      <ul>{children}</ul>
    </section>
  );
}

function RowShell({
  active,
  onMouseEnter,
  onClick,
  children,
}: {
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <li
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition ${
        active ? "bg-tng-marine-700" : "hover:bg-tng-marine-700/40"
      }`}
    >
      {children}
    </li>
  );
}

function ClientRow({
  client,
  active,
  onMouseEnter,
  onClick,
}: {
  client: Client;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <RowShell active={active} onMouseEnter={onMouseEnter} onClick={onClick}>
      <i className="fa-solid fa-building w-4 shrink-0 text-tng-orange-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-tng-marine-50">{client.name}</p>
        {client.alias && (
          <p className="truncate text-[10px] text-tng-marine-400">{client.alias}</p>
        )}
      </div>
      <span className="shrink-0 rounded-full bg-tng-marine-700/80 px-2 py-0.5 text-[9px] uppercase tracking-wider text-tng-marine-200">
        Cliente
      </span>
    </RowShell>
  );
}

function DemandRow({
  demand,
  clientName,
  active,
  onMouseEnter,
  onClick,
}: {
  demand: Demand;
  clientName: string | null;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <RowShell active={active} onMouseEnter={onMouseEnter} onClick={onClick}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[demand.priority]}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-tng-marine-50">
          {demand.title || htmlToPlainText(legacyToHtml(demand.description)).slice(0, 80)}
        </p>
        {clientName && (
          <p className="truncate text-[10px] text-tng-marine-400">{clientName}</p>
        )}
      </div>
      <span className="shrink-0 rounded-full bg-tng-marine-700/80 px-2 py-0.5 text-[9px] uppercase tracking-wider text-tng-marine-200">
        {STATUS_LABEL[demand.status]}
      </span>
    </RowShell>
  );
}

function CommentRow({
  demand,
  clientName,
  excerpt,
  active,
  onMouseEnter,
  onClick,
}: {
  demand: Demand;
  clientName: string | null;
  excerpt: string;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <RowShell active={active} onMouseEnter={onMouseEnter} onClick={onClick}>
      <i className="fa-regular fa-comment w-4 shrink-0 text-tng-marine-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-tng-marine-200">
          …{excerpt}…
        </p>
        <p className="truncate text-[10px] text-tng-marine-400">
          em: {demand.title || htmlToPlainText(legacyToHtml(demand.description)).slice(0, 60)}
          {clientName && <span className="text-tng-marine-500"> · {clientName}</span>}
        </p>
      </div>
    </RowShell>
  );
}
