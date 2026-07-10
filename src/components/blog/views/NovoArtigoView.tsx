// =============================================================================
// NovoArtigoView — criação de artigos no Blog (Sprint 27)
// =============================================================================
// Permite disparar geração agora (com polling de progresso por job) ou
// programar N artigos espaçados por X dias. Só mostra sites com o plugin
// instalado (o publish sem plugin exige App Password legada — mantido só
// no scheduler backend).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { blogFetch } from "../../../lib/blogClient";
import { showToast } from "../../../lib/toast";
import { navigateBlog } from "../../../lib/blogNav";
import type { BlogJob, BlogSite } from "../../../types/blog";

type Modo = "agora" | "programar";
type Publicacao = "publicar" | "rascunho";

// Estado local por job — combina o payload do backend com flags de UI
// (estamos ainda polling? último erro visto?).
type LocalJob = {
  jobId: string;
  keyword: string;
  siteId: string;
  status: "na_fila" | "iniciando" | "em_andamento" | "concluido" | "falhou";
  etapa: string;
  mensagem: string;
  postUrl?: string;
  erro?: string;
};

const ETAPA_LABEL: Record<string, string> = {
  na_fila: "Na fila",
  iniciando: "Iniciando",
  links: "Buscando links internos",
  texto: "Gerando texto com IA",
  imagens: "Buscando/gerando imagens",
  publicando: "Publicando no WordPress",
  historico: "Registrando histórico",
  concluido: "Concluído",
  falhou: "Falhou",
};

