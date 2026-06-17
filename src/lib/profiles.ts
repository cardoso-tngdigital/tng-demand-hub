import { supabase } from "./supabase/client";
import type { NotificationPrefs, Profile, UserRole } from "../types/database";

export async function listAllProfiles(): Promise<{ data: Profile[]; error: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("active", { ascending: false })
    .order("full_name", { ascending: true });
  if (error) {
    console.error("[profiles] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as Profile[]) ?? [], error: null };
}

export type ProfilePatch = Partial<{
  full_name: string;
  area: string | null;
  role: UserRole;
  active: boolean;
}>;

export async function updateProfile(
  id: string,
  patch: ProfilePatch,
): Promise<{ data: Profile | null; error: string | null }> {
  if (Object.keys(patch).length === 0) {
    return { data: null, error: "Nada para atualizar." };
  }
  // maybeSingle (em vez de single) para tratar o caso em que a RLS rejeita
  // o update silenciosamente — devolve 0 linhas em vez de jogar erro.
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[profiles] update failed:", error);
    return { data: null, error: error.message };
  }
  if (!data) {
    return { data: null, error: "Sem permissão para alterar este membro (precisa ser admin)." };
  }
  return { data: data as Profile, error: null };
}

// Atualiza as preferências de notificação do user atual. RLS profiles_update_own
// permite cada user mexer no próprio registro.
export async function updateMyNotifications(
  prefs: NotificationPrefs,
): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };
  const { error } = await supabase
    .from("profiles")
    .update({ notifications: prefs })
    .eq("id", user.id);
  if (error) {
    console.error("[profiles] updateMyNotifications failed:", error);
    return { error: error.message };
  }
  return { error: null };
}

export async function getMyProfile(): Promise<{
  data: Profile | null;
  error: string | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "Sessão expirada." };
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[profiles] getMyProfile failed:", error);
    return { data: null, error: error.message };
  }
  return { data: data as Profile | null, error: null };
}
