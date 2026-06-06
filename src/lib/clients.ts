import { supabase } from "./supabase/client";
import type { Client, ClientStatus } from "../types/database";

export type ClientInput = {
  name: string;
  alias?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  status?: ClientStatus;
};

export type ClientPatch = Partial<ClientInput>;

export async function listAllClients(): Promise<{ data: Client[]; error: string | null }> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("status", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("[clients] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as Client[]) ?? [], error: null };
}

export async function createClient(
  input: ClientInput,
): Promise<{ data: Client | null; error: string | null }> {
  const name = input.name.trim();
  if (!name) return { data: null, error: "Nome do cliente é obrigatório." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const payload = {
    name,
    alias: input.alias?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    notes: input.notes?.trim() || null,
    status: input.status ?? "active",
    created_by: user?.id ?? null,
  };

  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("*")
    .single();
  if (error) {
    console.error("[clients] insert failed:", error);
    return { data: null, error: error.message };
  }
  return { data: data as Client, error: null };
}

export async function updateClient(
  id: string,
  patch: ClientPatch,
): Promise<{ data: Client | null; error: string | null }> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return { data: null, error: "Nome não pode ser vazio." };
    payload.name = trimmed;
  }
  if (patch.alias !== undefined) payload.alias = patch.alias?.trim() || null;
  if (patch.email !== undefined) payload.email = patch.email?.trim() || null;
  if (patch.phone !== undefined) payload.phone = patch.phone?.trim() || null;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() || null;
  if (patch.status !== undefined) payload.status = patch.status;

  if (Object.keys(payload).length === 0) {
    return { data: null, error: "Nada para atualizar." };
  }

  const { data, error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[clients] update failed:", error);
    return { data: null, error: error.message };
  }
  return { data: data as Client, error: null };
}

export async function deleteClient(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    console.error("[clients] delete failed:", error);
    return { error: error.message };
  }
  return { error: null };
}
