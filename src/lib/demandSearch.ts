// =============================================================================
// Busca de demandas candidatas pra editar/comentar via chat
// =============================================================================
// Quando a IA detecta intenção "editar" ou "comentar", precisamos achar QUAL
// demanda existente é o alvo. Estratégia em duas etapas:
//
//   1. Filtro forte por cliente (se a IA extraiu um cliente conhecido).
//   2. Ranking por similaridade textual com título + descrição.
//
// Demandas arquivadas são excluídas (raramente são alvo de edit/comment).
// Concluídas (status=done) FICAM porque é comum atualizar uma demanda
// recém-fechada ("ah, deu pra fazer 3 a mais" → reabrir/comentar).
//
// Lista vazia significa "não achei nada" — o frontend deve mostrar opção
// "Criar nova" como fallback.
// =============================================================================

import type { Demand } from "../types/database";

export type CandidateWithScore = {
  demand: Demand;
  score: number;
};

const DEFAULT_LIMIT = 8;

/**
 * Acha demandas candidatas pra serem alvo de edit/comment.
 *
 * @param query — texto livre da captura (vai pra busca textual)
 * @param clientId — id de cliente identificado pela IA (filtro hard, se não-null)
 * @param allDemands — lista completa carregada do Dashboard
 * @param limit — máx candidatas devolvidas
 */
export function findCandidateDemands(
  query: string,
  clientId: string | null,
  allDemands: Demand[],
  limit: number = DEFAULT_LIMIT,
): Demand[] {
  const queryWords = tokenize(query);

  let candidates = allDemands.filter((d) => d.status !== "archived");

  if (clientId) {
    candidates = candidates.filter((d) => d.client_id === clientId);
  }

  if (candidates.length === 0) return [];

  const scored: CandidateWithScore[] = candidates.map((d) => ({
    demand: d,
    score: scoreDemand(d, queryWords),
  }));

  // Com clientId, todas as candidatas já são do cliente — ordenamos por
  // score desc e empate por mais recente. Mesmo score=0 vale: a IA pode
  // não ter mencionado palavras do título, mas só ter UMA demanda do
  // cliente é forte sinal sozinho.
  if (clientId) {
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.demand.created_at.localeCompare(a.demand.created_at);
    });
    return scored.slice(0, limit).map((s) => s.demand);
  }

  // Sem clientId, só retornamos com match textual real (score > 0). Caso
  // contrário ficaria flutuante.
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.demand.created_at.localeCompare(a.demand.created_at);
    })
    .slice(0, limit)
    .map((s) => s.demand);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3); // ignora "de", "no", "da", etc.
}

function scoreDemand(d: Demand, words: string[]): number {
  if (words.length === 0) return 0;
  const haystack = `${d.title} ${stripHtml(d.description)}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  let score = 0;
  for (const w of words) {
    if (haystack.includes(w)) score += 1;
  }
  return score;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}
