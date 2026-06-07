import { beforeEach, describe, expect, it, vi } from "vitest";
import { markLocalChange, wasLocalChange } from "./notifications";

describe("markLocalChange / wasLocalChange", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("uma marca recente é detectada como local", () => {
    markLocalChange("demand-1");
    expect(wasLocalChange("demand-1")).toBe(true);
  });

  it("demand não marcada não é local", () => {
    expect(wasLocalChange("nope")).toBe(false);
  });

  it("marca expira após o TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T12:00:00Z"));
    markLocalChange("demand-old");
    expect(wasLocalChange("demand-old")).toBe(true);
    // TTL é 3000ms (LOCAL_CHANGE_TTL_MS); avança 5s pra garantir expirar.
    vi.setSystemTime(new Date("2026-06-06T12:00:05Z"));
    expect(wasLocalChange("demand-old")).toBe(false);
  });

  it("consultar não consome a marca enquanto fresca", () => {
    markLocalChange("demand-2");
    expect(wasLocalChange("demand-2")).toBe(true);
    expect(wasLocalChange("demand-2")).toBe(true);
  });
});
