import { supabase } from "./supabase/client";

export type ClientOption = { id: string; name: string; alias: string | null };
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
    .select("id, name, alias")
    .eq("status", "active")
    .order("name");
  if (error) {
    console.error("[lookups] clients failed:", error);
    return [];
  }
  return (data ?? []) as ClientOption[];
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
