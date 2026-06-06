import { useEffect, useState } from "react";

const STORAGE_KEY = "tng:onboarded:v1";

type Slide = {
  emoji: string;
  title: string;
  body: React.ReactNode;
};

const SLIDES: Slide[] = [
  {
    emoji: "⌘⇧D",
    title: "Captura em qualquer lugar",
    body: (
      <>
        Aperte <Kbd>⌘</Kbd> + <Kbd>⇧</Kbd> + <Kbd>D</Kbd> em qualquer momento —
        mesmo com o app fechado — pra abrir a janela flutuante e registrar uma
        demanda. Digite o que precisa ser feito e pressione{" "}
        <Kbd>Enter</Kbd>. A IA cuida da estrutura.
      </>
    ),
  },
  {
    emoji: "📎",
    title: "Anexos viram contexto da IA",
    body: (
      <>
        Cole imagens do clipboard, arraste arquivos, ou clique em{" "}
        <em>escolha</em>. Áudio do WhatsApp vira transcrição, imagens viram
        descrição, PDFs viram resumo — tudo direto na descrição da demanda.
      </>
    ),
  },
  {
    emoji: "🗂️",
    title: "Painel de detalhes e Kanban",
    body: (
      <>
        Clique em qualquer demanda da lista pra abrir o painel lateral — todos
        os campos editáveis, anexos com preview embutido, comentários da
        equipe. Troque para o modo <strong>Kanban</strong> no canto superior
        direito e arraste cards entre colunas pra mudar status.
      </>
    ),
  },
  {
    emoji: "🔍",
    title: "Busca, regras e notificações",
    body: (
      <>
        <Kbd>⌘</Kbd> + <Kbd>K</Kbd> abre busca instantânea. Em{" "}
        <strong>Regras</strong> dá pra criar atalhos do tipo "quando contém
        banner → prioridade alta". Quando alguém atribui uma demanda a você ou
        comenta na sua, o macOS notifica nativamente.
      </>
    ),
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-tng-marine-700 px-1.5 py-0.5 text-[11px] text-tng-marine-50">
      {children}
    </kbd>
  );
}

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    try {
      const done = window.localStorage.getItem(STORAGE_KEY);
      if (!done) setOpen(true);
    } catch {
      // ambiente sem localStorage — não abre por garantia
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  function next() {
    if (index < SLIDES.length - 1) setIndex(index + 1);
    else finish();
  }
  function prev() {
    if (index > 0) setIndex(index - 1);
  }
  function finish() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* noop */
    }
    setOpen(false);
  }

  if (!open) return null;

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-tng-marine-600 bg-tng-marine-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-tng-marine-700 px-5 py-3">
          <span className="text-[10px] uppercase tracking-wider text-tng-marine-300">
            {index + 1} de {SLIDES.length}
          </span>
          <button
            onClick={finish}
            className="text-[11px] text-tng-marine-300 hover:text-tng-marine-100"
          >
            Pular
          </button>
        </div>

        <div className="px-6 py-8 text-center">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-xl bg-tng-orange-400/15 text-2xl text-tng-orange-300">
            {slide.emoji}
          </div>
          <h2 className="font-sans text-lg font-semibold text-tng-marine-50">
            {slide.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-tng-marine-200">
            {slide.body}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-tng-marine-700 bg-tng-marine-800/60 px-5 py-3">
          <div className="flex gap-1.5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-6 rounded-full transition ${
                  i === index ? "bg-tng-orange-400" : "bg-tng-marine-600"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={index === 0}
              className="rounded-md px-2.5 py-1 text-[11px] text-tng-marine-300 hover:text-tng-marine-100 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ← Voltar
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300"
            >
              {isLast ? "Começar" : "Próximo →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
