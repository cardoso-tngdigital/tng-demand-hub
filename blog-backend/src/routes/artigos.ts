/**
 * routes/artigos.ts — criação de jobs (agora ou programar) + progresso + fila.
 *
 * `POST /api/artigos` recebe uma lista de keywords e dispara:
 *   - modo "agora"     → cria 1 job em memória por keyword e roda em background
 *   - modo "programar" → grava N rows em `blog.agendamentos` espaçadas por N dias
 *
 * `GET /api/artigos/:job_id` — polling do progresso (jobs em memória).
 * CRUD de `blog.agendamentos` também vive aqui.
 */

import { Hono, type Context } from "hono";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { executarPipeline, type ProgressoPipeline, type ResultadoPipeline } from "../pipeline";
import { getMagnific } from "../magnific/singleton";
import { enfileirar } from "../pipelineQueue";

export const artigosRouter = new Hono<AuthEnv>();
export const agendamentosRouter = new Hono<AuthEnv>();

/** Estado de um job em execução (agora), guardado em memória. */
interface JobEstado {
  job_id: string;
  keyword: string;
  site_id: string;
  progresso: ProgressoPipeline;
  resultado?: ResultadoPipeline;
  criado_em: number;
  concluido_em?: number;
}

/** Map global de jobs — key = job_id. */
const JOBS = new Map<string, JobEstado>();

/** GC: remove jobs concluídos há > 5 min. */
setInterval(() => {
  const limite = Date.now() - 5 * 60_000;
  for (const [id, job] of JOBS.entries()) {
    if (job.concluido_em !== undefined && job.concluido_em < limite) {
      JOBS.delete(id);
    }
  }
}, 60_000);

// ---------------------------------------------------------------------------

artigosRouter.post("/", requireAuth, async (c: Context<AuthEnv>) => {
  const body = await c.req.json().catch(() => null) as {
    site_id?: string;
    keywords?: string[];
    modo?: "agora" | "programar";
    espacamento_dias?: number;
    rascunho?: boolean;
  } | null;
  if (body === null) return c.json({ error: "Corpo JSON inválido." }, 400);

  const siteId = body.site_id;
  const keywords = (body.keywords ?? []).map((k) => k.trim()).filter((k) => k.length > 0);
  const modo = body.modo ?? "agora";
  const espacamento = Math.max(0, Math.floor(body.espacamento_dias ?? 0));
  const rascunho = body.rascunho === true;

  if (!siteId || keywords.length === 0) {
    return c.json({ error: "Envie site_id e ao menos 1 keyword." }, 400);
  }

  const supabase = c.get("supabase");
  const user = c.get("user");

  if (modo === "programar" && espacamento > 0) {
    const rows = keywords.map((keyword, i) => ({
      site_id: siteId,
      keyword,
      data_programada: new Date(Date.now() + i * espacamento * 86_400_000).toISOString(),
      rascunho,
      status: "pendente",
      criado_por: user.id,
    }));
    const { data, error } = await supabase
      .from("agendamentos")
      .insert(rows)
      .select("id");
    if (error !== null) {
      return c.json({ error: "Não foi possível programar.", details: error.message }, 500);
    }
    return c.json({ agendamentos: (data ?? []).map((r) => (r as { id: string }).id) });
  }

  // Modo "agora" — cria N jobs em memória
  const magnific = getMagnific();
  const jobIds: string[] = [];
  for (const keyword of keywords) {
    const jobId = crypto.randomUUID();
    const inicial: JobEstado = {
      job_id: jobId,
      keyword,
      site_id: siteId,
      // Nasce "na_fila": a fila serial (pipelineQueue) garante 1 pipeline por
      // vez. onStart abaixo flipa pra "iniciando" quando chega a vez dele.
      progresso: {
        etapa: "na_fila",
        mensagem: "Na fila — aguardando finalizar o artigo em processamento…",
      },
      criado_em: Date.now(),
    };
    JOBS.set(jobId, inicial);
    jobIds.push(jobId);

    // Enfileira: só roda quando os anteriores terminarem (NUNCA em paralelo).
    enfileirar(
      async () => {
      try {
        const resultado = await executarPipeline({
          supabase,
          magnific,
          siteId,
          keyword,
          rascunho,
          geradoPor: user.id,
          onProgresso: (p) => {
            const j = JOBS.get(jobId);
            if (j !== undefined) j.progresso = p;
          },
        });
        const j = JOBS.get(jobId);
        if (j !== undefined) {
          j.resultado = resultado;
          j.concluido_em = Date.now();
          j.progresso = {
            etapa: resultado.status === "falhou" ? "falhou" : "concluido",
            mensagem: resultado.status === "falhou"
              ? (resultado.erro ?? "Falhou")
              : "Artigo publicado com sucesso.",
          };
        }
        // Persiste notificação (best-effort; silencioso em erro).
        try {
          await supabase
            .from("notificacoes")
            .insert({
              user_id: user.id,
              site_id: siteId,
              job_id: jobId,
              tipo: resultado.status === "falhou" ? "error" : "success",
              titulo:
                resultado.status === "falhou"
                  ? "Falha ao gerar artigo"
                  : "Artigo publicado",
              mensagem:
                resultado.status === "falhou"
                  ? `"${keyword}" falhou. ${resultado.erro ?? "Erro desconhecido."}`
                  : `"${keyword}" foi publicado com sucesso.`,
              contexto: {
                keyword,
                ...(resultado.post_url ? { post_url: resultado.post_url } : {}),
              },
            });
        } catch {
          // silencioso — notificação é best-effort
        }
      } catch (err) {
        const j = JOBS.get(jobId);
        if (j !== undefined) {
          j.progresso = { etapa: "falhou", mensagem: (err as Error).message };
          j.concluido_em = Date.now();
        }
        try {
          await supabase
            .from("notificacoes")
            .insert({
              user_id: user.id,
              site_id: siteId,
              job_id: jobId,
              tipo: "error",
              titulo: "Falha ao gerar artigo",
              mensagem: `"${keyword}" falhou. ${(err as Error).message}`,
              contexto: { keyword },
            });
        } catch {
          // silencioso — notificação é best-effort
        }
      }
      },
      () => {
        // onStart: chegou a vez deste job na fila serial.
        const j = JOBS.get(jobId);
        if (j !== undefined && j.concluido_em === undefined) {
          j.progresso = { etapa: "iniciando", mensagem: "Iniciando…" };
        }
      },
    );
  }

  return c.json({ jobs: jobIds });
});

