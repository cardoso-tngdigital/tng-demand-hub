// =============================================================================
// Atalho global de captura — combinação tradicional (Cmd+Shift+D etc.)
// =============================================================================
// Usa o plugin global-shortcut do Tauri. O frontend persiste a preferência
// em localStorage e re-registra no Rust via comando set_capture_hotkey.
//
// Formato dos accelerators (definido pelo Tauri):
//   - Modificadores: CmdOrCtrl, CommandOrControl, Cmd, Command, Ctrl,
//     Control, Alt, Option, Shift, Super
//   - Teclas: A-Z (1 char), 0-9 (1 dígito), F1-F24, Space, Enter, Tab,
//     Escape, Backspace, ArrowUp/Down/Left/Right e símbolos comuns.
//   - Junção por "+": ex.: "CmdOrCtrl+Shift+D".
//   - "CmdOrCtrl" vira Cmd em macOS e Ctrl em Windows automaticamente —
//     usar essa forma evita ramificação por plataforma na preferência.
//
// Histórico: uma versão anterior tentou dupla pressão de tecla isolada via
// crate `rdev`. No macOS o EventTap requer main thread e o Tauri já a ocupa,
// então qualquer keypress crashava o app. Voltamos ao combo tradicional.
// =============================================================================

export type Platform = "macos" | "windows" | "linux";

export type HotkeyMode = "combo" | "double-tap";
export type DoubleTapModifier = "ctrl" | "alt" | "shift" | "cmd";

const STORAGE_KEY = "tng:hotkey:capture";
const STORAGE_MODE = "tng:hotkey:mode";
const STORAGE_DOUBLE_TAP = "tng:hotkey:double-tap";
const STORAGE_CONFIG_VERSION = "tng:hotkey:config-version";
// Versão atual do default. Quando bumpar, todo cliente que ainda estiver em
// versão anterior recebe o novo default na próxima execução, mesmo que tenha
// uma escolha antiga salva. Versões:
//   1 — combo Cmd+Shift+D era o default
//   2 — dupla pressão Option/Alt vira o default (Sprint 14, junho/2026)
const CURRENT_CONFIG_VERSION = "2";
export const DEFAULT_HOTKEY = "CmdOrCtrl+Shift+D";
// Default da dupla pressão: Option (Alt) no Mac, Alt no Windows — mesma
// tecla que o Claude Desktop usa.
export const DEFAULT_DOUBLE_TAP: DoubleTapModifier = "alt";
// Default do modo: dupla pressão é mais ergonômica e foi adotada como
// padrão pela Sprint 14. Quem já tinha combo escolhido explicitamente
// mantém via migrateHotkeyConfigIfNeeded().
export const DEFAULT_MODE: HotkeyMode = "double-tap";

const MODIFIERS = new Set([
  "CmdOrCtrl",
  "CommandOrControl",
  "Cmd",
  "Command",
  "Ctrl",
  "Control",
  "Alt",
  "Option",
  "Shift",
  "Super",
]);

// Presets sugeridos no modal. Combos que raramente colidem com atalhos do
// sistema, dos browsers ou de editores comuns.
export const HOTKEY_PRESETS: { accelerator: string; label: string }[] = [
  { accelerator: "CmdOrCtrl+Shift+D", label: "Padrão" },
  { accelerator: "CmdOrCtrl+Shift+Space", label: "Espaço" },
  { accelerator: "CmdOrCtrl+Alt+D", label: "Alt+D" },
  { accelerator: "CmdOrCtrl+Shift+T", label: "Shift+T" },
];

export function getPlatform(): Platform {
  if (typeof navigator !== "undefined") {
    const p = navigator.platform || "";
    if (/Mac|iPod|iPhone|iPad/.test(p)) return "macos";
    if (/Win/.test(p)) return "windows";
  }
  return "linux";
}

export function getDefaultHotkey(): string {
  return DEFAULT_HOTKEY;
}

export function getStoredHotkey(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && isValidAccelerator(v)) return v;
  } catch {
    // localStorage indisponível
  }
  return DEFAULT_HOTKEY;
}

