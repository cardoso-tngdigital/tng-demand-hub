// =============================================================================
// ClientCommentsThread — thread de comentários no drawer do cliente (Sprint 20)
// =============================================================================
// Versão minimalista do `CommentsThread` (Sprint 7) — só texto puro, sem
// menções/RichText. Se o time precisar de menções aqui depois, basta plugar
// o `RichTextEditor` igual o de demanda faz.
//
// Comentários ordenados mais recentes em cima. Realtime via Supabase channel
// por client_id. Optimistic insert deduplicado pelo eco do INSERT.
// =============================================================================

import { useEffect, useState } from "react";
import {
  createClientComment,
  deleteClientComment,
  listClientComments,
  subscribeToClientComments,
} from "../lib/clientComments";
import type { ClientComment } from "../types/database";
import type { ProfileOption } from "../lib/lookups";

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  let rel: string;
  if (min < 1) rel = "agora";
  else if (min < 60) rel = `${min} min`;
  else if (min < 60 * 24) rel = `${Math.floor(min / 60)} h`;
  else rel = `${Math.floor(min / (60 * 24))} d`;
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const abs = sameYear
    ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : date.toLocaleDateString("pt-BR");
  return `${rel} · ${abs}`;
}

export function ClientCommentsThread({
  clientId,
  profiles,
  isAdmin,
  currentUserId,
}: {
  clientId: string;
  profiles: ProfileOption[];
  isAdmin: boolean;
  currentUserId: string | null;
}) {
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listClientComments(clientId).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      else setComments(res.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    const unsubscribe = subscribeToClientComments(clientId, (event, row) => {
      if (event === "INSERT") {
        setComments((prev) =>
          prev.some((c) => c.id === row.id) ? prev : [row, ...prev],
        );
      } else if (event === "DELETE") {
        setComments((prev) => prev.filter((c) => c.id !== row.id));
      }
    });
    return unsubscribe;
  }, [clientId]);

  async function handleSubmit() {
    if (submitting) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const { data, error } = await createClientComment(clientId, trimmed);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    if (data) {
      setComments((prev) =>
        prev.some((c) => c.id === data.id) ? prev : [data, ...prev],
      );
      setDraft("");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remover este comentário?")) return;
    const { error } = await deleteClientComment(id);
    if (error) setError(error);
    else setComments((prev) => prev.filter((c) => c.id !== id));
  }

  function authorName(id: string): string {
    return profiles.find((p) => p.id === id)?.full_name ?? "Desconhecido";
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-tng-marine-700 bg-tng-marine-800/40 p-2">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="Adicionar comentário sobre o cliente… (Cmd/Ctrl + Enter envia)"
          className="w-full resize-none bg-transparent text-xs text-tng-marine-100 placeholder:text-tng-marine-500 focus:outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || draft.trim() === ""}
            className="rounded-md bg-tng-orange-400 px-3 py-1 text-[11px] font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:opacity-50"
          >
            {submitting ? "Enviando…" : "Comentar"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-[11px] text-tng-marine-400">Carregando…</p>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-tng-marine-400">
          Nenhum comentário ainda. Seja o primeiro a registrar uma observação.
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => {
            const canDelete = isAdmin || c.author_id === currentUserId;
            return (
              <li
                key={c.id}
                className="rounded-md border border-tng-marine-700 bg-tng-marine-800/30 px-3 py-2"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-tng-marine-100">
                    {authorName(c.author_id)}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-tng-marine-400">
                    <span>{formatRelative(c.created_at)}</span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(c.id)}
                        title="Remover"
                        className="opacity-60 hover:text-red-300 hover:opacity-100"
                      >
                        <i className="fa-solid fa-trash-can text-[10px]" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-line text-xs text-tng-marine-200">
                  {c.content}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
