import { supabase } from "./supabase/client";
import type {
  ClassificationRule,
  DemandPriority,
  RuleMatchField,
  RuleMatchOperator,
  RuleSetField,
} from "../types/database";

export type RuleInput = {
  name: string;
  match_field: RuleMatchField;
  match_operator: RuleMatchOperator;
  match_value: string;
  set_field: RuleSetField;
  set_value: string;
  active?: boolean;
};

export async function listRules(): Promise<{ data: ClassificationRule[]; error: string | null }> {
  const { data, error } = await supabase
    .from("classification_rules")
    .select("*")
    .order("active", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[rules] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as ClassificationRule[]) ?? [], error: null };
}

export async function listActiveRules(): Promise<ClassificationRule[]> {
  const { data, error } = await supabase
    .from("classification_rules")
    .select("*")
    .eq("active", true);
  if (error) {
    console.error("[rules] list active failed:", error);
    return [];
  }
  return (data as ClassificationRule[]) ?? [];
}

export async function createRule(
  input: RuleInput,
): Promise<{ data: ClassificationRule | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "Não autenticado." };

  const { data, error } = await supabase
    .from("classification_rules")
    .insert({ ...input, active: input.active ?? true, created_by: user.id })
    .select("*")
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: "Sem permissão (precisa ser admin)." };
  return { data: data as ClassificationRule, error: null };
}

export async function updateRule(
  id: string,
  patch: Partial<RuleInput>,
): Promise<{ data: ClassificationRule | null; error: string | null }> {
  const { data, error } = await supabase
    .from("classification_rules")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: "Sem permissão (precisa ser admin)." };
  return { data: data as ClassificationRule, error: null };
}

export async function deleteRule(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("classification_rules").delete().eq("id", id);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------------------
// Aplicação das regras sobre o resultado da IA (antes da confirmação)
// ---------------------------------------------------------------------------

export type AppliedDemand = {
  descricao: string;
  cliente: string | null;
  clientId: string | null;
  responsavel: string | null;
  assigneeId: string | null;
  prioridade: DemandPriority;
  tags: string[];
};

export type AppliedRuleEntry = { ruleName: string; field: RuleSetField; value: string };

function matchString(haystack: string, op: RuleMatchOperator, needle: string): boolean {
  const a = haystack.toLowerCase();
  const b = needle.toLowerCase();
  if (op === "equals") return a === b;
  return a.includes(b);
}

function clientNameById(
  clientId: string | null,
  clients: { id: string; name: string; alias: string | null }[],
): string | null {
  if (!clientId) return null;
  const c = clients.find((x) => x.id === clientId);
  return c ? c.alias || c.name : null;
}

/**
 * Aplica regras ativas sobre o resultado extraído (após o matching nome→id
 * já feito pela captura). Mutates uma cópia e devolve a aplicação + log.
 */
export function applyRules(
  base: AppliedDemand,
  rules: ClassificationRule[],
  clients: { id: string; name: string; alias: string | null }[],
): { result: AppliedDemand; applied: AppliedRuleEntry[] } {
  const result: AppliedDemand = { ...base, tags: [...base.tags] };
  const applied: AppliedRuleEntry[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;

    let matched = false;
    if (rule.match_field === "description") {
      matched = matchString(result.descricao, rule.match_operator, rule.match_value);
    } else if (rule.match_field === "client") {
      const clientName = result.clientId
        ? clientNameById(result.clientId, clients)
        : result.cliente;
      matched = !!clientName && matchString(clientName, rule.match_operator, rule.match_value);
    } else if (rule.match_field === "tag") {
      matched = result.tags.some((t) => matchString(t, rule.match_operator, rule.match_value));
    }

    if (!matched) continue;

    if (rule.set_field === "assignee_id") {
      result.assigneeId = rule.set_value || null;
    } else if (rule.set_field === "priority") {
      if (["baixa", "media", "alta", "urgente"].includes(rule.set_value)) {
        result.prioridade = rule.set_value as DemandPriority;
      }
    } else if (rule.set_field === "tag") {
      const tag = rule.set_value.trim();
      if (tag && !result.tags.includes(tag)) result.tags.push(tag);
    }
    applied.push({ ruleName: rule.name, field: rule.set_field, value: rule.set_value });
  }

  return { result, applied };
}
