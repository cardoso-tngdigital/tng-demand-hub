import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  categorize,
  formatBytes,
  hasExtractableText,
  resolveMime,
  validateFile,
} from "./attachments";

function makeFile(name: string, size: number, type: string): File {
  // Pra controlar tamanho sem alocar megabytes, sobrescrevemos a propriedade.
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("categorize", () => {
  it.each([
    ["image/png", "image"],
    ["image/jpeg", "image"],
    ["audio/ogg", "audio"],
    ["video/mp4", "video"],
    ["application/pdf", "pdf"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "doc",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "sheet",
    ],
    ["text/csv", "sheet"],
    ["text/plain", "text"],
  ])("MIME %s vira categoria %s", (mime, expected) => {
    expect(categorize(mime)).toBe(expected);
  });
});

describe("resolveMime", () => {
  it("prefere file.type quando válido", () => {
    const f = makeFile("foo.png", 100, "image/png");
    expect(resolveMime(f)).toBe("image/png");
  });

  it("cai pra extensão quando type é vazio", () => {
    const f = makeFile("clip.mov", 100, "");
    expect(resolveMime(f)).toBe("video/quicktime");
  });

  it("m4v é mapeado pra video/mp4 (Gemini não aceita x-m4v)", () => {
    const f = makeFile("clip.M4V", 100, "");
    expect(resolveMime(f)).toBe("video/mp4");
  });

  it("desconhecido vira octet-stream", () => {
    const f = makeFile("strange.xyz", 100, "");
    expect(resolveMime(f)).toBe("application/octet-stream");
  });
});

describe("validateFile", () => {
  it("rejeita arquivo de 0 byte", () => {
    const f = makeFile("vazio.png", 0, "image/png");
    expect(validateFile(f)).toEqual({ ok: false, error: "Arquivo vazio." });
  });

  it("rejeita arquivo maior que 50MB", () => {
    const f = makeFile("grande.mp4", 60 * 1024 * 1024, "video/mp4");
    const res = validateFile(f);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/50 MB/);
  });

  it("rejeita tipo não suportado", () => {
    const f = makeFile("malware.exe", 100, "application/x-msdownload");
    const res = validateFile(f);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Tipo não suportado/);
  });

  it("aceita imagem dentro do limite", () => {
    const f = makeFile("ok.png", 1000, "image/png");
    expect(validateFile(f)).toEqual({ ok: true, mime: "image/png" });
  });
});

describe("formatBytes", () => {
  it("bytes pequenos em B", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("milhares em KB", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("milhões em MB", () => {
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("bytesToBase64", () => {
  it("converte bytes ASCII em base64", () => {
    const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
    expect(bytesToBase64(bytes)).toBe("aGVsbG8=");
  });

  it("array vazio devolve string vazia", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
  });
});

describe("hasExtractableText", () => {
  it("docx e xlsx são extraíveis", () => {
    expect(
      hasExtractableText(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(
      hasExtractableText(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
  });

  it("txt e csv são extraíveis", () => {
    expect(hasExtractableText("text/plain")).toBe(true);
    expect(hasExtractableText("text/csv")).toBe(true);
  });

  it("imagem não é extraível", () => {
    expect(hasExtractableText("image/png")).toBe(false);
  });
});
