// Smoke test — só pra garantir que o runner está vivo.
import { describe, expect, it } from "vitest";

describe("vitest smoke", () => {
  it("soma corretamente", () => {
    expect(1 + 1).toBe(2);
  });
});
