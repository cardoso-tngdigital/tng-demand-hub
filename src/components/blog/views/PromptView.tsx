// =============================================================================
// PromptView — prompt geral do Blog em tela dedicada (2026-07-04)
// =============================================================================
// Movido do ConfigView pra item próprio no menu lateral. Instruções base
// aplicadas a todos os sites (pode ser sobrescrito por site nas Sites).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { blogFetch } from "../../../lib/blogClient";

export function PromptView() {
  const [texto, setTexto] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await blogFetch<{ prompt: string }>("/api/prompt");
      setTexto(res.prompt);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar prompt.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    setSaving(true);
    setErro(null);
    setOkMsg(null);
    try {
      await blogFetch("/api/prompt", {
        method: "PUT",
        body: JSON.stringify({ prompt: texto }),
      });
      setOkMsg("Prompt salvo.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
          Prompt geral
        </h3>
        <p className="mt-1 text-xs text-tng-marine-400">
          Instruções base do artigo. Cada site pode ter um prompt específico
          que sobrescreve este (definido em Sites → Editar prompt).
        </p>
      </div>

      <section className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-5">
        {loading ? (
          <p className="text-sm text-tng-marine-400">Carregando…</p>
        ) : (
          <>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={22}
              className="w-full resize-y rounded-md border border-tng-marine-600 bg-tng-marine-900 px-3 py-2 font-mono text-xs text-tng-marine-50 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none"
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 text-xs">
                {erro && <span className="text-red-300">{erro}</span>}
                {okMsg && !erro && (
                  <span className="text-emerald-300">{okMsg}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={saving}
                className="rounded-md bg-tng-orange-400 px-4 py-2 text-sm font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
