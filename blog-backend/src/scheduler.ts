/**
 * scheduler.ts — agendador de artigos programados (Sprint 24).
 *
 * A cada 60s verifica `blog.agendamentos` com `status='pendente'` e
 * `data_programada <= now()`. Faz claim atômico via PATCH condicional
 * (garante que apenas 1 sidecar pega cada agendamento), executa o pipeline
 * completo e atualiza o status.
 *
 * Depende de `SUPABASE_SERVICE_ROLE_KEY` no ambiente — sem essa chave o
 * scheduler não sobe (loga warning e retorna stop no-op).
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { executarPipeline } from "./pipeline";
import { enfileirarComResultado } from "./pipelineQueue";
import { getMagnific } from "./magnific/singleton";
import type { BlogSupabaseClient } from "./supabase";

// NOTA (2026-07-09): o claim NÃO grava mais `executando_por`. A coluna é
// `uuid` COM foreign key pra `auth.users` (herança do app Python, que gravava
// o usuário da sessão). O sidecar não tem sessão, então qualquer id de
// instância viola ou o tipo (`sidecar-host-pid` → 22P02) ou a FK
// (uuid aleatório → 23503). As duas variantes quebravam TODO claim — e a
// primeira quebrava em silêncio, porque `_reivindicar` engolia o erro.
// A atomicidade do claim nunca dependeu dessa coluna: vem do filtro
// `.eq("status","pendente")` no UPDATE condicional.

/** Row de `blog.agendamentos`. */
interface Agendamento {
  id: string;
  site_id: string;
  keyword: string;
  data_programada: string;
  rascunho: boolean | null;
  status: string;
  criado_por: string | null;
}

/** Options aceitas por `iniciarAgendador`. */
export interface IniciarAgendadorOpts {
  intervalMs?: number;
  onLog?: (msg: string) => void;
}

/** Handle pro `stop()` do scheduler + flag de diagnóstico. */
export interface AgendadorHandle {
  stop: () => void;
  /** `true` quando o loop subiu de fato (service_role presente). Exposto no
   *  `/api/health` pra o painel avisar quando agendamentos não vão rodar. */
  ativo: boolean;
}

/**
 * Sobe o loop de checagem. Retorna handle com `stop()` — importante chamar
 * no shutdown do sidecar pra não deixar o interval pendurado.
 */
export function iniciarAgendador(opts: IniciarAgendadorOpts = {}): AgendadorHandle {
  const log = opts.onLog ?? ((m) => console.log(`[scheduler] ${m}`));
  const intervalMs = opts.intervalMs ?? 60_000;

  if (env.SUPABASE_SERVICE_ROLE_KEY.length === 0) {
    log(
      "SUPABASE_SERVICE_ROLE_KEY ausente. Scheduler DESLIGADO. " +
        "Agendamentos programados não serão executados por este sidecar.",
    );
    return { stop: () => {}, ativo: false };
  }

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "blog" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as BlogSupabaseClient;

  let rodando = false;
  let handle: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    if (rodando) return; // evita overlap se um tick demorar > intervalMs
    rodando = true;
    try {
      await _processarPendentes(admin, log);
    } catch (err) {
      log(`Erro no ciclo do scheduler: ${(err as Error).message}`);
    } finally {
      rodando = false;
    }
  };

  // Roda 1× no boot (catch-up de agendamentos vencidos)
  void tick();
  handle = setInterval(() => void tick(), intervalMs);

  log(`Scheduler ligado (interval=${intervalMs}ms).`);
  return {
    stop: () => {
      if (handle !== null) clearInterval(handle);
      log("Scheduler encerrado.");
    },
    ativo: true,
  };
}

