import { supabase } from "./supabase/client";

export type ClientOption = { id: string; name: string; alias: string | null };
export type ProfileOption = { id: string; full_name: string };

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
