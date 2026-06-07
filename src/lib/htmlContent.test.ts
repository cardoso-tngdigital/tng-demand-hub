import { describe, expect, it } from "vitest";
import {
  htmlToPlainText,
  isHtmlEmpty,
  legacyToHtml,
  sanitizeHtml,
} from "./htmlContent";

describe("sanitizeHtml", () => {
  it("preserva tags de formatação que o editor produz", () => {
    const input = "<p><strong>oi</strong> <em>tudo</em> bem</p>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("permite link com target e rel", () => {
    const out = sanitizeHtml(
      '<p><a href="https://tng.com" target="_blank" rel="noopener">link</a></p>',
    );
    expect(out).toContain('href="https://tng.com"');
    expect(out).toContain('target="_blank"');
  });

  it("remove scripts e atributos perigosos", () => {
    const out = sanitizeHtml('<p onclick="alert(1)">x</p><script>alert(2)</script>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("<script");
  });

  it("remove iframe", () => {
    const out = sanitizeHtml('<p>ok</p><iframe src="x"></iframe>');
    expect(out).not.toContain("iframe");
  });
});

describe("legacyToHtml", () => {
  it("devolve string vazia para entrada falsy", () => {
    expect(legacyToHtml("")).toBe("");
  });

  it("HTML já formatado passa sanitizado e retorna idêntico", () => {
    const input = "<p>já <strong>HTML</strong></p>";
    expect(legacyToHtml(input)).toBe(input);
  });

  it("converte markdown bold em <strong>", () => {
    const out = legacyToHtml("Texto **importante** aqui");
    expect(out).toContain("<strong>importante</strong>");
  });

  it("converte link markdown", () => {
    const out = legacyToHtml("veja em [tng](https://tng.com)");
    expect(out).toContain('href="https://tng.com"');
    expect(out).toContain(">tng</a>");
  });

  it("texto puro com quebras de linha simples vira <p> com <br>", () => {
    const out = legacyToHtml("linha 1\nlinha 2");
    expect(out).toBe("<p>linha 1<br>linha 2</p>");
  });

  it("texto puro com dois saltos de linha vira dois <p>", () => {
    const out = legacyToHtml("paragrafo 1\n\nparagrafo 2");
    expect(out).toContain("<p>paragrafo 1</p>");
    expect(out).toContain("<p>paragrafo 2</p>");
  });

  it("escapa caracteres especiais quando vira HTML", () => {
    const out = legacyToHtml("3 < 5 & 7 > 6");
    expect(out).toContain("&lt;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&gt;");
  });
});

describe("htmlToPlainText", () => {
  it("strip de tags simples", () => {
    expect(htmlToPlainText("<p>oi <strong>tudo</strong></p>")).toBe("oi tudo");
  });

  it("entidades nomeadas viram o caractere", () => {
    expect(htmlToPlainText("<p>a &amp; b</p>")).toBe("a & b");
  });

  it("blocos viram espaço pra evitar palavras grudadas", () => {
    expect(htmlToPlainText("<p>fim</p><p>começo</p>")).toBe("fim começo");
  });

  it("br vira espaço também", () => {
    expect(htmlToPlainText("linha1<br>linha2")).toBe("linha1 linha2");
  });

  it("trim e colapsa espaços múltiplos", () => {
    expect(htmlToPlainText("  <p>  a   b  </p>  ")).toBe("a b");
  });

  it("entrada falsy devolve string vazia", () => {
    expect(htmlToPlainText("")).toBe("");
  });
});

describe("isHtmlEmpty", () => {
  it("string vazia é vazio", () => {
    expect(isHtmlEmpty("")).toBe(true);
  });

  it("parágrafo vazio é vazio", () => {
    expect(isHtmlEmpty("<p></p>")).toBe(true);
  });

  it("parágrafo com só whitespace e br é vazio", () => {
    expect(isHtmlEmpty("<p>  <br></p>")).toBe(true);
  });

  it("parágrafo com texto não é vazio", () => {
    expect(isHtmlEmpty("<p>conteúdo</p>")).toBe(false);
  });

  it("nbsp puro é vazio", () => {
    expect(isHtmlEmpty("<p>&nbsp;</p>")).toBe(true);
  });
});
