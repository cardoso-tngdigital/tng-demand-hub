// =============================================================================
// Renderização de arquivos office (DOCX/XLSX/TXT/CSV) na PreviewScreen.
// =============================================================================
// Reaproveita as mesmas libs do pipeline de extração de texto pra IA
// (`mammoth`, `read-excel-file/web-worker`) mas chama os métodos que
// produzem HTML / arrays de planilhas pra renderização visual — não só
// raw text. Carregadas via dynamic import porque só fazem sentido aqui.
// =============================================================================

import DOMPurify from "isomorphic-dompurify";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function fetchAsBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** DOCX → HTML sanitizado. Mantém negrito, itálico, listas, headings, links. */
export async function renderDocxAsHtml(url: string): Promise<string> {
  const bytes = await fetchAsBytes(url);
  const { default: mammoth } = await import("mammoth");
  const result = await mammoth.convertToHtml({
    arrayBuffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  });
  return DOMPurify.sanitize(result.value);
}

export type XlsxSheet = { name: string; rows: (string | number | null)[][] };

/**
 * Converte uma célula crua do read-excel-file pro tipo que o `SheetTable`
 * espera. A lib pode devolver `string | number | boolean | Date | null`, e
 * em alguns casos vêm objetos (quando há schema ou anomalia de parsing).
 */
function normalizeCell(c: unknown): string | number | null {
  if (c === null || c === undefined) return null;
  if (typeof c === "string" || typeof c === "number") return c;
  if (typeof c === "boolean") return c ? "VERDADEIRO" : "FALSO";
  if (c instanceof Date) {
    // Data sem hora vira YYYY-MM-DD; com hora vira ISO local truncado.
    const iso = c.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  if (typeof c === "object") {
    // Algumas versões da lib devolvem { value, type, ... } por célula.
    const obj = c as { value?: unknown };
    if ("value" in obj) return normalizeCell(obj.value);
    try {
      return JSON.stringify(c);
    } catch {
      return String(c);
    }
  }
  return String(c);
}

function normalizeRow(row: unknown): (string | number | null)[] {
  if (Array.isArray(row)) return row.map(normalizeCell);
  if (row && typeof row === "object") {
    // Algumas versões devolvem linhas como `Record<colName, value>` —
    // pegamos os valores em ordem de declaração das keys.
    return Object.values(row as Record<string, unknown>).map(normalizeCell);
  }
  return [normalizeCell(row)];
}

/** XLSX → array de planilhas com linhas. Cada `row` é uma array de células. */
export async function renderXlsxAsSheets(url: string): Promise<XlsxSheet[]> {
  const bytes = await fetchAsBytes(url);
  const { default: readXlsxFile } = await import(
    "read-excel-file/web-worker"
  );
  const blob = new Blob([new Uint8Array(bytes)], { type: XLSX_MIME });
  // read-excel-file v9: o default export devolve `Sheet[]` direto, no
  // formato `{ sheet: string, data: Row[] }[]`. Versões antigas tinham
  // `getSheets: true` + leituras por aba, mas a API foi reescrita.
  const raw = (await readXlsxFile(blob)) as unknown;
  const sheetArr = Array.isArray(raw) ? raw : [];
  return sheetArr.map((s, i) => {
    const obj = s as { sheet?: unknown; data?: unknown };
    const name =
      typeof obj.sheet === "string" && obj.sheet.length > 0
        ? obj.sheet
        : `Planilha ${i + 1}`;
    const dataArr = Array.isArray(obj.data) ? obj.data : [];
    return { name, rows: dataArr.map(normalizeRow) };
  });
}

/** TXT/CSV → string decodificada em UTF-8. */
export async function renderTextFile(url: string): Promise<string> {
  const bytes = await fetchAsBytes(url);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Parseia uma string CSV em linhas. Simples — usa quebra de linha e vírgula,
 * trata aspas duplas para escapar vírgulas dentro de células. Não cobre todos
 * os edge cases do RFC 4180 mas dá conta de CSVs gerados por planilhas e
 * exports comuns.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      // Engole \r\n como uma quebra só
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  // Última célula pendente (arquivo sem newline no fim)
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function isDocx(mime: string): boolean {
  return mime === DOCX_MIME;
}
export function isXlsx(mime: string): boolean {
  return mime === XLSX_MIME;
}
export function isCsv(mime: string): boolean {
  return mime === "text/csv";
}
export function isPlainText(mime: string): boolean {
  return mime === "text/plain";
}
