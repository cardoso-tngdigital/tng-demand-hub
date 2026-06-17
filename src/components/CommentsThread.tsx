import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createComment,
  deleteComment,
  listComments,
  subscribeToComments,
} from "../lib/comments";
import {
  extractMentionIdsFromHtml,
  isHtmlEmpty,
  legacyToHtml,
  sanitizeHtml,
} from "../lib/htmlContent";
import { RichTextEditor } from "./RichTextEditor";
import type { ProfileOption } from "../lib/lookups";
import type { Comment } from "../types/database";

// Combina relativa ("agora", "5 min", "3 h", "2 d") com data absoluta curta
// (DD/MM). Acima de 1 ano cai pra DD/MM/YY pra evitar ambiguidade quando o
// projeto envelhecer. Sempre mostra a data — assim o user não precisa ficar
// fazendo conta de "1d atrás" 100 dias depois.
function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);

  let relative: string;
  if (min < 1) relative = "agora";
  else if (min < 60) relative = `${min} min`;
  else {
    const h = Math.floor(min / 60);
    if (h < 24) relative = `${h} h`;
    else relative = `${Math.floor(h / 24)} d`;
  }

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const absolute = sameYear
    ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : date.toLocaleDateString("pt-BR");

  // "agora" não precisa repetir a data (tá acontecendo); todo o resto leva.
  return relative === "agora" ? "agora" : `${relative} · ${absolute}`;
}

export function CommentsThread({
  demandId,
  profiles,
  isAdmin,
}: {
  demandId: string;
  profiles: ProfileOption[];
  // Apenas admins podem apagar comentários. Antes qualquer autor apagava o
  // próprio; mudamos pra centralizar a decisão de "remover histórico" na
  // figura do admin. A RLS também é endurecida no Bloco 2.
  isAdmin: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const profileNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name);
    return m;
  }, [profiles]);

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
    // Extrai menções a partir do HTML *já sanitizado* pra garantir que ids
    // fora do schema (rejeitados pelo DOMPurify) não vazem pra notificação.
    const mentions = extractMentionIdsFromHtml(payload);
    setSubmitting(true);
    setError(null);
    const { data, error } = await createComment(demandId, payload, mentions);
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
        mentionProfiles={profiles}
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
              canDelete={isAdmin}
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
  mentionProfiles,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  mentionProfiles: ProfileOption[];
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
          placeholder="Comentar… (use @ para marcar alguém)"
          variant="compact"
          mentionProfiles={mentionProfiles}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-tng-marine-400">
          <kbd className="rounded bg-tng-marine-700 px-1">⌘↵</kbd> envia · digite <kbd className="rounded bg-tng-marine-700 px-1">@</kbd> para marcar
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