export function NovoArtigoView() {
  const [sites, setSites] = useState<BlogSite[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [erroSites, setErroSites] = useState<string | null>(null);

  const [siteId, setSiteId] = useState<string>("");
  const [buscaSite, setBuscaSite] = useState<string>("");
  const [keywords, setKeywords] = useState<string>("");
  const [modo, setModo] = useState<Modo>("agora");
  const [espacamento, setEspacamento] = useState<number>(1);
  // Padrão "rascunho" — quase todo blog revisa antes de publicar
  // (feedback do usuário, 2026-07-04).
  const [publicacao, setPublicacao] = useState<Publicacao>("rascunho");

  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [jobs, setJobs] = useState<LocalJob[]>([]);

  // Guarda os IDs dos jobs que ainda estamos polling — o cleanup depende
  // dessa lista pra não vazar intervals ao trocar de aba.
  const pollingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        // Paridade com o app Python: mostra TODOS os sites conectados,
        // não só os que já tiveram o plugin detectado no "Testar". Um
        // site recém-adicionado pelo botão "Conectar ao TNG Blog" do
        // plugin fica com `plugin=false` até o operador clicar "Testar",
        // e o filtro antigo (`s.plugin`) escondia esse site aqui.
        const data = (await blogFetch<{ sites: BlogSite[] }>("/api/sites")).sites;
        setSites(data);
        if (data.length > 0 && !siteId) {
          setSiteId(data[0].id);
        }
      } catch (err) {
        setErroSites(
          err instanceof Error ? err.message : "Falha ao carregar sites.",
        );
      } finally {
        setLoadingSites(false);
      }
    })();
    // Só ao montar — recarrega manual se precisar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling de um job específico. Consulta a cada 2s até `concluido_em`
  // preencher ou o status ficar `falhou`. Atualiza o estado local no ritmo.
  const startPolling = useCallback((jobId: string) => {
    if (pollingRef.current.has(jobId)) return;
    pollingRef.current.add(jobId);

    // Guarda contra sobreposição: se um poll demorar mais que o intervalo,
    // não dispara outro por cima (evitava empilhar requests no congelamento
    // de 2026-07-09). Timeout curto (8s) porque é um GET de progresso leve.
    let emAndamento = false;
    const interval = setInterval(async () => {
      if (emAndamento) return;
      emAndamento = true;
      try {
        const data = await blogFetch<BlogJob>(
          `/api/artigos/${jobId}`,
          undefined,
          8_000,
        );
        setJobs((prev) =>
          prev.map((j) => {
            if (j.jobId !== jobId) return j;
            const concluido = data.concluido_em !== undefined;
            const finalStatus = data.resultado?.status;
            return {
              ...j,
              etapa: data.progresso.etapa,
              mensagem: data.progresso.mensagem,
              status: concluido
                ? finalStatus === "falhou"
                  ? "falhou"
                  : "concluido"
                : data.progresso.etapa === "na_fila"
                  ? "na_fila"
                  : "em_andamento",
              postUrl: data.resultado?.post_url ?? j.postUrl,
              erro: data.resultado?.erro ?? j.erro,
            };
          }),
        );
        if (data.concluido_em !== undefined) {
          clearInterval(interval);
          pollingRef.current.delete(jobId);
          // Toast imediato — feedback flutuante no topo. Roda uma vez só
          // (o interval é limpo aqui). Scheduler tem seu próprio toast via
          // BlogPanel; estes são só os jobs disparados "agora".
          const falhou = data.resultado?.status === "falhou";
          const rascunho = data.resultado?.status === "rascunho";
          const postUrl = data.resultado?.post_url;
          showToast({
            tipo: falhou ? "error" : "success",
            titulo: falhou
              ? "Falha ao gerar artigo"
              : rascunho
                ? "Rascunho salvo"
                : "Artigo publicado",
            mensagem: falhou
              ? `"${data.keyword}" — ${data.resultado?.erro ?? "erro desconhecido"}`
              : `"${data.keyword}" ${rascunho ? "foi salvo como rascunho" : "foi publicado com sucesso"}.`,
            ...(postUrl ? { postUrl } : {}),
          });
        }
      } catch (err) {
        // Erro transitório de rede — mantém o interval rodando. Se cair
        // durante 5 min o job vai continuar tentando; usuário pode cancelar
        // fechando o painel.
        console.warn("[blog] Erro no polling do job", jobId, err);
      } finally {
        emAndamento = false;
      }
    }, 2000);
  }, []);

  // Limpa qualquer polling ativo ao desmontar (troca de aba, fechar painel).
  useEffect(() => {
    // Snapshot do set atual pro cleanup — evita ler o ref no unmount após
    // ele ter sido esvaziado por outro caminho.
    const active = pollingRef.current;
    return () => {
      active.clear();
    };
  }, []);

  const parseKeywords = (raw: string): string[] =>
    raw
      .split("\n")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroEnvio(null);
    setFeedback(null);

    const lista = parseKeywords(keywords);
    if (!siteId) {
      setErroEnvio("Selecione um site.");
      return;
    }
    if (lista.length === 0) {
      setErroEnvio("Adicione ao menos uma palavra-chave.");
      return;
    }
    if (modo === "programar" && (!espacamento || espacamento < 1)) {
      setErroEnvio("Espaçamento deve ser ao menos 1 dia.");
      return;
    }

    setEnviando(true);
    try {
      const body: Record<string, unknown> = {
        site_id: siteId,
        keywords: lista,
        modo,
        rascunho: publicacao === "rascunho",
      };
      if (modo === "programar") body.espacamento_dias = espacamento;

      const res = await blogFetch<{ jobs?: string[]; agendamentos?: string[] }>(
        "/api/artigos",
        { method: "POST", body: JSON.stringify(body) },
      );

      if (modo === "agora" && res.jobs && res.jobs.length > 0) {
        // Cria estado local pra cada job e dispara polling.
        const novos: LocalJob[] = res.jobs.map((id, i) => ({
          jobId: id,
          keyword: lista[i] ?? "",
          siteId,
          // Nasce "na fila": a fila serial roda 1 por vez. O primeiro poll
          // (≤2s) já reflete se é a vez dele ou se está aguardando.
          status: "na_fila",
          etapa: "na_fila",
          mensagem: "Na fila…",
        }));
        setJobs((prev) => [...novos, ...prev]);
        novos.forEach((j) => startPolling(j.jobId));
        setFeedback(
          `${novos.length} ${novos.length === 1 ? "artigo iniciado" : "artigos iniciados"}.`,
        );
      } else if (modo === "programar" && res.agendamentos) {
        // Toast com atalho direto pra programação do site (feedback
        // 2026-07-09) — substitui o aviso estático que ficava embaixo.
        const qtd = res.agendamentos.length;
        const siteDoToast = siteId;
        showToast({
          tipo: "success",
          titulo:
            qtd === 1 ? "Agendamento criado" : `${qtd} agendamentos criados`,
          mensagem:
            siteSelecionado !== undefined
              ? `Programado em ${siteSelecionado.nome ?? siteSelecionado.url}.`
              : "Programação registrada.",
          acao: {
            label: "Ver programação",
            onClick: () =>
              navigateBlog({
                tab: "sites",
                siteId: siteDoToast,
                drawerTab: "programacao",
              }),
          },
        });
      } else {
        setFeedback("Fila atualizada.");
      }
      setKeywords("");
    } catch (err) {
      setErroEnvio(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  // Sites filtrados pela busca e ordenados alfabeticamente.
  const sitesOrdenados = [...sites].sort((a, b) =>
    (a.nome ?? a.url).localeCompare(b.nome ?? b.url, "pt-BR", {
      sensitivity: "base",
    }),
  );
  const q = buscaSite.trim().toLowerCase();
  const sitesVisiveis =
    q.length === 0
      ? sitesOrdenados
      : sitesOrdenados.filter((s) => {
          const alvo = `${s.nome ?? ""} ${s.url}`.toLowerCase();
          return alvo.includes(q);
        });

  const siteSelecionado = sites.find((s) => s.id === siteId);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
          Novo artigo
        </h3>
        <p className="mt-1 text-xs text-tng-marine-400">
          Escolha o site à esquerda e dispare os artigos à direita.
        </p>
      </div>

      {erroSites && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {erroSites}
        </div>
      )}

      {/* Progresso dos jobs "agora" flutua no canto superior direito, como
          os toasts (feedback 2026-07-09). z-[55] fica acima do painel (z-40)
          e abaixo dos toasts (z-[60], top-4); top-16 evita sobreposição.
          Mais recentes em cima; some sozinho quando não há jobs. */}
      {jobs.length > 0 && (
        <div className="fixed right-4 top-16 z-[55] w-[380px] max-w-[calc(100vw-2rem)] space-y-2">
          <h4 className="text-right text-[10px] uppercase tracking-wider text-tng-marine-400">
            Em processamento
          </h4>
          <ul className="space-y-2">
            {jobs.map((j) => (
              <JobCard key={j.jobId} job={j} />
            ))}
          </ul>
        </div>
      )}

      {/* Layout fixo em 2 colunas ~40% / ~60% (site | form). É app desktop —
          sem media query, a janela do Tauri é sempre larga o bastante.
          ATENÇÃO à sintaxe: no valor arbitrário do Tailwind as trilhas do
          grid são separadas por `_` (vira espaço no CSS), NUNCA por vírgula.
          `2fr_3fr` = 40%/60%. `minmax(0,…)` evita que conteúdo largo
          (URLs longas) estoure a coluna e quebre a proporção. */}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        {/* ----- Coluna esquerda: lista de sites com busca ----- */}
        <aside className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-3">
          <label className="mb-2 block text-xs uppercase tracking-wider text-tng-marine-300">
            Site
          </label>
          <div className="relative mb-3">
            <i
              className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-tng-marine-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={buscaSite}
              onChange={(e) => setBuscaSite(e.target.value)}
              placeholder="Buscar site…"
              className="w-full rounded-md border border-tng-marine-600 bg-tng-marine-900 py-2 pl-8 pr-3 text-sm text-tng-marine-50 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none"
            />
          </div>
          {loadingSites ? (
            <p className="text-xs text-tng-marine-400">Carregando sites…</p>
          ) : sites.length === 0 ? (
            <p className="text-xs text-tng-marine-400">
              Nenhum site conectado. Vá para "Sites" e conecte um WordPress.
            </p>
          ) : sitesVisiveis.length === 0 ? (
            <p className="text-xs text-tng-marine-400">
              Nenhum site bate com "{buscaSite}".
            </p>
          ) : (
            <ul className="max-h-[65vh] space-y-1.5 overflow-y-auto pr-1">
              {sitesVisiveis.map((s) => {
                const ativo = s.id === siteId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSiteId(s.id)}
                      className={`w-full rounded-md border px-3 py-2.5 text-left transition ${
                        ativo
                          ? "border-tng-orange-400 bg-tng-orange-400/10"
                          : "border-tng-marine-700 bg-tng-marine-900/40 hover:border-tng-marine-500"
                      }`}
                    >
                      <p
                        className={`truncate text-sm font-medium ${
                          ativo ? "text-tng-orange-200" : "text-tng-marine-50"
                        }`}
                      >
                        {s.nome ?? s.url}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-tng-marine-400">
                        {s.url}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ----- Coluna direita: form ----- */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-5"
        >
          {/* Cabeçalho do site selecionado */}
          <div className="rounded-md border border-tng-marine-700 bg-tng-marine-900/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-tng-marine-400">
              Publicando em
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-tng-marine-50">
              {siteSelecionado
                ? (siteSelecionado.nome ?? siteSelecionado.url)
                : "— nenhum site selecionado —"}
            </p>
          </div>

          {/* Keywords */}
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-tng-marine-300">
              Palavras-chave
            </label>
            <textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Uma palavra-chave por linha"
              rows={5}
              className="w-full resize-y rounded-md border border-tng-marine-600 bg-tng-marine-900 px-3 py-2 text-sm text-tng-marine-50 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none"
            />
          </div>

          {/* Modo */}
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-tng-marine-300">
              Quando publicar
            </label>
            <div className="flex flex-wrap gap-2">
              <RadioButton
                checked={modo === "agora"}
                onChange={() => setModo("agora")}
                label="Publicar agora"
              />
              <RadioButton
                checked={modo === "programar"}
                onChange={() => setModo("programar")}
                label="Programar"
              />
            </div>
            {modo === "programar" && (
              <div className="mt-3 flex items-center gap-2 text-sm text-tng-marine-200">
                <span>Espaçamento:</span>
                <input
                  type="number"
                  min={1}
                  value={espacamento}
                  onChange={(e) => setEspacamento(Number(e.target.value) || 1)}
                  className="w-20 rounded-md border border-tng-marine-600 bg-tng-marine-900 px-2 py-1 text-sm text-tng-marine-50 focus:border-tng-orange-400 focus:outline-none"
                />
                <span>{espacamento === 1 ? "dia" : "dias"} entre artigos</span>
              </div>
            )}
          </div>

          {/* Publicação */}
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-tng-marine-300">
              Status no WordPress
            </label>
            <div className="flex flex-wrap gap-2">
              <RadioButton
                checked={publicacao === "rascunho"}
                onChange={() => setPublicacao("rascunho")}
                label="Rascunho"
              />
              <RadioButton
                checked={publicacao === "publicar"}
                onChange={() => setPublicacao("publicar")}
                label="Publicar"
              />
            </div>
          </div>

          {erroEnvio && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {erroEnvio}
            </div>
          )}
          {feedback && !erroEnvio && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              {feedback}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={enviando || sites.length === 0 || !siteId}
              className="rounded-md bg-tng-orange-400 px-4 py-2 text-sm font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin mr-2" aria-hidden="true" />
                  Enviando…
                </>
              ) : (
                "Adicionar à fila"
              )}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}

function RadioButton({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`rounded-md border px-3 py-1.5 text-sm transition ${
        checked
          ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
          : "border-tng-marine-600 text-tng-marine-200 hover:border-tng-marine-400 hover:text-tng-marine-50"
      }`}
    >
      {label}
    </button>
  );
}

function JobCard({ job }: { job: LocalJob }) {
  const isDone = job.status === "concluido";
  const isFail = job.status === "falhou";
  const isQueued = job.status === "na_fila";
  // "rodando" = trabalhando de fato (não na fila, não terminado).
  const running = !isDone && !isFail && !isQueued;

  const etapaTexto = ETAPA_LABEL[job.etapa] ?? job.etapa;

  return (
    // bg sólido + shadow porque o card agora flutua sobre o conteúdo do
    // painel (canto superior direito) — translúcido ficava ilegível.
    // Na fila: borda âmbar tracejada pra diferenciar de "processando".
    <li
      className={`rounded-lg border bg-tng-marine-800 p-4 shadow-xl ${
        isQueued
          ? "border-dashed border-amber-500/50"
          : "border-tng-marine-600"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-tng-marine-50">
            {job.keyword || "(sem palavra-chave)"}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-tng-marine-300">
            {isQueued && (
              <i
                className="fa-regular fa-hourglass-half text-amber-300"
                aria-hidden="true"
              />
            )}
            {running && (
              <i
                className="fa-solid fa-spinner fa-spin text-tng-orange-300"
                aria-hidden="true"
              />
            )}
            {isDone && (
              <i
                className="fa-solid fa-circle-check text-emerald-400"
                aria-hidden="true"
              />
            )}
            {isFail && (
              <i
                className="fa-solid fa-circle-xmark text-red-400"
                aria-hidden="true"
              />
            )}
            <span className={isQueued ? "text-amber-200" : undefined}>
              {etapaTexto}
            </span>
            {job.mensagem && (
              <span className="text-tng-marine-400">— {job.mensagem}</span>
            )}
          </p>
          {isFail && job.erro && (
            <p className="mt-1 text-[11px] text-red-300">{job.erro}</p>
          )}
        </div>
        {isDone && job.postUrl && (
          <button
            type="button"
            onClick={() => {
              void openUrl(job.postUrl as string);
            }}
            className="shrink-0 text-xs font-medium text-tng-orange-300 hover:underline"
          >
            Abrir post <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}
