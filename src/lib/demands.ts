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
 * Apaga uma demanda: remove arquivos do Storage e deleta a row. ON DELETE
 * CASCADE no Postgres limpa comments, attachments, demand_history e
 * demand_due_notifications. RLS demands_delete_own_or_admin garante que
 * só o autor ou admin consigam executar.
 *
 * Cleanup de Storage é feito ANTES do delete porque, depois do CASCADE,
 * perdemos a lista de paths e os objetos ficam órfãos no bucket.
 */
export async function deleteDemand(
  id: string,
): Promise<{ error: string | null }> {
  // 1. Lista anexos pra pegar os file_paths antes de a row sumir.
  const { data: attachments } = await supabase
    .from("attachments")
    .select("file_path")
    .eq("demand_id", id);

  // 2. Remove do Storage (best-effort — RLS attachments_delete_own_or_admin
  //    deve permitir; se falhar, o delete da demanda vai derrubar as rows
  //    mesmo assim, mas os arquivos podem ficar órfãos no bucket).
  const paths = (attachments ?? [])
    .map((a) => (a as { file_path: string }).file_path)
    .filter(Boolean);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("attachments")
      .remove(paths);
    if (storageError) {
      console.error("[demands] storage cleanup failed:", storageError);
    }
  }

  // 3. Suprime a notificação eco do realtime (não nos avisar de algo que
  //    fizemos nós mesmos).
  markLocalChange(id);

  // 4. Delete da row. CASCADE cuida do resto.
  const { error } = await supabase.from("demands").delete().eq("id", id);
  if (error) {
    console.error("[demands] delete failed:", error);
    return { error: error.message };
  }
  return { error: null };
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
 * Lista as demandas de um cliente específico, mais recentes em cima.
 * Usado no `ClientDetailDrawer` (Sprint 20) — sem limite porque a
 * cardinalidade por cliente é baixa.
 */
export async function listDemandsByClient(
  clientId: string,
): Promise<{ data: Demand[]; error: string | null }> {
  const { data, error } = await supabase
    .from("demands")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[demands] listByClient failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as Demand[]) ?? [], error: null };
}

export type ClientDemandCount = { open: number; total: number };

/**
 * Agrega contagens por client_id em uma única query: total e "abertas"
 * (status `todo` ou `doing`). Usado pelos cards do painel "Por cliente"
 * pra mostrar "N abertas · M totais" sem buscar todas as demandas.
 */
export async function listClientDemandCounts(): Promise<{
  data: Record<string, ClientDemandCount>;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("demands")
    .select("client_id, status")
    .not("client_id", "is", null);

  if (error) {
    console.error("[demands] listClientDemandCounts failed:", error);
    return { data: {}, error: error.message };
  }

  const out: Record<string, ClientDemandCount> = {};
  for (const row of (data ?? []) as Array<{
    client_id: string;
    status: Demand["status"];
  }>) {
    const entry = (out[row.client_id] ||= { open: 0, total: 0 });
    entry.total += 1;
    if (row.status === "todo" || row.status === "doing") entry.open += 1;
  }
  return { data: out, error: null };
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
