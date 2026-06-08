// =============================================================================
// Atalho global de captura — dupla pressão de tecla modificadora
// =============================================================================
// O Rust (rdev) escuta o teclado globalmente e dispara a janela de captura
// quando o usuário pressiona o modificador alvo duas vezes em < 400ms. Esse
// módulo expõe:
//   - leitura/escrita da preferência (localStorage, por máquina)
//   - apply na camada Rust via invoke
//   - helpers de display (⌃⌃ no Mac, "Ctrl + Ctrl" no Win/Linux)
//   - check de permissão Accessibility (macOS) — sem ela, o hook não recebe
//
// A preferência é por máquina (não sincroniza entre laptops do mesmo user)
// porque atalhos costumam refletir o teclado físico/sistema operacional.
// =============================================================================

export type HotkeyModifier = "ctrl" | "alt" | "shift" | "cmd";
export type Platform = "macos" | "windows" | "linux";

export const ALL_MODIFIERS: HotkeyModifier[] = ["ctrl", "alt", "shift", "cmd"];

const STORAGE_KEY = "tng:hotkey:capture";

export function getPlatform(): Platform {
  if (typeof navigator !== "undefined") {
    const p = navigator.platform || "";
    if (/Mac|iPod|iPhone|iPad/.test(p)) return "macos";
    if (/Win/.test(p)) return "windows";
  }
  return "linux";
}

export function getDefaultHotkey(platform: Platform = getPlatform()): HotkeyModifier {
  // Mac: Control é a opção mais ergonômica (Option/Cmd colidem com atalhos
  // do sistema com frequência). Win/Linux: Alt — equivalente em ergonomia
  // e raramente usado isolado.
  return platform === "macos" ? "ctrl" : "alt";
}

export function getStoredHotkey(): HotkeyModifier {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isHotkeyModifier(v)) return v;
  } catch {
    // localStorage indisponível (private mode?) — usa default
  }
  return getDefaultHotkey();
}

export function setStoredHotkey(mod: HotkeyModifier): void {
  try {
    localStorage.setItem(STORAGE_KEY, mod);
  } catch (err) {
    console.error("[hotkey] setStoredHotkey falhou:", err);
  }
}

export function isHotkeyModifier(v: unknown): v is HotkeyModifier {
  return v === "ctrl" || v === "alt" || v === "shift" || v === "cmd";
}

// Display compacto pro header e dicas (⌃⌃ no Mac, "Ctrl + Ctrl" no resto)
export function displayHotkey(
  mod: HotkeyModifier,
  platform: Platform = getPlatform(),
): string {
  if (platform === "macos") {
    const sym: Record<HotkeyModifier, string> = {
      ctrl: "⌃",
      alt: "⌥",
      shift: "⇧",
      cmd: "⌘",
    };
    return `${sym[mod]}${sym[mod]}`;
  }
  const name = modifierLabel(mod, platform);
  return `${name} + ${name}`;
}

// Nome longo do modificador, próprio da plataforma.
export function modifierLabel(
  mod: HotkeyModifier,
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

// Aplica o atalho no Rust. Idempotente — chamar várias vezes é seguro.
// Retorna mensagem de erro quando falha (pra UI mostrar).
export async function applyHotkeyToRust(mod: HotkeyModifier): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_capture_hotkey", { modifier: mod });
    return null;
  } catch (err) {
    console.error("[hotkey] set_capture_hotkey falhou:", err);
    return err instanceof Error ? err.message : String(err);
  }
}

// Checa permissão de Accessibility (macOS). prompt=true mostra o popup do
// sistema pedindo permissão na primeira vez. Em Win/Linux retorna true.
export async function checkAccessibilityPermission(prompt: boolean): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("check_accessibility_permission", { prompt });
  } catch (err) {
    console.error("[hotkey] check_accessibility_permission falhou:", err);
    return false;
  }
}
