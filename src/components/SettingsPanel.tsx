// =============================================================================
// SettingsPanel — tela única de configurações (Sprint 20)
// =============================================================================
// Substitui os 7 botões soltos do header do Dashboard por uma engrenagem que
// abre esta tela. O user vê em um lugar só as portas de entrada pros painéis
// admin (Clientes, Membros, Uso IA, Regras, Desempenho, Notificações, Atalho).
//
// Esta tela não renderiza os painéis em si — devolve a chave do que foi
// clicado via `onOpen(key)` pro Dashboard, que mantém os estados de cada
// modal admin (e refresh effects associados). Assim a integração é mínima
// e os componentes admin existentes seguem inalterados.
//
// Gating: o cartão "Desempenho" só aparece pra admin.
// =============================================================================

import { useEffect } from "react";
// Versão lida do package.json — Vite resolve via `resolveJsonModule` e dispara
// rebuild quando o arquivo muda, então o footer sempre reflete o release atual.
import pkg from "../../package.json";

export type SettingsPanelKey =
  | "clients"
  | "members"
  | "ai_usage"
  | "rules"
  | "performance"
  | "notifications"
  | "hotkey";

type CardDef = {
  key: SettingsPanelKey;
  title: string;
  description: string;
  icon: string;
  adminOnly?: boolean;
};

const CARDS: CardDef[] = [
  {
    key: "clients",
    title: "Clientes",
    description: "Cadastrar e editar clientes, unidades, links e fase do projeto.",
    icon: "fa-solid fa-building",
  },
  {
    key: "members",
    title: "Membros",
    description: "Gerir membros da equipe, papéis e ativação.",
    icon: "fa-solid fa-users-gear",
  },
  {
    key: "ai_usage",
    title: "Uso da IA",
    description: "Consumo de tokens, custo estimado e histórico do mês.",
    icon: "fa-solid fa-chart-column",
  },
  {
    key: "rules",
    title: "Regras de auto-classificação",
    description: "Como a IA atribui responsáveis, prioridades e tags.",
    icon: "fa-solid fa-list-check",
  },
  {
    key: "performance",
    title: "Desempenho",
    description: "Métricas de produtividade por membro num período.",
    icon: "fa-solid fa-chart-line",
    adminOnly: true,
  },
  {
    key: "notifications",
    title: "Notificações",
    description: "Quais eventos disparam notificação nativa pra você.",
    icon: "fa-solid fa-bell",
  },
  {
    key: "hotkey",
    title: "Atalho de captura",
    description: "Tecla ou combinação que abre a janela de captura.",
    icon: "fa-solid fa-keyboard",
  },
];

export function SettingsPanel({
  open,
  isAdmin,
  onClose,
  onOpen,
}: {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onOpen: (key: SettingsPanelKey) => void;
}) {
  // ESC fecha esta tela. Painéis filhos têm seus próprios ESC handlers e
  // sobem em z-index, então quando estão abertos o ESC cai pra eles.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visibleCards = CARDS.filter((c) => !c.adminOnly || isAdmin);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-tng-marine-900/95 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-4">
        <div className="flex items-center gap-3">
          <i
            className="fa-solid fa-gear text-tng-orange-400"
            aria-hidden="true"
          />
          <h2 className="font-sans text-base font-semibold text-tng-marine-50">
            Configurações
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCards.map((card) => (
            <li key={card.key}>
              <button
                type="button"
                onClick={() => onOpen(card.key)}
                className="group flex h-full w-full items-start gap-3 rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-4 text-left transition hover:border-tng-orange-400/60 hover:bg-tng-marine-800/70"
              >
                <i
                  className={`${card.icon} mt-1 text-lg text-tng-orange-300`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-tng-marine-50 group-hover:text-tng-orange-300">
                    {card.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-tng-marine-400">
                    {card.description}
                  </span>
                </span>
                <i
                  className="fa-solid fa-chevron-right mt-1.5 text-[11px] text-tng-marine-500 group-hover:text-tng-orange-300"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <footer className="border-t border-tng-marine-700 px-6 py-2 text-[10px] text-tng-marine-400">
        <div className="flex items-center justify-between">
          <span>TNG Sites — Demandas</span>
          <span className="tabular-nums">v{pkg.version}</span>
        </div>
      </footer>
    </div>
  );
}
