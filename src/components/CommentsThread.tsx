import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createComment,
  deleteComment,
  listComments,
  subscribeToComments,
} from "../lib/comments";
import { supabase } from "../lib/supabase/client";
import type { ProfileOption } from "../lib/lookups";
import type { Comment } from "../types/database";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function CommentsThread({
  demandId,
  profiles,
}: {
  demandId: string;
  profiles: ProfileOption[];
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Mapa profile_id → nome para mostrar autor sem nova query por comentário
  const profileNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name);
    return m;
  }, [profiles]);

  // Identifica o usuário corrente (para mostrar botão remover só nos próprios)
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Carrega comentários quando muda a demanda
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setComments([]);
    (async () => {
      const { data, error } = await listComments(demandId);
      if (cancelled) return;
      if (error) setError(error);
      else setComments(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [demandId]);

  // Subscreve realtime apenas para esta demanda
  useEffect(() => {
    const unsubscribe = subscribeToComments(demandId, (event, comment) => {
      setComments((prev) => {
        if (event === "INSERT") {
          if (prev.some((c) => c.id === comment.id)) return prev;
          return [...prev, comment];
        }
        if (event === "UPDATE") {
          return prev.map((c) => (c.id === comment.id ? comment : c));
        }
        if (event === "DELETE") {
          return prev.filter((c) => c.id !== comment.id);
        }
        return prev;
      });
    });
    return unsubscribe;
  }, [demandId]);

  const handleSubmit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    const { data, error } = await createComment(demandId, trimmed);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    setDraft("");
    if (data) {
      // Insere otimisticamente; realtime vai deduplicar pelo id.
      setComments((prev) => (prev.some((c) => c.id === data.id) ? prev : [...prev, data]));
    }
  }, [draft, demandId, submitting]);

  const handleDelete = useCallback(async (id: string) => {
    const { error } = await deleteComment(id);
    if (error) setError(error);
    else setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-xs text-tng-marine-400">Carregando comentários…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-tng-marine-400">Nenhum comentário ainda.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              authorName={profileNameById.get(c.author_id) ?? "—"}
              canDelete={c.author_id === currentUserId}
              onDelete={() => handleDelete(c.id)}
            />
          ))}
        </ul>
      )}

      <NewCommentForm
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        submitting={submitting}
      />

      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

function CommentItem({
  comment,
  authorName,
  canDelete,
  onDelete,
}: {
  comment: Comment;
  authorName: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-md bg-tng-marine-700/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-medium text-tng-marine-100">{authorName}</span>
        <span className="text-[10px] text-tng-marine-400">
          {formatRelative(comment.created_at)}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto text-[10px] text-tng-marine-400 hover:text-red-300"
            aria-label="Remover comentário"
          >
            remover
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-tng-marine-100">
        {comment.content}
      </p>
    </li>
  );
}

function NewCommentForm({
  value,
  onChange,
  onSubmit,
  submitting,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="space-y-1.5">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        placeholder="Comentar…"
        disabled={submitting}
        className="block w-full resize-none rounded-md border border-tng-marine-600 bg-tng-marine-800 px-3 py-2 text-xs text-tng-marine-100 placeholder:text-tng-marine-400 focus:border-tng-orange-400 focus:outline-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-tng-marine-400">
          <kbd className="rounded bg-tng-marine-700 px-1">⌘↵</kbd> envia
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || value.trim().length === 0}
          className="rounded-md bg-tng-orange-400 px-2.5 py-1 text-[11px] font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Enviando…" : "Comentar"}
        </button>
      </div>
    </div>
  );
}
