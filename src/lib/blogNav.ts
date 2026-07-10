// =============================================================================
// blogNav.ts — bus mínimo de navegação interna do painel Blog
// =============================================================================
// Permite que qualquer código (ex.: ação de um toast) peça ao BlogPanel pra
// trocar de aba e, opcionalmente, abrir o drawer de um site numa aba
// específica. Mesmo padrão do bus de toast: módulo simples, sem Context.
// =============================================================================

export type BlogNavRequest = {
  tab: "novo" | "sites" | "prompt" | "uso" | "notificacoes" | "config";
  /** Quando `tab === "sites"`: abre o drawer deste site após carregar. */
  siteId?: string;
  /** Aba inicial do drawer do site (default "programacao"). */
  drawerTab?: "programacao" | "historico";
};

type Listener = (req: BlogNavRequest) => void;

const listeners = new Set<Listener>();

/** BlogPanel assina aqui. Retorna a função de cancelamento. */
export function subscribeBlogNav(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pede navegação. No-op silencioso se o painel não estiver montado. */
export function navigateBlog(req: BlogNavRequest): void {
  for (const l of listeners) l(req);
}
