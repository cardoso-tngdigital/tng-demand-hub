// =============================================================================
// toast.ts — bus mínimo de notificações flutuantes (topo direito) do Blog
// =============================================================================
// Um event bus a nível de módulo, sem Context/Provider. Qualquer componente
// chama `showToast(...)` e o `<ToastHost/>` (montado uma vez no BlogPanel)
// renderiza + auto-descarta. Escolhido bus em vez de Context pra permitir
// disparar toast de qualquer lugar (inclusive fora da árvore React do painel)
// sem embrulhar tudo num provider.
// =============================================================================

import type { BlogNotificacaoTipo } from "../types/blog";

export type ToastTipo = BlogNotificacaoTipo; // info | success | warning | error

export type Toast = {
  id: string;
  tipo: ToastTipo;
  titulo: string;
  mensagem?: string;
  /** URL opcional — vira botão "Abrir post" no toast. */
  postUrl?: string;
  /** Ação custom opcional — vira botão; clicar executa e fecha o toast. */
  acao?: { label: string; onClick: () => void };
  /** ms até sumir sozinho. 0 = não some sozinho (só no X). Default 6000. */
  duracao?: number;
};

/** Entrada do `showToast` — o `id` é gerado aqui. */
export type ToastInput = Omit<Toast, "id">;

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  // Cópia defensiva pra os assinantes não mexerem no array interno.
  const snapshot = [...toasts];
  for (const l of listeners) l(snapshot);
}

/** Assina mudanças na fila de toasts. Retorna a função de cancelamento. */
export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

/** Dispara um toast. Retorna o id (pra remover manualmente, se precisar). */
export function showToast(input: ToastInput): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const toast: Toast = { id, ...input };
  toasts = [toast, ...toasts].slice(0, 5); // no máx 5 empilhados
  emit();
  return id;
}

/** Remove um toast pelo id (chamado pelo auto-dismiss ou pelo botão X). */
export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
