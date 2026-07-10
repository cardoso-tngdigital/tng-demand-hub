// =============================================================================
// UsoIAView — dashboard de consumo do Gemini pelo Blog (2026-07-09)
// =============================================================================
// Reformulado de card único pra dashboard: filtro de período (hoje / 7d /
// 30d / mês / tudo), stats agregados, quebra por modelo com input/output
// separados e tabela das execuções individuais (modelo, tokens, site, data).
// Espelha o espírito do painel "Uso da IA" do app principal, mas 100%
// separado dele (lê só `blog.ai_usage` via sidecar).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { blogFetch } from "../../../lib/blogClient";
import type { BlogSite } from "../../../types/blog";

type Periodo = "hoje" | "7d" | "30d" | "mes" | "tudo";

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "Este mês" },
  { key: "tudo", label: "Tudo" },
];

type Execucao = {
  id: string;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  custo_estimado: number | null;
  site_id: string | null;
  job_id: string | null;
  created_at: string;
};

type AIUsage = {
  periodo: string;
  inicio: string | null;
  totais: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    execucoes: number;
    custo_estimado: number;
  };
  por_modelo: {
    modelo: string;
    input: number;
    output: number;
    total: number;
    execucoes: number;
  }[];
  execucoes: Execucao[];
};

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function UsoIAView() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [data, setData] = useState<AIUsage | null>(null);
  const [sites, setSites] = useState<BlogSite[]>([]);
  const [modeloFiltro, setModeloFiltro] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [uso, ss] = await Promise.all([
        blogFetch<AIUsage>(`/api/config/ai-usage?periodo=${periodo}`),
        blogFetch<{ sites: BlogSite[] }>("/api/sites"),
      ]);
      setData(uso);
      setSites(ss.sites);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar uso.");
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const siteMap = useMemo(() => {
    const m = new Map<string, BlogSite>();
    for (const s of sites) m.set(s.id, s);
    return m;
  }, [sites]);

  // Filtro por modelo aplicado no cliente — a lista já veio limitada a 200.
  const execucoesVisiveis = useMemo(() => {
    if (!data) return [];
    if (modeloFiltro === "all") return data.execucoes;
    return data.execucoes.filter((e) => e.modelo === modeloFiltro);
  }, [data, modeloFiltro]);

  const temCusto = (data?.totais.custo_estimado ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
            Uso da IA
          </h3>
          <p className="mt-1 text-xs text-tng-marine-400">
            Consumo do Gemini pelo Blog, execução por execução. Independente
            do painel de IA do app principal.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void carregar()}
          className="rounded-md border border-tng-marine-600 px-2.5 py-1 text-xs text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-300"
        >
          <i className="fa-solid fa-rotate mr-1" aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {/* Filtro de período */}
      <div className="flex flex-wrap gap-1.5">
        {PERIODOS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriodo(p.key)}
            aria-pressed={periodo === p.key}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              periodo === p.key
                ? "border-tng-orange-400 bg-tng-orange-400/15 text-tng-orange-200"
                : "border-tng-marine-600 text-tng-marine-300 hover:border-tng-marine-400 hover:text-tng-marine-100"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {erro && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {erro}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-tng-marine-300">Carregando…</p>
      ) : data ? (
        <>
          {/* Stats agregados */}
          <div
            className={`grid grid-cols-2 gap-3 ${temCusto ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}
          >
            <Stat label="Execuções" valor={fmtNum(data.totais.execucoes)} />
            <Stat
              label="Tokens de entrada"
              valor={fmtNum(data.totais.input_tokens)}
            />
            <Stat
              label="Tokens de saída"
              valor={fmtNum(data.totais.output_tokens)}
            />
            <Stat
              label="Total de tokens"
              valor={fmtNum(data.totais.total_tokens)}
              destaque
            />
            {temCusto && (
              <Stat
                label="Custo estimado"
                valor={`US$ ${data.totais.custo_estimado.toFixed(4)}`}
                destaque
              />
            )}
          </div>

          {/* Por modelo */}
          {data.por_modelo.length > 0 && (
            <section className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-4">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-tng-marine-400">
                Por modelo
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-tng-marine-700 text-left text-[10px] uppercase tracking-wider text-tng-marine-400">
                      <th className="pb-2 pr-3 font-medium">Modelo</th>
                      <th className="pb-2 pr-3 text-right font-medium">
                        Execuções
                      </th>
                      <th className="pb-2 pr-3 text-right font-medium">
                        Entrada
                      </th>
                      <th className="pb-2 pr-3 text-right font-medium">
                        Saída
                      </th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.por_modelo.map((m) => (
                      <tr
                        key={m.modelo}
                        className="border-b border-tng-marine-800 last:border-0"
                      >
                        <td className="py-2 pr-3 font-mono text-tng-marine-200">
                          {m.modelo}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-tng-marine-100">
                          {fmtNum(m.execucoes)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-tng-marine-100">
                          {fmtNum(m.input)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-tng-marine-100">
                          {fmtNum(m.output)}
                        </td>
                        <td className="py-2 text-right tabular-nums font-medium text-tng-orange-200">
                          {fmtNum(m.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Execuções individuais */}
          <section className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-wider text-tng-marine-400">
                Execuções{" "}
                <span className="text-tng-marine-500">
                  ({execucoesVisiveis.length}
                  {data.execucoes.length === 200 ? " — últimas 200" : ""})
                </span>
              </p>
              {data.por_modelo.length > 1 && (
                <select
                  value={modeloFiltro}
                  onChange={(e) => setModeloFiltro(e.target.value)}
                  className="rounded-md border border-tng-marine-600 bg-tng-marine-900 px-2 py-1 text-xs text-tng-marine-100 focus:border-tng-orange-400 focus:outline-none"
                >
                  <option value="all" className="bg-tng-marine-900">
                    Todos os modelos
                  </option>
                  {data.por_modelo.map((m) => (
                    <option
                      key={m.modelo}
                      value={m.modelo}
                      className="bg-tng-marine-900"
                    >
                      {m.modelo}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {execucoesVisiveis.length === 0 ? (
              <p className="py-4 text-center text-sm text-tng-marine-400">
                Nenhuma execução no período selecionado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-tng-marine-700 text-left text-[10px] uppercase tracking-wider text-tng-marine-400">
                      <th className="pb-2 pr-3 font-medium">Data</th>
                      <th className="pb-2 pr-3 font-medium">Modelo</th>
                      <th className="pb-2 pr-3 font-medium">Site</th>
                      <th className="pb-2 pr-3 text-right font-medium">
                        Entrada
                      </th>
                      <th className="pb-2 pr-3 text-right font-medium">
                        Saída
                      </th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execucoesVisiveis.map((e) => {
                      const site = e.site_id ? siteMap.get(e.site_id) : null;
                      return (
                        <tr
                          key={e.id}
                          className="border-b border-tng-marine-800 last:border-0"
                        >
                          <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-tng-marine-200">
                            {fmtDataHora(e.created_at)}
                          </td>
                          <td className="py-2 pr-3 font-mono text-tng-marine-300">
                            {e.modelo}
                          </td>
                          <td className="max-w-[180px] truncate py-2 pr-3 text-tng-marine-300">
                            {site ? (site.nome ?? site.url) : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-tng-marine-100">
                            {fmtNum(e.input_tokens)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-tng-marine-100">
                            {fmtNum(e.output_tokens)}
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium text-tng-orange-200">
                            {fmtNum(e.total_tokens)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-md border border-tng-marine-700 bg-tng-marine-900/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-tng-marine-400">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          destaque ? "text-tng-orange-300" : "text-tng-marine-50"
        }`}
      >
        {valor}
      </div>
    </div>
  );
}
