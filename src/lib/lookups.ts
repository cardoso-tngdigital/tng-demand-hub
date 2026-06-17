import { supabase } from "./supabase/client";
import type { ClientLink } from "../types/database";

export type ClientOption = {
  id: string;
  name: string;
  alias: string | null;
  // Links operacionais exibidos no drawer da demanda. Carregamos aqui em vez
  // de fazer fetch separado pra evitar latência no clique do card.
  google_business_urls: ClientLink[];
  drive_urls: ClientLink[];
  whatsapp_group_urls: ClientLink[];
};
export type ProfileOption = { id: string; full_name: string };

/**
 * Subscreve mudanças em clients (qualquer evento) e refaz fetch da lista
 * ativa. Útil em janelas longevas como a captura flutuante, que carregam
 * lookups uma vez e precisam reagir a CRUD feito em outro lugar.
 */
export function subscribeToActiveClients(
  onChange: (clients: ClientOption[]) => void,
): () => void {
  const channel = supabase
    .channel("public:clients:active")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "clients" },
      async () => {
        const next = await listActiveClients();
        onChange(next);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToActiveProfiles(
  onChange: (profiles: ProfileOption[]) => void,
): () => void {
  const channel = supabase
    .channel("public:profiles:active")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles" },
      async () => {
        const next = await listActiveProfiles();
        onChange(next);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function listActiveClients(): Promise<ClientOption[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, alias, google_business_urls, drive_urls, whatsapp_group_urls")
    .eq("status", "active")
    .order("name");
  if (error) {
    console.error("[lookups] clients failed:", error);
    return [];
  }
  // Normaliza: a migration 20260618000001 garante array, mas defensivo contra
  // registros antigos ou rows de RLS bloqueado que tenham null.
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    alias: (row.alias as string | null) ?? null,
    google_business_urls: (row.google_business_urls as ClientLink[] | null) ?? [],
    drive_urls: (row.drive_urls as ClientLink[] | null) ?? [],
    whatsapp_group_urls: (row.whatsapp_group_urls as ClientLink[] | null) ?? [],
  }));
}

export async function listActiveProfiles(): Promise<ProfileOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name");
  if (error) {
    console.error("[lookups] profiles failed:", error);
    return [];
  }
  return (data ?? []) as ProfileOption[];
}
