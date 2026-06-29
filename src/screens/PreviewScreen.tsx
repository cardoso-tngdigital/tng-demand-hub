// =============================================================================
// PreviewScreen — janela "Quick Look" para anexos
// =============================================================================
// Roda na janela `preview` do Tauri (declarada no tauri.conf.json,
// pré-criada em visible: false). Escuta `preview:open` com o payload do
// anexo (signed URL + metadata) e renderiza por tipo:
//   - image: zoom com scroll wheel (pivô no cursor), pan com drag, +/-/0 keys
//   - audio: <audio controls>
//   - video: <video controls>
//   - pdf:   <iframe> (zoom nativo do webview)
//   - outros: ícone + nome + botão de download
//
// Esc esconde a janela (mantém viva pra próxima preview). Botão X nativo
// é interceptado via onCloseRequested e também esconde.
// =============================================================================

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isRegistered as gsIsRegistered,
  register as gsRegister,
  unregister as gsUnregister,
} from "@tauri-apps/plugin-global-shortcut";
import { categorize, categoryIconClass, formatBytes } from "../lib/attachments";
import {
  isCsv,
  isDocx,
  isPlainText,
  isXlsx,
  parseCsv,
  renderDocxAsHtml,
  renderTextFile,
  renderXlsxAsSheets,
  type XlsxSheet,
} from "../lib/officeRender";
import type { PreviewPayload } from "../lib/preview";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.25;

type ViewState = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

const INITIAL_VIEW: ViewState = { scale: 1, offsetX: 0, offsetY: 0 };

