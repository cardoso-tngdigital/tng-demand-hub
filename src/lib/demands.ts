import { supabase } from "./supabase/client";
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

/**
 * Subscreve mudanças na tabela demands em tempo real.
 * Retorna função para desinscrever.
 */
export function subscribeToDemands(
  onChange: (event: "INSERT" | "UPDATE" | "DELETE", demand: Demand) => void,
): () => void {
  const channel = supabase
    .channel("public:demands")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "demands" },
      (payload) => {
        const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row = (payload.new ?? payload.old) as Demand;
        if (row) onChange(eventType, row);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
