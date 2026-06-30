// =============================================================================
// CRUD + realtime de comentários por cliente (Sprint 20)
// =============================================================================
// Espelha `lib/comments.ts` mas opera na tabela `client_comments` e filtra
// por `client_id` em vez de `demand_id`. RLS no Supabase já garante que
// só membros ativos leem/escrevem (vide migration 20260629000003).
// =============================================================================

import { supabase } from "./supabase/client";
import type { ClientComment } from "../types/database";

export async function listClientComments(
  clientId: string,
): Promise<{ data: ClientComment[]; error: string | null }> {
  const { data, error } = await supabase
    .from("client_comments")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[clientComments] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as ClientComment[]) ?? [], error: null };
}

export async function createClientComment(
  clientId: string,
  content: string,
  mentions: string[] = [],
): Promise<{ data: ClientComment | null; error: string | null }> {
  const trimmed = content.trim();
  if (!trimmed) return { data: null, error: "Comentário vazio." };

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { data: null, error: "Você precisa estar logado para comentar." };
  }

  const cleanedMentions = Array.from(new Set(mentions)).filter(
    (id) => id !== user.id,
  );

  const { data, error } = await supabase
    .from("client_comments")
    .insert({
      client_id: clientId,
      author_id: user.id,
      content: trimmed,
      mentions: cleanedMentions,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[clientComments] insert failed:", error);
    return { data: null, error: error.message };
  }
  return { data: data as ClientComment, error: null };
}

export async function deleteClientComment(
  id: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("client_comments").delete().eq("id", id);
  if (error) {
    console.error("[clientComments] delete failed:", error);
    return { error: error.message };
  }
  return { error: null };
}

export function subscribeToClientComments(
  clientId: string,
  onChange: (event: "INSERT" | "UPDATE" | "DELETE", comment: ClientComment) => void,
): () => void {
  const channel = supabase
    .channel(`public:client_comments:${clientId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "client_comments",
        filter: `client_id=eq.${clientId}`,
      },
      (payload) => {
        const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row = (payload.new ?? payload.old) as ClientComment;
        if (row) onChange(eventType, row);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
