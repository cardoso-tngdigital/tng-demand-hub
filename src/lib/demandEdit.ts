// =============================================================================
// Diff entre uma demanda existente e o que a IA propôs pra editar
// =============================================================================
// Quando intencao=editar, comparamos a demanda alvo com os valores
// extraídos pela IA e geramos uma lista de mudanças pra revisão do user.
// Apenas campos que (a) a IA mencionou explicitamente (não-null) E (b) são
// realmente diferentes entram no diff — evita propor mudanças fantasma
// quando a IA cospe defaults.
// =============================================================================

import type { ExtractedDemand } from "./ai";
import type { DemandPatch } from "./demands";
import type { Demand } from "../types/database";

export type DiffField =
  | "title"
  | "client_id"
  | "assignee_id"
  | "priority"
  | "due_date"
  | "infrastructure"
  | "tags";

export type FieldDiff = {
  field: DiffField;
  label: string;
  oldValue: unknown;
  newValue: unknown;
};

const FIELD_LABELS: Record<DiffField, string> = {
  title: "Título",
  client_id: "Cliente",
  assignee_id: "Responsável",
  priority: "Prioridade",
  due_date: "Prazo",
  infrastructure: "Infraestrutura",
  tags: "Tags",
};

export function diffDemand(args: {
  current: Demand;
  proposed: ExtractedDemand;
  proposedClientId: string | null;
  proposedAssigneeId: string | null;
}): FieldDiff[] {
  const { current, proposed, proposedClientId, proposedAssigneeId } = args;
  const diffs: FieldDiff[] = [];

  // Cliente — só conta como diff se a IA identificou um cliente cadastrado
  // (id resolvido) e ele é diferente do atual.
  if (proposedClientId !== null && proposedClientId !== current.client_id) {
    diffs.push(makeDiff("client_id", current.client_id, proposedClientId));
  }

  // Responsável — idem
  if (
    proposedAssigneeId !== null &&
    proposedAssigneeId !== current.assignee_id
  ) {
    diffs.push(makeDiff("assignee_id", current.assignee_id, proposedAssigneeId));
  }

  // Título — só se a IA propôs algo diferente. Filtro de confiança não vale
  // aqui porque IA sempre retorna título.
  const newTitle = proposed.titulo.trim();
  if (newTitle && newTitle !== current.title) {
    diffs.push(makeDiff("title", current.title, newTitle));
  }

  // Prioridade — só se confiança >= 0.5. Caso contrário a IA pode estar
  // apenas devolvendo o default "media".
  if (
    proposed.prioridade !== current.priority &&
    proposed.confianca.prioridade >= 0.5
  ) {
    diffs.push(makeDiff("priority", current.priority, proposed.prioridade));
  }

  // Prazo — IA explícita (não null) E diferente.
  if (proposed.prazo !== null && proposed.prazo !== current.due_date) {
    diffs.push(makeDiff("due_date", current.due_date, proposed.prazo));
  }

  // Infraestrutura — IA explícita E diferente.
  if (
    proposed.infraestrutura !== null &&
    proposed.infraestrutura !== current.infrastructure
  ) {
    diffs.push(
      makeDiff("infrastructure", current.infrastructure, proposed.infraestrutura),
    );
  }

  // Tags — só conta como diff se a IA propôs algo (lista não vazia) e o
  // conteúdo é diferente.
  if (
    proposed.tags.length > 0 &&
    !sameStringArray(current.tags, proposed.tags)
  ) {
    diffs.push(makeDiff("tags", current.tags, proposed.tags));
  }

  return diffs;
}

function makeDiff(
  field: DiffField,
  oldValue: unknown,
  newValue: unknown,
): FieldDiff {
  return {
    field,
    label: FIELD_LABELS[field],
    oldValue,
    newValue,
  };
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Converte FieldDiff[] selecionados em DemandPatch (só os campos marcados
 * pelo user na revisão). Quando o user desmarca uma mudança, ela não entra
 * aqui — preserva o valor atual do banco.
 */
export function diffsToPatch(selected: FieldDiff[]): DemandPatch {
  const patch: DemandPatch = {};
  for (const d of selected) {
    switch (d.field) {
      case "title":
        patch.title = d.newValue as string;
        break;
      case "client_id":
        patch.client_id = d.newValue as string | null;
        break;
      case "assignee_id":
        patch.assignee_id = d.newValue as string | null;
        break;
      case "priority":
        patch.priority = d.newValue as Demand["priority"];
        break;
      case "due_date":
        patch.due_date = d.newValue as string | null;
        break;
      case "infrastructure":
        patch.infrastructure = d.newValue as Demand["infrastructure"];
        break;
      case "tags":
        patch.tags = d.newValue as string[];
        break;
    }
  }
  return patch;
}
