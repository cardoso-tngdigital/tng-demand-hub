import { supabase } from "./supabase/client";
import type { Client, ClientLink, ClientStatus } from "../types/database";

export type ClientInput = {
  name: string;
  alias?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  status?: ClientStatus;
  // Listas já saneadas (sem itens vazios). O ClientsAdmin pode passar
  // arrays com `url` em branco — `cleanLinkArray` filtra antes de gravar.
  google_business_urls?: ClientLink[];
  drive_urls?: ClientLink[];
  whatsapp_group_urls?: ClientLink[];
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
    google_business_urls: cleanLinkArray(input.google_business_urls),
    drive_urls: cleanLinkArray(input.drive_urls),
    whatsapp_group_urls: cleanLinkArray(input.whatsapp_group_urls),
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
  if (patch.google_business_urls !== undefined) {
    payload.google_business_urls = cleanLinkArray(patch.google_business_urls);
  }
  if (patch.drive_urls !== undefined) {
    payload.drive_urls = cleanLinkArray(patch.drive_urls);
  }
  if (patch.whatsapp_group_urls !== undefined) {
    payload.whatsapp_group_urls = cleanLinkArray(patch.whatsapp_group_urls);
  }

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

// Normaliza arrays de ClientLink: trim em label/url, descarta itens sem url,
// dedup por url. Postgres aceita jsonb '[]' vazio então passar [] mantém o
// tipo consistente.
function cleanLinkArray(input: ClientLink[] | undefined): ClientLink[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: ClientLink[] = [];
  for (const raw of input) {
    const url = raw.url?.trim() ?? "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: raw.label?.trim() ?? "", url });
  }
  return out;
}

export async function deleteClient(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    console.error("[clients] delete failed:", error);
    return { error: error.message };
  }
  return { error: null };
}
