import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!supabaseConfigured) {
  console.error(
    "[Supabase] Variáveis VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY ausentes. " +
      "Verifique o arquivo .env.local e reinicie o app.",
  );
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

// ---------------------------------------------------------------------------
// Resiliência do Realtime (postgres_changes) — corrige "notificações pararam"
// ---------------------------------------------------------------------------
// As notificações E a atualização ao vivo da lista dependem 100% do realtime
// entregar os postgres_changes de `demands`/`comments`. Esses eventos passam
// pela RLS (`is_active_member()` via `auth.uid()`), que o servidor avalia com
// o JWT presente no SOCKET do realtime — não com o da sessão HTTP.
//
// Sintoma que motivou o fix (2026-07): a lista deixou de atualizar sozinha e
// nenhuma notificação chegava; só voltava após um reload. Diagnóstico: com a
// service role (RLS bypassed) os eventos chegavam; com o cliente autenticado,
// não. Ou seja, o socket ficava com um JWT VENCIDO. O access_token expira
// (~1h) e o socket também reconecta após o Mac dormir / a rede cair; se ele
// reconectar com token velho, `auth.uid()` vira null → a RLS bloqueia TODOS
// os eventos → o realtime "morre" em silêncio até um reload.
//
// Correção: reempurrar o JWT atual pro socket (a) sempre que a sessão muda
// (inclui TOKEN_REFRESHED) e (b) quando o app volta ao foco / a rede volta /
// a janela fica visível — momentos em que o socket pode ter reconectado com
// token velho. `setAuth` reautentica o socket e re-empurra o token pros canais
// já abertos, sem precisar reassinar.
async function reauthRealtime(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    await supabase.realtime.setAuth(data.session?.access_token ?? null);
  } catch (err) {
    console.warn("[realtime] falha ao reautenticar o socket:", err);
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  void supabase.realtime.setAuth(session?.access_token ?? null);
});

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void reauthRealtime());
  window.addEventListener("focus", () => void reauthRealtime());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void reauthRealtime();
  });
}
