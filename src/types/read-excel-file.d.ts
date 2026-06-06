// Shim mínimo de tipos pros subpaths do read-excel-file. O entry "." do
// pacote não está exposto via package.json#exports, então importamos via
// subpath específico.
declare module "read-excel-file/web-worker" {
  type Cell = string | number | boolean | Date | null;
  type Row = Cell[];
  interface SheetInfo {
    name: string;
  }
  interface ReadOptions {
    sheet?: number | string;
    getSheets?: boolean;
  }
  function readXlsxFile(
    blob: Blob,
    opts: { getSheets: true },
  ): Promise<SheetInfo[]>;
  function readXlsxFile(blob: Blob, opts?: ReadOptions): Promise<Row[]>;
  export default readXlsxFile;
}
