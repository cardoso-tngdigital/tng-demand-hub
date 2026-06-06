import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createComment,
  deleteComment,
  listComments,
  subscribeToComments,
} from "../lib/comments";
import { supabase } from "../lib/supabase/client";
import {
  isHtmlEmpty,
  legacyToHtml,
  sanitizeHtml,
} from "../lib/htmlContent";
import { RichTextEditor } from "./RichTextEditor";
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

  const profileNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name);
    return m;
  }, [profiles]);

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

  // Realtime: como a lista é ordenada por mais recente em cima, inserts vão
  // pro topo. updates só substituem em-lugar; deletes filtram.
  useEffect(() => {
    const unsubscribe = subscribeToComments(demandId, (event, comment) => {
      setComments((prev) => {
        if (event === "INSERT") {
          if (prev.some((c) => c.id === comment.id)) return prev;
          return [comment, ...prev];
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
    if (isHtmlEmpty(draft) || submitting) return;
    const payload = sanitizeHtml(draft);
    setSubmitting(true);
    setError(null);
    const { data, error } = await createComment(demandId, payload);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    setDraft("");
    if (data) {
      setComments((prev) => (prev.some((c) => c.id === data.id) ? prev : [data, ...prev]));
    }
  }, [draft, demandId, submitting]);

  const handleDelete = useCallback(async (id: string) => {
    const { error } = await deleteComment(id);
    if (error) setError(error);
    else setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return (
    <div className="space-y-3">
      <NewCommentForm
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        submitting={submitting}
      />

      {error && <p className="text-[11px] text-red-300">{error}</p>}

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
  // legacyToHtml é idempotente: HTML já sanitizado passa, conteúdo plain ou
  // markdown legado é convertido. Resultado já é seguro pra setInnerHTML.
  const html = useMemo(() => legacyToHtml(comment.content), [comment.content]);
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
      <div
        className="prose-rich text-xs leading-relaxed text-tng-marine-100"
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
  // Submit por ⌘↵ — captura no nível da janela enquanto o form existe.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const target = e.target as HTMLElement | null;
        // Só dispara se o foco está dentro do editor de comentário (data-attr
        // marcado abaixo) — evita conflitar com outros campos do drawer.
        if (target && target.closest("[data-comment-editor]")) {
          e.preventDefault();
          onSubmit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSubmit]);

  const empty = isHtmlEmpty(value);

  return (
    <div className="space-y-1.5">
      <div data-comment-editor>
        <RichTextEditor
          value={value}
          onChange={onChange}
          placeholder="Comentar…"
          variant="compact"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-tng-marine-400">
          <kbd className="rounded bg-tng-marine-700 px-1">⌘↵</kbd> envia · cole texto formatado direto
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || empty}
          className="rounded-md bg-tng-orange-400 px-2.5 py-1 text-[11px] font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Enviando…" : "Comentar"}
        </button>
      </div>
    </div>
  );
}