export function PreviewScreen() {
  const [bundle, setBundle] = useState<PreviewPayload | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = bundle && bundle.items[currentIndex] ? bundle.items[currentIndex] : null;

  const hide = useCallback(async () => {
    // Limpa o bundle ANTES de destruir pra desmontar qualquer <video>
    // ou <audio> em reprodução — só destruir a janela do macOS pode
    // deixar a mídia tocando até o GC liberar o webview.
    setBundle(null);
    setCurrentIndex(0);
    setView(INITIAL_VIEW);
    try {
      // destroy() em vez de hide(): a janela some do CGWindowList do
      // macOS, então o AltTab não a lista mais. Próximo preview cria
      // outra (cold start ~200ms, aceitável).
      await getCurrentWindow().destroy();
    } catch (err) {
      console.error("[Preview] destroy failed:", err);
    }
  }, []);

  const goPrev = useCallback(() => {
    setBundle((b) => {
      if (!b || b.items.length <= 1) return b;
      setCurrentIndex((i) => (i - 1 + b.items.length) % b.items.length);
      setView(INITIAL_VIEW);
      return b;
    });
  }, []);

  const goNext = useCallback(() => {
    setBundle((b) => {
      if (!b || b.items.length <= 1) return b;
      setCurrentIndex((i) => (i + 1) % b.items.length);
      setView(INITIAL_VIEW);
      return b;
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<PreviewPayload>("preview:open", (event) => {
      const p = event.payload;
      setBundle(p);
      setCurrentIndex(p.currentIndex);
      setView(INITIAL_VIEW);
      const first = p.items[p.currentIndex];
      if (first) {
        void getCurrentWindow()
          .setTitle(first.name)
          .catch(() => undefined);
      }
      // Foca o container raiz pra que Esc / +/- / 0 / ←/→ funcionem antes do
      // user clicar em qualquer lugar. Quando o foco vai pro iframe do
      // PDF, esse keydown deixa de chegar — daí o botão Fechar visível.
      window.setTimeout(() => rootRef.current?.focus(), 50);
    });

    // Avisa quem chamou (em main) que o React montou e o listener acima
    // está vivo — sem isso o evento `preview:open` emitido logo após
    // criar a janela é entregue antes do listener registrar e se perde.
    void emit("preview:ready");

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Atualiza o título do app quando user navega entre anexos.
  useEffect(() => {
    if (!current) return;
    void getCurrentWindow().setTitle(current.name).catch(() => undefined);
  }, [current]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((e) => {
      e.preventDefault();
      void hide();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [hide]);

  // Esc global enquanto PDF estiver carregado e a janela preview focada.
  // O iframe do PDF rouba o foco do teclado, então `keydown` no React
  // nunca recebe o Escape. A solução é registrar um atalho global escopo
  // por foco — só ativo enquanto a preview está em primeiro plano, evita
  // sequestrar o Esc de outros apps.
  const isPdf = current?.mime === "application/pdf";
  useEffect(() => {
    if (!isPdf) return;

    let registered = false;
    let cancelled = false;

    async function reg() {
      if (registered || cancelled) return;
      try {
        for (const acc of ["Escape", "ArrowLeft", "ArrowRight"]) {
          if (await gsIsRegistered(acc)) await gsUnregister(acc);
        }
        await gsRegister("Escape", (e) => {
          if (e.state === "Pressed") void hide();
        });
        await gsRegister("ArrowLeft", (e) => {
          if (e.state === "Pressed") goPrev();
        });
        await gsRegister("ArrowRight", (e) => {
          if (e.state === "Pressed") goNext();
        });
        registered = true;
      } catch (err) {
        console.error("[Preview] register globals failed:", err);
      }
    }

    async function unreg() {
      if (!registered) return;
      try {
        for (const acc of ["Escape", "ArrowLeft", "ArrowRight"]) {
          await gsUnregister(acc).catch(() => undefined);
        }
      } catch (err) {
        console.error("[Preview] unregister globals failed:", err);
      } finally {
        registered = false;
      }
    }

    const win = getCurrentWindow();
    let unlistenFocus: (() => void) | null = null;

    void win.isFocused().then((focused) => {
      if (cancelled) return;
      if (focused) void reg();
    });

    void win.onFocusChanged(({ payload: focused }) => {
      if (focused) void reg();
      else void unreg();
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenFocus = fn;
    });

    return () => {
      cancelled = true;
      unlistenFocus?.();
      void unreg();
    };
  }, [isPdf, hide, goPrev, goNext]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        void hide();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setView((v) => ({ ...v, scale: clampZoom(v.scale * ZOOM_STEP) }));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setView((v) => ({ ...v, scale: clampZoom(v.scale / ZOOM_STEP) }));
      } else if (e.key === "0") {
        e.preventDefault();
        setView(INITIAL_VIEW);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide, goPrev, goNext]);

  function handleDownload() {
    if (!current) return;
    const a = document.createElement("a");
    a.href = current.url;
    a.download = current.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!current || !bundle) {
    return (
      <div className="flex h-screen items-center justify-center bg-tng-marine-900">
        <p className="text-sm text-tng-marine-300">Aguardando arquivo…</p>
      </div>
    );
  }

  const category = categorize(current.mime);
  const showZoomControls = category === "image";
  const hasMultiple = bundle.items.length > 1;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex h-screen flex-col bg-tng-marine-900 outline-none"
    >
      <header className="flex items-center justify-between border-b border-tng-marine-700/60 bg-tng-marine-800 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {hasMultiple && (
            <button
              type="button"
              onClick={goPrev}
              className="rounded-md p-1.5 text-tng-marine-300 transition hover:bg-tng-marine-700 hover:text-tng-marine-100"
              aria-label="Anexo anterior"
              title="Anterior (←)"
            >
              <i className="fa-solid fa-chevron-left" aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-tng-marine-50">
              {current.name}
            </p>
            <p className="text-[11px] text-tng-marine-300">
              {formatBytes(current.sizeBytes)} · {current.mime}
              {hasMultiple && (
                <span className="ml-2 text-tng-marine-400">
                  · {currentIndex + 1} / {bundle.items.length}
                </span>
              )}
            </p>
          </div>
          {hasMultiple && (
            <button
              type="button"
              onClick={goNext}
              className="rounded-md p-1.5 text-tng-marine-300 transition hover:bg-tng-marine-700 hover:text-tng-marine-100"
              aria-label="Próximo anexo"
              title="Próximo (→)"
            >
              <i className="fa-solid fa-chevron-right" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {showZoomControls && (
            <>
              <ZoomButton
                onClick={() =>
                  setView((v) => ({ ...v, scale: clampZoom(v.scale / ZOOM_STEP) }))
                }
                label="Diminuir zoom"
                icon="fa-magnifying-glass-minus"
              />
              <button
                type="button"
                onClick={() => setView(INITIAL_VIEW)}
                className="rounded-md px-2 py-1 text-[11px] tabular-nums text-tng-marine-100 transition hover:bg-tng-marine-700"
                aria-label="Resetar zoom"
              >
                {Math.round(view.scale * 100)}%
              </button>
              <ZoomButton
                onClick={() =>
                  setView((v) => ({ ...v, scale: clampZoom(v.scale * ZOOM_STEP) }))
                }
                label="Aumentar zoom"
                icon="fa-magnifying-glass-plus"
              />
              <span className="mx-1 h-5 w-px bg-tng-marine-700" />
            </>
          )}
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-md border border-tng-marine-600 px-3 py-1 text-xs text-tng-marine-100 transition hover:border-tng-orange-400 hover:text-tng-orange-400"
          >
            <i className="fa-solid fa-download mr-1.5" aria-hidden="true" />
            Baixar
          </button>
          <button
            type="button"
            onClick={() => void hide()}
            aria-label="Fechar"
            title="Fechar (Esc)"
            className="rounded-md p-1.5 text-tng-marine-300 transition hover:bg-tng-marine-700 hover:text-tng-marine-100"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ViewerErrorBoundary key={current.url}>
        {category === "image" ? (
          <ImageStage
            url={current.url}
            alt={current.name}
            view={view}
            onViewChange={setView}
          />
        ) : category === "audio" ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="w-full max-w-xl rounded-lg bg-tng-marine-800/80 p-6 text-center">
              <div className="mb-4 text-5xl text-tng-marine-300">
                <i className="fa-solid fa-music" aria-hidden="true" />
              </div>
              <audio controls src={current.url} className="w-full" />
            </div>
          </div>
        ) : category === "video" ? (
          <div className="flex h-full items-center justify-center bg-black p-4">
            <video
              controls
              src={current.url}
              className="max-h-full max-w-full rounded shadow-lg"
            />
          </div>
        ) : category === "pdf" ? (
          <iframe
            src={current.url}
            title={current.name}
            className="h-full w-full border-0 bg-white"
          />
        ) : isDocx(current.mime) ? (
          <DocxView url={current.url} />
        ) : isXlsx(current.mime) ? (
          <XlsxView url={current.url} />
        ) : isCsv(current.mime) ? (
          <CsvView url={current.url} />
        ) : isPlainText(current.mime) ? (
          <PlainTextView url={current.url} />
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <div className="rounded-lg bg-tng-marine-800/80 p-8 text-center">
              <div className="mb-3 text-5xl text-tng-marine-300">
                <i className={categoryIconClass(category)} aria-hidden="true" />
              </div>
              <p className="mb-1 text-sm text-tng-marine-100">{current.name}</p>
              <p className="text-xs text-tng-marine-300">
                Pré-visualização não suportada — use “Baixar”.
              </p>
            </div>
          </div>
        )}
        </ViewerErrorBoundary>
      </div>

      <footer className="flex items-center justify-between border-t border-tng-marine-700/60 bg-tng-marine-800/60 px-4 py-1.5 text-[10px] text-tng-marine-400">
        <span>
          {showZoomControls ? (
            <>
              <kbd className="rounded bg-tng-marine-700 px-1 py-0.5 text-tng-marine-100">
                +
              </kbd>{" "}
              /{" "}
              <kbd className="rounded bg-tng-marine-700 px-1 py-0.5 text-tng-marine-100">
                −
              </kbd>{" "}
              zoom &nbsp;·&nbsp;
              <kbd className="rounded bg-tng-marine-700 px-1 py-0.5 text-tng-marine-100">
                0
              </kbd>{" "}
              reset &nbsp;·&nbsp; scroll do mouse + arrastar pra mover
            </>
          ) : (
            <>visualizando arquivo</>
          )}
        </span>
        <span>
          <kbd className="rounded bg-tng-marine-700 px-1 py-0.5 text-tng-marine-100">
            Esc
          </kbd>{" "}
          fecha
        </span>
      </footer>
    </div>
  );
}

function ZoomButton(props: {
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      className="rounded-md p-1.5 text-tng-marine-200 transition hover:bg-tng-marine-700 hover:text-tng-marine-50"
    >
      <i className={`fa-solid ${props.icon} text-xs`} aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// ImageStage — área de exibição da imagem com pan/zoom centrado no cursor
// ---------------------------------------------------------------------------

function ImageStage(props: {
  url: string;
  alt: string;
  view: ViewState;
  onViewChange: (next: ViewState | ((prev: ViewState) => ViewState)) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;

    props.onViewChange((prev) => {
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const nextScale = clampZoom(prev.scale * factor);
      const ratio = nextScale / prev.scale;
      // Ajusta offset para manter o pixel sob o cursor parado durante o zoom.
      const nextOffsetX = cursorX - (cursorX - prev.offsetX) * ratio;
      const nextOffsetY = cursorY - (cursorY - prev.offsetY) * ratio;
      return {
        scale: nextScale,
        offsetX: nextOffsetX,
        offsetY: nextOffsetY,
      };
    });
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: props.view.offsetX,
      baseY: props.view.offsetY,
    };
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    props.onViewChange((prev) => ({
      ...prev,
      offsetX: drag.baseX + (e.clientX - drag.startX),
      offsetY: drag.baseY + (e.clientY - drag.startY),
    }));
  }

  function onMouseUp() {
    dragRef.current = null;
  }

  function onDoubleClick() {
    if (props.view.scale === 1 && props.view.offsetX === 0 && props.view.offsetY === 0) {
      props.onViewChange({ scale: 2, offsetX: 0, offsetY: 0 });
    } else {
      props.onViewChange(INITIAL_VIEW);
    }
  }

  const cursor =
    props.view.scale > 1
      ? dragRef.current
        ? "grabbing"
        : "grab"
      : "zoom-in";

  return (
    <div
      ref={stageRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
      className="flex h-full w-full select-none items-center justify-center overflow-hidden bg-black/40"
      style={{ cursor }}
    >
      <img
        src={props.url}
        alt={props.alt}
        draggable={false}
        className="max-h-full max-w-full"
        style={{
          transform: `translate(${props.view.offsetX}px, ${props.view.offsetY}px) scale(${props.view.scale})`,
          transformOrigin: "center center",
          transition: dragRef.current ? "none" : "transform 80ms ease-out",
        }}
      />
    </div>
  );
}

function clampZoom(v: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
}

// ---------------------------------------------------------------------------
// Viewers de documentos office
// ---------------------------------------------------------------------------

function useAsyncResource<T>(
  loader: () => Promise<T>,
  key: string,
): { state: "loading" | "ready" | "error"; data: T | null; error: string | null } {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setData(null);
    setError(null);
    loader()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state, data, error };
}

function LoadingPane({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-tng-marine-300">
      {label}
    </div>
  );
}

function ErrorPane({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-md border border-red-500/30 bg-red-500/10 p-4 text-center text-xs text-red-200">
        <p className="mb-1 font-semibold">Não foi possível abrir o arquivo</p>
        <p>{message}</p>
      </div>
    </div>
  );
}

// Isola crashes dentro de um viewer (ex.: render de planilha em formato
// inesperado) para que o resto da PreviewScreen continue funcionando.
// Sem isso, um throw em renderização deixa a árvore React em estado ruim
// e os próximos arquivos abertos não montam direito. Reset pelo `key`
// externo (passamos a URL) — toda troca de arquivo monta um boundary novo.
class ViewerErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Preview] viewer crash:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ErrorPane message={this.state.error.message} />;
    }
    return this.props.children;
  }
}

function DocxView({ url }: { url: string }) {
  const { state, data, error } = useAsyncResource<string>(
    () => renderDocxAsHtml(url),
    url,
  );
  if (state === "loading") return <LoadingPane label="Convertendo documento…" />;
  if (state === "error" || !data) return <ErrorPane message={error ?? "Falha desconhecida"} />;
  return (
    <div className="h-full overflow-auto bg-white px-8 py-6 text-sm leading-relaxed text-tng-graphite-900">
      <div className="mx-auto max-w-3xl" dangerouslySetInnerHTML={{ __html: data }} />
    </div>
  );
}

function XlsxView({ url }: { url: string }) {
  const { state, data, error } = useAsyncResource<XlsxSheet[]>(
    () => renderXlsxAsSheets(url),
    url,
  );
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    setActiveSheet(0);
  }, [url]);

  if (state === "loading") return <LoadingPane label="Lendo planilha…" />;
  if (state === "error" || !data) return <ErrorPane message={error ?? "Falha desconhecida"} />;

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tng-marine-300">
        Planilha vazia.
      </div>
    );
  }

  const sheet = data[Math.min(activeSheet, data.length - 1)];
  return (
    <div className="flex h-full flex-col bg-tng-marine-900">
      {data.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-tng-marine-700 bg-tng-marine-800 px-2 py-1">
          {data.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={`shrink-0 rounded px-2.5 py-1 text-[11px] transition ${
                i === activeSheet
                  ? "bg-tng-orange-400 text-tng-marine-900"
                  : "text-tng-marine-200 hover:bg-tng-marine-700"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <SheetTable rows={sheet.rows} />
    </div>
  );
}

function CsvView({ url }: { url: string }) {
  const { state, data, error } = useAsyncResource<string[][]>(
    async () => parseCsv(await renderTextFile(url)),
    url,
  );
  if (state === "loading") return <LoadingPane label="Lendo CSV…" />;
  if (state === "error" || !data) return <ErrorPane message={error ?? "Falha desconhecida"} />;
  return <SheetTable rows={data} />;
}

function PlainTextView({ url }: { url: string }) {
  const { state, data, error } = useAsyncResource<string>(
    () => renderTextFile(url),
    url,
  );
  if (state === "loading") return <LoadingPane label="Carregando texto…" />;
  if (state === "error" || !data) return <ErrorPane message={error ?? "Falha desconhecida"} />;
  return (
    <pre className="h-full overflow-auto bg-tng-marine-900 px-6 py-4 font-mono text-xs leading-relaxed text-tng-marine-100">
      {data}
    </pre>
  );
}

function SheetTable({ rows }: { rows: (string | number | null)[][] }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-tng-marine-300">
        Sem linhas.
      </div>
    );
  }
  const [header, ...body] = rows;
  // Guarda final: se mesmo após a normalização do officeRender o header não
  // vier como array, mostramos uma mensagem em vez de tentar `.map` e
  // crashar o componente (e a janela inteira) com TypeError.
  if (!Array.isArray(header)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-tng-marine-300">
        Planilha em formato não suportado.
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto bg-tng-marine-900">
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-tng-marine-800">
          <tr>
            <th className="border-b border-r border-tng-marine-700 bg-tng-marine-800 px-2 py-1.5 text-right text-[10px] font-normal text-tng-marine-400">
              #
            </th>
            {header.map((cell, i) => (
              <th
                key={i}
                className="border-b border-r border-tng-marine-700 bg-tng-marine-800 px-3 py-1.5 text-left font-medium text-tng-marine-100"
              >
                {cell === null ? "" : String(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-tng-marine-800/40">
              <td className="border-b border-r border-tng-marine-700/60 bg-tng-marine-800/40 px-2 py-1 text-right text-[10px] text-tng-marine-400 tabular-nums">
                {rowIdx + 2}
              </td>
              {row.map((cell, colIdx) => (
                <td
                  key={colIdx}
                  className="border-b border-r border-tng-marine-700/60 px-3 py-1 text-tng-marine-100"
                >
                  {cell === null ? "" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
