import { supabase } from "./supabase/client";
import { markLocalChange } from "./notifications";
import type { Demand, NewDemandInput } from "../types/database";

/**
 * Extrai um título curto da descrição:
 * - Se houver quebra de linha, usa a primeira linha.
 * - Caso contrário, trunca em 80 caracteres.
 */
function deriveTitle(description: string): string {
  const firstLine = description.split("\n")[0].trim();
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 77) + "…";
}

/**
 * Cria uma nova demanda. Exige que o usuário esteja autenticado.
 */
export async function createDemand(
  input: NewDemandInput,
): Promise<{ data: Demand | null; error: string | null }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { data: null, error: "Você precisa estar logado para criar uma demanda." };
  }

  const description = input.description.trim();
  if (!description) {
    return { data: null, error: "A descrição não pode estar vazia." };
  }

  const payload = {
    title: input.title?.trim() || deriveTitle(description),
    description,
    client_id: input.client_id ?? null,
    assignee_id: input.assignee_id ?? null,
    created_by: user.id,
    priority: input.priority ?? "media",
    status: input.status ?? "todo",
    due_date: input.due_date ?? null,
    tags: input.tags ?? [],
    infrastructure: input.infrastructure ?? null,
    captured_via: input.captured_via ?? "manual",
  };

  const { data, error } = await supabase
    .from("demands")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("[demands] insert failed:", error);
    return { data: null, error: error.message };
  }

  return { data: data as Demand, error: null };
}

/** Conjunto de campos editáveis de uma demanda (todos opcionais). */
export type DemandPatch = Partial<{
  title: string;
  description: string;
  client_id: string | null;
  assignee_id: string | null;
  priority: Demand["priority"];
  status: Demand["status"];
  due_date: string | null;
  tags: string[];
  infrastructure: Demand["infrastructure"];
}>;

/**
 * Atualiza campos de uma demanda. Devolve a linha atualizada para que o caller
 * possa reconciliar estado local sem esperar pelo realtime.
 */
export async function updateDemand(
  id: string,
  patch: DemandPatch,
): Promise<{ data: Demand | null; error: string | null }> {
  if (Object.keys(patch).length === 0) {
    return { data: null, error: "Nada para atualizar." };
  }

  // Marca antes de chamar — quando o realtime entregar o eco do UPDATE,
  // a notificação correspondente será suprimida (não notificamos quem fez).
  markLocalChange(id);

  const { data, error } = await supabase
    .from("demands")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[demands] update failed:", error);
    return { data: null, error: error.message };
  }

  return { data: data as Demand, error: null };
}

/**
 * Lista demandas em ordem decrescente de criação.
 */
export async function listDemands(
  limit = 100,
): Promise<{ data: Demand[]; error: string | null }> {
  const { data, error } = await supabase
    .from("demands")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[demands] list failed:", error);
    return { data: [], error: error.message };
  }

  return { data: (data as Demand[]) ?? [], error: null };
}

export type DemandChange = {
  new: Demand | null;
  old: Demand | null;
};

/**
 * Subscreve mudanças na tabela demands em tempo real.
 * Devolve `{ new, old }` em todos os eventos para que o caller possa
 * comparar valores anteriores (necessário para detectar reatribuições).
 * Retorna função para desinscrever.
 */
export function subscribeToDemands(
  onChange: (event: "INSERT" | "UPDATE" | "DELETE", change: DemandChange) => void,
): () => void {
  const channel = supabase
    .channel("public:demands")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "demands" },
      (payload) => {
        const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const newRow = (payload.new as Demand | undefined) ?? null;
        const oldRow = (payload.old as Demand | undefined) ?? null;
        if (newRow || oldRow) onChange(eventType, { new: newRow, old: oldRow });
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
