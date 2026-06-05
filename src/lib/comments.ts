import { supabase } from "./supabase/client";
import type { Comment } from "../types/database";

export async function listComments(
  demandId: string,
): Promise<{ data: Comment[]; error: string | null }> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("demand_id", demandId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[comments] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as Comment[]) ?? [], error: null };
}

export async function createComment(
  demandId: string,
  content: string,
): Promise<{ data: Comment | null; error: string | null }> {
  const trimmed = content.trim();
  if (!trimmed) return { data: null, error: "Comentário vazio." };

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { data: null, error: "Você precisa estar logado para comentar." };
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({
      demand_id: demandId,
      author_id: user.id,
      content: trimmed,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[comments] insert failed:", error);
    return { data: null, error: error.message };
  }
  return { data: data as Comment, error: null };
}

export async function deleteComment(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) {
    console.error("[comments] delete failed:", error);
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Subscreve mudanças de comentários de uma demanda específica em tempo real.
 * Retorna função para desinscrever.
 */
export function subscribeToComments(
  demandId: string,
  onChange: (event: "INSERT" | "UPDATE" | "DELETE", comment: Comment) => void,
): () => void {
  const channel = supabase
    .channel(`public:comments:${demandId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `demand_id=eq.${demandId}`,
      },
      (payload) => {
        const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row = (payload.new ?? payload.old) as Comment;
        if (row) onChange(eventType, row);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