export function setStoredHotkey(accel: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, accel);
  } catch (err) {
    console.error("[hotkey] setStoredHotkey falhou:", err);
  }
}

export function isValidAccelerator(accel: string): boolean {
  if (typeof accel !== "string" || accel.length === 0) return false;
  const parts = accel.split("+");
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (mods.length === 0) return false;
  for (const m of mods) {
    if (!MODIFIERS.has(m)) return false;
  }
  if (MODIFIERS.has(key)) return false;
  if (key.length === 0) return false;
  return true;
}

// Display amigável: macOS usa símbolos (⌘⇧D), Windows usa nomes com " + ".
export function displayHotkey(
  accel: string,
  platform: Platform = getPlatform(),
): string {
  const parts = accel.split("+");
  if (platform === "macos") {
    return parts.map(macSymbol).join("");
  }
  return parts.map(winLabel).join(" + ");
}

function macSymbol(part: string): string {
  switch (part) {
    case "CmdOrCtrl":
    case "CommandOrControl":
    case "Cmd":
    case "Command":
      return "⌘";
    case "Ctrl":
    case "Control":
      return "⌃";
    case "Alt":
    case "Option":
      return "⌥";
    case "Shift":
      return "⇧";
    case "Super":
      return "✦";
    case "Space":
      return "␣";
    case "Enter":
      return "↵";
    case "Backspace":
      return "⌫";
    case "Tab":
      return "⇥";
    case "Escape":
      return "⎋";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    default:
      return part;
  }
}

function winLabel(part: string): string {
  switch (part) {
    case "CmdOrCtrl":
    case "CommandOrControl":
      return "Ctrl";
    case "Cmd":
    case "Command":
      return "Win";
    case "Option":
      return "Alt";
    case "Super":
      return "Win";
    default:
      return part;
  }
}

// Constrói um accelerator a partir de um KeyboardEvent. Retorna null se a
// combinação ainda não é válida (sem modificador, ou ainda só modificador).
// Usamos `event.code` em vez de `event.key` pra ficar independente de
// layout (KeyD = posição "D" em qualquer teclado, mesmo AZERTY).
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  // CmdOrCtrl resolve sozinho — não distinguimos meta vs ctrl no storage
  if (e.metaKey || e.ctrlKey) mods.push("CmdOrCtrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");

  const key = normalizeKey(e.code);
  if (!key) return null;
  if (mods.length === 0) return null;

  return [...mods, key].join("+");
}

function normalizeKey(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3); // KeyD → D
  if (code.startsWith("Digit")) return code.slice(5); // Digit1 → 1
  if (code.startsWith("Arrow")) return code; // ArrowUp etc.
  if (/^F\d+$/.test(code)) return code; // F1..F24
  switch (code) {
    case "Space":
    case "Enter":
    case "Tab":
    case "Escape":
    case "Backspace":
    case "Equal":
    case "Minus":
    case "BracketLeft":
    case "BracketRight":
    case "Backslash":
    case "Semicolon":
    case "Quote":
    case "Comma":
    case "Period":
    case "Slash":
    case "Backquote":
      return code;
  }
  // Modificadores sozinhos ou teclas não suportadas
  return null;
}

// Aplica o atalho no Rust. Idempotente — chamar várias vezes é seguro.
// Retorna mensagem de erro quando o Tauri rejeita (ex.: combo já registrado
// por outro app).
export async function applyHotkeyToRust(accel: string): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_capture_hotkey", { accelerator: accel });
    return null;
  } catch (err) {
    console.error("[hotkey] set_capture_hotkey falhou:", err);
    return err instanceof Error ? err.message : String(err);
  }
}

// ---------------------------------------------------------------------------
// Modo dupla pressão (option+option, ctrl+ctrl, etc.)
// ---------------------------------------------------------------------------

export function isDoubleTapModifier(v: unknown): v is DoubleTapModifier {
  return v === "ctrl" || v === "alt" || v === "shift" || v === "cmd";
}

export function getHotkeyMode(): HotkeyMode {
  try {
    const v = localStorage.getItem(STORAGE_MODE);
    if (v === "double-tap" || v === "combo") return v;
  } catch {
    // localStorage indisponível
  }
  return DEFAULT_MODE;
}

