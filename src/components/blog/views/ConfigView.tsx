// =============================================================================
// ConfigView — credenciais Gemini + Magnific (Sprint 27; reduzido em 2026-07-04)
// =============================================================================
// Prompt e Uso de IA saíram daqui e viraram itens próprios no menu lateral.
// Sobrou o que é de fato configuração: chaves de API e conexão do Magnific.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { blogFetch } from "../../../lib/blogClient";

type GeminiModelo = { id: string; rotulo: string };
type GeminiConfig = {
  modelo: string;
  modelos_disponiveis: GeminiModelo[];
  api_key_configurada: boolean;
};


export function ConfigView() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h3 className="font-sans text-lg font-semibold text-tng-marine-50">
          Configurações
        </h3>
        <p className="mt-1 text-xs text-tng-marine-400">
          Credenciais das integrações que o Blog consome.
        </p>
      </div>

      <GeminiCard />
      <MagnificCard />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Card do Gemini
// -----------------------------------------------------------------------------
function GeminiCard() {
  const [cfg, setCfg] = useState<GeminiConfig | null>(null);
  const [novaChave, setNovaChave] = useState<string>("");
  const [savingKey, setSavingKey] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await blogFetch<GeminiConfig>("/api/config/gemini");
      setCfg(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar Gemini.");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarChave() {
    if (!novaChave.trim()) return;
    setSavingKey(true);
    setErro(null);
    setOkMsg(null);
    try {
      await blogFetch("/api/config/gemini", {
        method: "PUT",
        body: JSON.stringify({ api_key: novaChave.trim() }),
      });
      setNovaChave("");
      setOkMsg("Chave atualizada.");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar chave.");
    } finally {
      setSavingKey(false);
    }
  }

  return (
    <Section
      icon="fa-robot"
      title="Gemini"
      description="Chave da API do Gemini usada para gerar o texto dos artigos."
      badge={
        <StatusBadge
          ok={cfg ? cfg.api_key_configurada : null}
          labelOk="Chave configurada"
          labelErro="Chave ausente"
        />
      }
    >
      {!cfg ? (
        <p className="text-sm text-tng-marine-400">Carregando…</p>
      ) : (
        <div className="space-y-4">
          {/* Chave */}
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-tng-marine-300">
              Nova chave da API
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={novaChave}
                onChange={(e) => setNovaChave(e.target.value)}
                placeholder="Cole aqui a chave gerada no Google AI Studio"
                className="flex-1 rounded-md border border-tng-marine-600 bg-tng-marine-900 px-3 py-2 text-sm text-tng-marine-50 placeholder:text-tng-marine-500 focus:border-tng-orange-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void salvarChave()}
                disabled={savingKey || !novaChave.trim()}
                className="rounded-md bg-tng-orange-400 px-3 py-2 text-sm font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:opacity-50"
              >
                {savingKey ? "Salvando…" : "Salvar"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-tng-marine-500">
              A chave nunca é retornada pelo backend por segurança.
            </p>
          </div>

          <p className="rounded-md border border-tng-marine-700 bg-tng-marine-900/40 px-3 py-2 text-[11px] text-tng-marine-400">
            <i className="fa-solid fa-circle-info mr-1 text-tng-orange-300" aria-hidden="true" />
            Modelo padrão: <span className="font-mono text-tng-marine-200">gemini-2.5-flash</span>.
            Se ele estiver sobrecarregado ou sem cota, o sistema tenta automaticamente
            o <span className="font-mono text-tng-marine-200">gemini-2.5-flash-lite</span> como
            reserva. Sem escolha manual — igual o app antigo.
          </p>

          {(erro || okMsg) && (
            <p className={`text-xs ${erro ? "text-red-300" : "text-emerald-300"}`}>
              {erro ?? okMsg}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Card do Magnific
// -----------------------------------------------------------------------------
type MagnificConfigSimples = { conectado: boolean };

function MagnificCard() {
  const [cfg, setCfg] = useState<MagnificConfigSimples | null>(null);
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await blogFetch<{ conectado: boolean }>("/api/config/magnific");
      setCfg({ conectado: res.conectado });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar Magnific.");
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function conectar() {
    // Sem confirm nativo — `window.confirm` é bloqueado pelo Tauri porque
    // exige capability `dialog:confirm`. O botão já é explícito; e o texto
    // logo abaixo avisa que o navegador vai abrir.
    setConectando(true);
    setErro(null);
    setOkMsg(null);
    try {
      await blogFetch("/api/config/magnific/conectar", { method: "POST" });
      setOkMsg("Conexão concluída. Recarregando status…");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao conectar.");
    } finally {
      setConectando(false);
    }
  }

  return (
    <Section
      icon="fa-image"
      title="Magnific"
      description="Serviço que fornece as imagens do artigo. Primeiro busca no banco premium; se não achar nada relevante, gera por IA."
      badge={
        <StatusBadge
          ok={cfg ? cfg.conectado : null}
          labelOk="Conectado"
          labelErro="Não conectado"
        />
      }
    >
      {!cfg ? (
        <p className="text-sm text-tng-marine-400">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-tng-marine-700 bg-tng-marine-900/40 p-3 text-[11px] text-tng-marine-400">
            <i className="fa-solid fa-circle-info mr-1 text-tng-orange-300" aria-hidden="true" />
            <span className="font-medium text-tng-marine-200">Fluxo das imagens:</span>
            <ol className="mt-1.5 ml-4 list-decimal space-y-0.5">
              <li>Busca no banco de imagens premium do Magnific/Freepik (≈1 crédito por imagem).</li>
              <li>Se não achar nada bom, gera por IA com <span className="font-mono text-tng-marine-200">imagen-nano-banana</span> (Google Nano Banana Pro, ≈50 créditos por imagem).</li>
            </ol>
            <p className="mt-1.5">Sem escolha manual — igual o app antigo.</p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => void conectar()}
              disabled={conectando}
              className="rounded-md border border-tng-orange-400 bg-tng-orange-400/10 px-3 py-1.5 text-sm font-medium text-tng-orange-200 transition hover:bg-tng-orange-400/20 disabled:opacity-50"
            >
              {conectando ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" />
                  Aguardando autorização…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-link mr-1.5" aria-hidden="true" />
                  {cfg.conectado ? "Reconectar" : "Conectar"}
                </>
              )}
            </button>
            <p className="mt-1 text-[11px] text-tng-marine-500">
              Ao clicar, o navegador padrão abre pra você autorizar. Feche a
              aba após confirmar.
            </p>
          </div>

          {(erro || okMsg) && (
            <p className={`text-xs ${erro ? "text-red-300" : "text-emerald-300"}`}>
              {erro ?? okMsg}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

/**
 * Badge de status no TOPO do card (acima do título) — primeira coisa que o
 * operador vê ao abrir Configurações (feedback 2026-07-09). Verde sólido
 * quando ok; vermelho quando não conectado/sem chave; cinza enquanto carrega.
 */
function StatusBadge({
  ok,
  labelOk,
  labelErro,
}: {
  ok: boolean | null;
  labelOk: string;
  labelErro: string;
}) {
  if (ok === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-tng-marine-700 px-2.5 py-1 text-[11px] font-semibold text-tng-marine-300">
        <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
        Verificando…
      </span>
    );
  }
  return ok ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-emerald-950">
      <i className="fa-solid fa-circle-check" aria-hidden="true" />
      {labelOk}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-red-950">
      <i className="fa-solid fa-circle-xmark" aria-hidden="true" />
      {labelErro}
    </span>
  );
}

function Section({
  icon,
  title,
  description,
  badge,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  /** Badge de status renderizado ACIMA do título (2026-07-09). */
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-5">
      {badge && <div className="mb-3">{badge}</div>}
      <header className="mb-3 flex items-start gap-3">
        <i
          className={`fa-solid ${icon} mt-1 text-tng-orange-300`}
          aria-hidden="true"
        />
        <div>
          <h4 className="text-sm font-semibold text-tng-marine-50">{title}</h4>
          <p className="mt-0.5 text-[11px] text-tng-marine-400">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
