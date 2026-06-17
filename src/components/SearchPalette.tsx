import { useEffect, useMemo, useRef, useState } from "react";
import { htmlToPlainText, legacyToHtml } from "../lib/htmlContent";
import { supabase } from "../lib/supabase/client";
import type { Demand, DemandPriority, DemandStatus } from "../types/database";

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

const MAX_RESULTS = 10;
const COMMENT_DEBOUNCE_MS = 250;

type Scored = { demand: Demand; score: number; commentExcerpt: string | null };

/**
 * Pontua a demanda contra a query. Maior é melhor; zero significa "fora".
 * Match no título vale mais que descrição, que vale mais que tag.
 */
function scoreDemand(demand: Demand, q: string): number {
  if (!q) return 1;
  const norm = (s: string) => s.toLowerCase();
  const query = norm(q);
  let score = 0;
  if (norm(demand.title).includes(query)) score += 5;
  // Descrição é HTML/markdown — busca no texto plano.
  if (norm(htmlToPlainText(legacyToHtml(demand.description))).includes(query)) score += 3;
  for (const tag of demand.tags) {
    if (norm(tag).includes(query)) {
      score += 2;
      break;
    }
  }
  return score;
}

export function SearchPalette({
  open,
  demands,
  onClose,
  onSelect,
}: {
  open: boolean;
  demands: Demand[];
  onClose: () => void;
  onSelect: (demandId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Matches vindos de busca server-side em comments (debounced).
  const [commentMatches, setCommentMatches] = useState<CommentMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reseta input e foco quando abre
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setCommentMatches([]);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // Busca em comentários: debounced, só dispara após 2 chars pra não floodar
  // o backend. Resultados ficam armazenados em commentMatches e são
  // mesclados com a busca local em `results`.
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

  const results = useMemo<Scored[]>(() => {
    const trimmed = query.trim();
    const commentByDemandId = new Map(commentMatches.map((m) => [m.demand_id, m.excerpt]));
    return demands
      .map((d) => {
        const score = scoreDemand(d, trimmed);
        const commentExcerpt = commentByDemandId.get(d.id) ?? null;
        // Match em comentário soma 1 — abaixo de tag (2) pra que matches mais
        // diretos no campo da demanda apareçam primeiro.
        const total = score + (commentExcerpt ? 1 : 0);
        return { demand: d, score: total, commentExcerpt };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || (a.demand.title || "").localeCompare(b.demand.title || ""))
      .slice(0, MAX_RESULTS);
  }, [demands, query, commentMatches]);

  // Mantém o índice ativo dentro do range conforme os resultados mudam
  useEffect(() => {
    if (activeIndex >= results.length) {
      setActiveIndex(Math.max(0, results.length - 1));
    }
  }, [results, activeIndex]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen = results[activeIndex];
      if (chosen) {
        onSelect(chosen.demand.id);
        onClose();
      }
    }
  }

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
            placeholder="Buscar em título, descrição, tags ou comentários…"
            className="flex-1 bg-transparent text-sm text-tng-marine-50 placeholder:text-tng-marine-400 focus:outline-none"
          />
          <kbd className="rounded bg-tng-marine-700 px-1.5 py-0.5 text-[10px] text-tng-marine-300">
            esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-tng-marine-400">
              {query.trim() ? "Nada encontrado." : "Digite para buscar."}
            </p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <ResultRow
                  key={r.demand.id}
                  demand={r.demand}
                  commentExcerpt={r.commentExcerpt}
                  active={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    onSelect(r.demand.id);
                    onClose();
                  }}
                />
              ))}
            </ul>
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
          <span>{results.length} resultado{results.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  demand,
  commentExcerpt,
  active,
  onMouseEnter,
  onClick,
}: {
  demand: Demand;
  commentExcerpt: string | null;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <li
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition ${
        active ? "bg-tng-marine-700" : "hover:bg-tng-marine-700/40"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[demand.priority]}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-tng-marine-50">
          {demand.title || htmlToPlainText(legacyToHtml(demand.description)).slice(0, 80)}
        </p>
        {commentExcerpt ? (
          <p className="truncate text-[10px] text-tng-marine-400">
            <i className="fa-regular fa-comment mr-1" aria-hidden="true" />
            …{commentExcerpt}…
          </p>
        ) : demand.title && demand.description ? (
          <p className="truncate text-[10px] text-tng-marine-400">
            {htmlToPlainText(legacyToHtml(demand.description))}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 rounded-full bg-tng-marine-700/80 px-2 py-0.5 text-[9px] uppercase tracking-wider text-tng-marine-200">
        {STATUS_LABEL[demand.status]}
      </span>
    </li>
  );
}