/** Busca até 5 agendamentos vencidos e processa cada um. */
async function _processarPendentes(
  admin: BlogSupabaseClient,
  log: (m: string) => void,
): Promise<void> {
  const agora = new Date().toISOString();
  const { data, error } = await admin
    .from("agendamentos")
    .select("id, site_id, keyword, data_programada, rascunho, status, criado_por")
    .eq("status", "pendente")
    .lte("data_programada", agora)
    .order("data_programada", { ascending: true })
    .limit(5);

  if (error !== null) {
    log(`Erro consultando agendamentos: ${error.message}`);
    return;
  }
  const pendentes = (data ?? []) as Agendamento[];
  if (pendentes.length === 0) return;

  for (const a of pendentes) {
    const pego = await _reivindicar(admin, a.id, log);
    if (!pego) continue; // outro sidecar pegou (ou o claim falhou — logado)

    log(`Enfileirando agendamento ${a.id} (keyword="${a.keyword}").`);
    const magnific = getMagnific();
    // Passa pela MESMA fila serial do modo "agora" — o scheduler nunca roda
    // um pipeline em paralelo com uma publicação manual (2026-07-09).
    const resultado = await enfileirarComResultado(() =>
      executarPipeline({
        supabase: admin,
        magnific,
        siteId: a.site_id,
        keyword: a.keyword,
        data: new Date(a.data_programada),
        rascunho: a.rascunho === true,
        ...(a.criado_por ? { geradoPor: a.criado_por } : {}),
      }),
    );

    // Mesmo em falha, grava o post_url quando existir — cobre a falha
    // PARCIAL (post publicado no WP, mas histórico não gravou): o card de
    // erro no painel mostra o link do post em vez de parecer que nada saiu.
    const patch: Record<string, unknown> =
      resultado.status === "falhou"
        ? {
            status: "falhou",
            erro: resultado.erro ?? "Falha desconhecida",
            post_url: resultado.post_url ?? null,
            updated_at: new Date().toISOString(),
          }
        : {
            status: "concluido",
            post_url: resultado.post_url ?? null,
            updated_at: new Date().toISOString(),
          };

    const { error: finErr } = await admin
      .from("agendamentos")
      .update(patch)
      .eq("id", a.id);
    if (finErr !== null) {
      log(`Erro atualizando agendamento ${a.id}: ${finErr.message}`);
    }

    // Notifica o criador do agendamento (persistente, aparece no drawer
    // do painel Blog). Silencioso se falhar — não bloqueia o pipeline.
    if (a.criado_por !== null && a.criado_por !== "") {
      await _notificar(admin, a.criado_por, {
        tipo: resultado.status === "falhou" ? "error" : "success",
        titulo:
          resultado.status === "falhou"
            ? "Agendamento falhou"
            : "Agendamento publicado",
        mensagem:
          resultado.status === "falhou"
            ? `"${a.keyword}" não foi publicado. ${resultado.erro ?? "Erro desconhecido."}`
            : `"${a.keyword}" foi publicado com sucesso.`,
        site_id: a.site_id,
        agendamento_id: a.id,
        contexto: {
          keyword: a.keyword,
          data_programada: a.data_programada,
          ...(resultado.post_url ? { post_url: resultado.post_url } : {}),
        },
      }).catch((err) =>
        log(`Falha ao criar notificação: ${(err as Error).message}`),
      );
    }
  }
}

/**
 * Cria uma notificação persistente. Usa o admin client (service_role),
 * então RLS é bypassado — necessário porque o scheduler não tem sessão
 * de usuário. Silencioso em erro — notificação é feature best-effort.
 */
async function _notificar(
  admin: BlogSupabaseClient,
  userId: string,
  n: {
    tipo: "info" | "success" | "warning" | "error";
    titulo: string;
    mensagem: string;
    site_id?: string | null;
    job_id?: string | null;
    agendamento_id?: string | null;
    contexto?: Record<string, unknown>;
  },
): Promise<void> {
  await admin.from("notificacoes").insert({
    user_id: userId,
    tipo: n.tipo,
    titulo: n.titulo,
    mensagem: n.mensagem,
    site_id: n.site_id ?? null,
    job_id: n.job_id ?? null,
    agendamento_id: n.agendamento_id ?? null,
    contexto: n.contexto ?? null,
  });
}

/**
 * Claim atômico: PATCH com filtro `status=pendente`. Se retornar 1 row,
 * pegamos. Se 0 rows SEM erro, outro sidecar já pegou (não é erro).
 * Erro de verdade (tipo, rede, RLS) é LOGADO — antes era engolido, o que
 * escondeu por dias o bug do `executando_por` não-uuid (2026-07-09).
 */
async function _reivindicar(
  admin: BlogSupabaseClient,
  id: string,
  log: (m: string) => void,
): Promise<boolean> {
  const { data, error } = await admin
    .from("agendamentos")
    .update({
      status: "executando",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pendente")
    .select("id");
  if (error !== null) {
    log(`ERRO no claim do agendamento ${id}: ${error.message}`);
    return false;
  }
  return (data ?? []).length > 0;
}