// Migra clientes que ainda estão na config version antiga pro novo default.
// Idempotente — segunda execução é no-op. Deve rodar antes de applyHotkey()
// no boot. Pra quem nunca escolheu modo, simplesmente seta o default. Pra
// quem escolheu explicitamente algo antes da v2, sobrescreve com o novo
// default (a Sprint 14 mudou a configuração padrão).
export function migrateHotkeyConfigIfNeeded(): void {
  try {
    const v = localStorage.getItem(STORAGE_CONFIG_VERSION);
    if (v === CURRENT_CONFIG_VERSION) return;
    localStorage.setItem(STORAGE_MODE, DEFAULT_MODE);
    localStorage.setItem(STORAGE_DOUBLE_TAP, DEFAULT_DOUBLE_TAP);
    localStorage.setItem(STORAGE_CONFIG_VERSION, CURRENT_CONFIG_VERSION);
  } catch (err) {
    console.error("[hotkey] migrate falhou:", err);
  }
}

export function setHotkeyMode(mode: HotkeyMode): void {
  try {
    localStorage.setItem(STORAGE_MODE, mode);
  } catch (err) {
    console.error("[hotkey] setHotkeyMode falhou:", err);
  }
}

export function getStoredDoubleTap(): DoubleTapModifier {
  try {
    const v = localStorage.getItem(STORAGE_DOUBLE_TAP);
    if (isDoubleTapModifier(v)) return v;
  } catch {
    // storage indisponível
  }
  return DEFAULT_DOUBLE_TAP;
}

export function setStoredDoubleTap(mod: DoubleTapModifier): void {
  try {
    localStorage.setItem(STORAGE_DOUBLE_TAP, mod);
  } catch (err) {
    console.error("[hotkey] setStoredDoubleTap falhou:", err);
  }
}

export const ALL_DOUBLE_TAP_MODIFIERS: DoubleTapModifier[] = [
  "ctrl",
  "alt",
  "shift",
  "cmd",
];

// Display da dupla pressão: símbolo Mac repetido (⌥⌥) ou texto Win/Linux.
export function displayDoubleTap(
  mod: DoubleTapModifier,
  platform: Platform = getPlatform(),
): string {
  if (platform === "macos") {
    const sym: Record<DoubleTapModifier, string> = {
      ctrl: "⌃",
      alt: "⌥",
      shift: "⇧",
      cmd: "⌘",
    };
    return `${sym[mod]}${sym[mod]}`;
  }
  const name = doubleTapLabel(mod, platform);
  return `${name} ${name}`;
}

// Nome longo do modificador, próprio da plataforma.
export function doubleTapLabel(
  mod: DoubleTapModifier,
  platform: Platform = getPlatform(),
): string {
  if (platform === "macos") {
    return { ctrl: "Control", alt: "Option", shift: "Shift", cmd: "Command" }[mod];
  }
  if (platform === "windows") {
    return { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Win" }[mod];
  }
  return { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super" }[mod];
}

// Display do atalho atual (combo OU dupla pressão), pra mostrar no header.
export function getCurrentHotkeyDisplay(
  platform: Platform = getPlatform(),
): string {
  if (getHotkeyMode() === "double-tap") {
    return displayDoubleTap(getStoredDoubleTap(), platform);
  }
  return displayHotkey(getStoredHotkey(), platform);
}

// Aplica a configuração ATUAL (mode + valor) no Rust. Chamar no boot e
// depois de qualquer mudança no modal. Garante que só o modo certo está
// ativo — o Rust desliga o outro automaticamente.
export async function applyHotkey(): Promise<string | null> {
  if (getHotkeyMode() === "double-tap") {
    return applyDoubleTapToRust(getStoredDoubleTap());
  }
  return applyHotkeyToRust(getStoredHotkey());
}

export async function applyDoubleTapToRust(
  modifier: DoubleTapModifier | null,
): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_capture_double_tap", { modifier });
    return null;
  } catch (err) {
    console.error("[hotkey] set_capture_double_tap falhou:", err);
    return err instanceof Error ? err.message : String(err);
  }
}
