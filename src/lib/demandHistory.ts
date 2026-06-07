// =============================================================================
// Histórico de alterações por demanda
// =============================================================================
// A tabela demand_history é alimentada por triggers no banco. O frontend só lê
// (RLS deixa apenas admins ler), formata os eventos em pt-BR e mostra no
// drawer. Tradução de IDs (status, priority, etc.) acontece aqui pra centralizar
// a UX de "humanização" dos valores brutos do schema.
// =============================================================================

import { supabase } from "./supabase/client";
import type { DemandHistoryRow } from "../types/database";

export async function listHistory(
  demandId: string,
): Promise<{ data: DemandHistoryRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("demand_history")
    .select("*")
    .eq("demand_id", demandId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[demand_history] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as DemandHistoryRow[]) ?? [], error: null };
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descrição",
  status: "Status",
  priority: "Prioridade",
  due_date: "Prazo",
  client_id: "Cliente",
  assignee_id: "Responsável",
  infrastructure: "Infraestrutura",
  tags: "Tags",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "A fazer",
  doing: "Em andamento",
  done: "Concluída",
  archived: "Arquivada",
};

const PRIORITY_LABELS: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

const INFRA_LABELS: Record<string, string> = {
  wordpress: "WordPress",
  site_ia: "Site com IA",
};

export function fieldLabel(field: string | null | undefined): string {
  if (!field) return "Campo";
  return FIELD_LABELS[field] ?? field;
}

/**
 * Traduz o valor bruto do banco pra algo legível na linha do tempo.
 * - IDs de cliente/responsável precisam de lookup externo (clientNameById /
 *   profileNameById) — vem como parâmetro opcional.
 * - HTML da descrição é tratado como "(texto extenso)" pra evitar dumpar
 *   markup no log de auditoria.
 */
export function formatFieldValue(
  field: string,
  value: string | null,
  ctx?: { clientName?: string; profileName?: string },
): string {
  if (value === null) return "—";
  if (field === "status") return STATUS_LABELS[value] ?? value;
  if (field === "priority") return PRIORITY_LABELS[value] ?? value;
  if (field === "infrastructure") return INFRA_LABELS[value] ?? value;
  if (field === "description") {
    const stripped = value.replace(/<[^>]+>/g, "").trim();
    if (!stripped) return "—";
    if (stripped.length > 40) return `"${stripped.slice(0, 40)}…"`;
    return `"${stripped}"`;
  }
  if (field === "client_id") return ctx?.clientName ?? value;
  if (field === "assignee_id") return ctx?.profileName ?? value;
  if (field === "due_date") {
    // YYYY-MM-DD vem do Postgres como string sem TZ. Parsear via Date faria
    // GMT-3 voltar 1 dia (00:00 UTC → 21:00 do dia anterior local). Formato
    // manualmente pra evitar.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return value;
  }
  return value;
}

// Frase resumo do evento — usada no item da timeline. Vem sem o nome do ator
// (esse vai num <span> separado), pra que o componente decida estilo.
export function describeEvent(
  row: DemandHistoryRow,
  ctx?: {
    oldClientName?: string;
    newClientName?: string;
    oldProfileName?: string;
    newProfileName?: string;
  },
): string {
  switch (row.event_type) {
    case "created":
      return "criou a demanda";
    case "comment_added":
      return "comentou";
    case "comment_deleted":
      return "removeu um comentário";
    case "attachment_added":
      return `anexou ${row.new_value ?? "arquivo"}`;
    case "field_changed": {
      const field = row.field ?? "";
      const from = formatFieldValue(field, row.old_value, {
        clientName: ctx?.oldClientName,
        profileName: ctx?.oldProfileName,
      });
      const to = formatFieldValue(field, row.new_value, {
        clientName: ctx?.newClientName,
        profileName: ctx?.newProfileName,
      });
      return `mudou ${fieldLabel(field)} de ${from} para ${to}`;
    }
    default:
      return row.event_type;
  }
}

export function formatHistoryDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
