import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HOTKEY,
  acceleratorFromEvent,
  displayHotkey,
  getDefaultHotkey,
  getStoredHotkey,
  isValidAccelerator,
  setStoredHotkey,
} from "./hotkey";

describe("isValidAccelerator", () => {
  it("aceita combinações comuns", () => {
    expect(isValidAccelerator("CmdOrCtrl+Shift+D")).toBe(true);
    expect(isValidAccelerator("Cmd+Shift+Space")).toBe(true);
    expect(isValidAccelerator("Alt+F1")).toBe(true);
    expect(isValidAccelerator("Ctrl+Shift+ArrowUp")).toBe(true);
  });
  it("rejeita sem modificador", () => {
    expect(isValidAccelerator("D")).toBe(false);
    expect(isValidAccelerator("Space")).toBe(false);
  });
  it("rejeita só modificador", () => {
    expect(isValidAccelerator("Cmd+Shift")).toBe(false);
    expect(isValidAccelerator("Alt+Cmd")).toBe(false);
  });
  it("rejeita string vazia ou não-string", () => {
    expect(isValidAccelerator("")).toBe(false);
    expect(isValidAccelerator("+")).toBe(false);
  });
});

describe("displayHotkey", () => {
  it("macOS usa símbolos sem espaço", () => {
    expect(displayHotkey("CmdOrCtrl+Shift+D", "macos")).toBe("⌘⇧D");
    expect(displayHotkey("Alt+Space", "macos")).toBe("⌥␣");
    expect(displayHotkey("Cmd+Shift+ArrowUp", "macos")).toBe("⌘⇧↑");
  });
  it("Windows usa nomes com '+'", () => {
    expect(displayHotkey("CmdOrCtrl+Shift+D", "windows")).toBe("Ctrl + Shift + D");
    expect(displayHotkey("Alt+F12", "windows")).toBe("Alt + F12");
  });
  it("Linux traduz CmdOrCtrl para Ctrl (e Super para Win)", () => {
    expect(displayHotkey("CmdOrCtrl+Shift+D", "linux")).toBe("Ctrl + Shift + D");
    expect(displayHotkey("Super+Space", "linux")).toBe("Win + Space");
  });
});

describe("acceleratorFromEvent", () => {
  it("monta CmdOrCtrl+Shift+D a partir do KeyboardEvent", () => {
    const e = new KeyboardEvent("keydown", {
      code: "KeyD",
      metaKey: true,
      shiftKey: true,
    });
    expect(acceleratorFromEvent(e)).toBe("CmdOrCtrl+Shift+D");
  });
  it("Ctrl no Windows entra como CmdOrCtrl", () => {
    const e = new KeyboardEvent("keydown", {
      code: "KeyD",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(acceleratorFromEvent(e)).toBe("CmdOrCtrl+Shift+D");
  });
  it("retorna null se a tecla principal ainda é modificador", () => {
    const e = new KeyboardEvent("keydown", {
      code: "ShiftLeft",
      shiftKey: true,
    });
    expect(acceleratorFromEvent(e)).toBeNull();
  });
  it("retorna null sem nenhum modificador", () => {
    const e = new KeyboardEvent("keydown", { code: "KeyD" });
    expect(acceleratorFromEvent(e)).toBeNull();
  });
  it("aceita F1, ArrowUp, Space e dígitos", () => {
    expect(
      acceleratorFromEvent(
        new KeyboardEvent("keydown", { code: "F1", metaKey: true }),
      ),
    ).toBe("CmdOrCtrl+F1");
    expect(
      acceleratorFromEvent(
        new KeyboardEvent("keydown", { code: "Space", altKey: true }),
      ),
    ).toBe("Alt+Space");
    expect(
      acceleratorFromEvent(
        new KeyboardEvent("keydown", {
          code: "Digit1",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe("CmdOrCtrl+Shift+1");
  });
});

describe("getDefaultHotkey", () => {
  it("é Cmd+Shift+D (multiplataforma via CmdOrCtrl)", () => {
    expect(getDefaultHotkey()).toBe(DEFAULT_HOTKEY);
    expect(DEFAULT_HOTKEY).toBe("CmdOrCtrl+Shift+D");
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
    expect(getStoredHotkey()).toBe(DEFAULT_HOTKEY);
  });

  it("setStoredHotkey persiste e getStoredHotkey lê de volta", () => {
    setStoredHotkey("Alt+Space");
    expect(getStoredHotkey()).toBe("Alt+Space");
  });

  it("ignora valores inválidos no storage", () => {
    localStorage.setItem("tng:hotkey:capture", "bogus_no_plus");
    expect(getStoredHotkey()).toBe(DEFAULT_HOTKEY);
  });
});
