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

const STORAGE_KEY = "tng:hotkey:capture";
export const DEFAULT_HOTKEY = "CmdOrCtrl+Shift+D";

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