artigosRouter.get("/:job_id", requireAuth, (c: Context<AuthEnv>) => {
  const jobId = c.req.param("job_id") ?? "";
  const job = JOBS.get(jobId);
  if (job === undefined) return c.json({ error: "Job não encontrado." }, 404);
  const payload: Record<string, unknown> = {
    job_id: job.job_id,
    keyword: job.keyword,
    site_id: job.site_id,
    progresso: job.progresso,
    criado_em: job.criado_em,
  };
  if (job.resultado !== undefined) payload.resultado = job.resultado;
  if (job.concluido_em !== undefined) payload.concluido_em = job.concluido_em;
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// CRUD /api/agendamentos
// ---------------------------------------------------------------------------

agendamentosRouter.get("/", requireAuth, async (c: Context<AuthEnv>) => {
  const siteId = c.req.query("site_id");
  const status = c.req.query("status");
  const supabase = c.get("supabase");
  let q = supabase
    .from("agendamentos")
    .select("*")
    .order("data_programada", { ascending: true });
  if (siteId) q = q.eq("site_id", siteId);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error !== null) {
    return c.json({ error: "Erro listando agendamentos.", details: error.message }, 500);
  }
  return c.json({ agendamentos: data ?? [] });
});

agendamentosRouter.delete("/:id", requireAuth, async (c: Context<AuthEnv>) => {
  const id = c.req.param("id");
  const supabase = c.get("supabase");
  // Aceita excluir qualquer status EXCETO "executando" (pipeline em andamento
  // não deve perder a row de rastreio). Antes só `pendente` era permitido;
  // liberado pra `concluido`/`falhou` em 2026-07-09 — o operador precisa
  // limpar o painel (ex.: artigo programado no site errado).
  const { data, error } = await supabase
    .from("agendamentos")
    .delete()
    .eq("id", id)
    .neq("status", "executando")
    .select("id");
  if (error !== null) {
    return c.json({ error: "Erro removendo.", details: error.message }, 500);
  }
  const rows = (data ?? []) as unknown[];
  if (rows.length === 0) {
    return c.json({ error: "Agendamento não encontrado ou em execução." }, 404);
  }
  return c.json({ ok: true });
});
