import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALL_MODIFIERS,
  displayHotkey,
  getDefaultHotkey,
  getStoredHotkey,
  isHotkeyModifier,
  modifierLabel,
  setStoredHotkey,
} from "./hotkey";

describe("isHotkeyModifier", () => {
  it("aceita os 4 modificadores suportados", () => {
    for (const m of ALL_MODIFIERS) {
      expect(isHotkeyModifier(m)).toBe(true);
    }
  });
  it("rejeita qualquer outra string ou valor", () => {
    expect(isHotkeyModifier("super")).toBe(false);
    expect(isHotkeyModifier("CTRL")).toBe(false); // case-sensitive
    expect(isHotkeyModifier(null)).toBe(false);
    expect(isHotkeyModifier(undefined)).toBe(false);
    expect(isHotkeyModifier(42)).toBe(false);
  });
});

describe("getDefaultHotkey", () => {
  it("default no macOS é ctrl", () => {
    expect(getDefaultHotkey("macos")).toBe("ctrl");
  });
  it("default em Windows e Linux é alt", () => {
    expect(getDefaultHotkey("windows")).toBe("alt");
    expect(getDefaultHotkey("linux")).toBe("alt");
  });
});

describe("displayHotkey", () => {
  it("macOS usa símbolos repetidos sem espaço", () => {
    expect(displayHotkey("ctrl", "macos")).toBe("⌃⌃");
    expect(displayHotkey("alt", "macos")).toBe("⌥⌥");
    expect(displayHotkey("shift", "macos")).toBe("⇧⇧");
    expect(displayHotkey("cmd", "macos")).toBe("⌘⌘");
  });
  it("Windows usa nome com '+'", () => {
    expect(displayHotkey("ctrl", "windows")).toBe("Ctrl + Ctrl");
    expect(displayHotkey("alt", "windows")).toBe("Alt + Alt");
    expect(displayHotkey("cmd", "windows")).toBe("Win + Win");
  });
  it("Linux usa Super para cmd", () => {
    expect(displayHotkey("cmd", "linux")).toBe("Super + Super");
  });
});

describe("modifierLabel", () => {
  it("macOS mostra nomes longos clássicos", () => {
    expect(modifierLabel("ctrl", "macos")).toBe("Control");
    expect(modifierLabel("alt", "macos")).toBe("Option");
    expect(modifierLabel("cmd", "macos")).toBe("Command");
  });
  it("Windows mostra Win em vez de Cmd", () => {
    expect(modifierLabel("cmd", "windows")).toBe("Win");
  });
});

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("getStoredHotkey devolve default quando nada salvo", () => {
    expect(ALL_MODIFIERS).toContain(getStoredHotkey());
  });

  it("setStoredHotkey persiste e getStoredHotkey lê de volta", () => {
    setStoredHotkey("shift");
    expect(getStoredHotkey()).toBe("shift");
  });

  it("ignora valores inválidos no storage", () => {
    localStorage.setItem("tng:hotkey:capture", "bogus");
    // Como o valor é inválido, deve cair pro default da plataforma
    expect(ALL_MODIFIERS).toContain(getStoredHotkey());
    expect(getStoredHotkey()).not.toBe("bogus" as never);
  });
});
