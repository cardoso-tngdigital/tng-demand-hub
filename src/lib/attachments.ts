import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import imageCompression from "browser-image-compression";
import { supabase } from "./supabase/client";
import type { Attachment } from "../types/database";

// 50 MB — match exato do limite por arquivo do Supabase Storage no plano
// free. O bucket aceita 500MB, mas o teto global do projeto continua
// segurando em 50MB enquanto não migrarmos para o Pro. Vídeos do
// WhatsApp típicos (5-25MB) passam com folga; arquivos locais maiores
// precisam ser comprimidos pelo user antes de anexar.
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Tamanho cumulativo (bytes do arquivo original, antes do base64) dos anexos
// enviados como inlineData à Edge Function. Mantemos margem segura abaixo do
// limite de 12MB de base64 aceito pela função.
export const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024;

// Limite por arquivo individual para inline (base64 no body da chamada). Acima
// disso, vai pelo fluxo Storage → Files API do Gemini, mais lento mas que
// suporta arquivos grandes sem estourar o body da Edge Function.
export const INLINE_PER_FILE_BYTES = 4 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set<string>([
  // Imagens
  "image/png",
  "image/jpeg",
  "image/webp",
  // PDF
  "application/pdf",
  // Áudios (inclui formato do WhatsApp)
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  // Vídeos
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
  "video/3gpp",
  "video/x-msvideo",
  // Documentos
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const EXTENSION_FALLBACK: Record<string, string> = {
  ogg: "audio/ogg",
  m4a: "audio/x-m4a",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type AttachmentCategory = "image" | "audio" | "video" | "pdf" | "doc" | "sheet" | "text";

/** Categoria visual a partir do MIME, usada pra ícone e renderização. */
export function categorize(mime: string): AttachmentCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml")) return "doc";
  if (mime.includes("spreadsheetml") || mime === "text/csv") return "sheet";
  return "text";
}

/** Normaliza o MIME quando o navegador não preenche o `type` do File. */
export function resolveMime(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES.has(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  // `||` em vez de `??` — file.type pode vir como string vazia (clipboard),
  // e nesses casos queremos cair pro octet-stream em vez de devolver "".
  return EXTENSION_FALLBACK[ext] || file.type || "application/octet-stream";
}

export type ValidationResult = { ok: true; mime: string } | { ok: false; error: string };

export function validateFile(file: File): ValidationResult {
  if (file.size === 0) return { ok: false, error: "Arquivo vazio." };
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, error: `Arquivo passa de ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.` };
  }
  const mime = resolveMime(file);
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return { ok: false, error: `Tipo não suportado: ${mime || "desconhecido"}.` };
  }
  return { ok: true, mime };
}

/** Anexo selecionado mas ainda não enviado. Gera id antecipadamente para o path. */
export type PendingAttachment = {
  id: string;
  file: File;
  mime: string;
  category: AttachmentCategory;
  previewUrl: string | null;
  /**
   * Bytes do arquivo já lidos no momento da adição. Capturamos imediatamente
   * para evitar "The I/O read operation failed" que acontece quando o File
   * vem do clipboard / screenshot do macOS e a referência expira antes do
   * envio. Também evita um segundo I/O na hora de preparar o payload da IA.
   */
  bytes: Uint8Array;
};

/**
 * Lê um File como Uint8Array tentando duas estratégias: Blob.arrayBuffer()
 * primeiro (Promise-based, moderno) e FileReader.readAsArrayBuffer como
 * fallback. Alguns PDFs disparam "I/O read operation failed" no
 * arrayBuffer() do WKWebView no Tauri, mas funcionam no FileReader antigo.
 */
async function fileToBytes(file: File): Promise<Uint8Array> {
  console.log("[fileToBytes] iniciando para", file.name, "size:", file.size, "type:", file.type);
  try {
    const buf = await file.arrayBuffer();
    console.log("[fileToBytes] arrayBuffer() OK,", buf.byteLength, "bytes");
    return new Uint8Array(buf);
  } catch (primaryErr) {
    console.warn("[fileToBytes] arrayBuffer() falhou:", primaryErr, "— tentando FileReader");
    try {
      const result = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result;
          if (r instanceof ArrayBuffer) resolve(new Uint8Array(r));
          else reject(new Error("FileReader não retornou ArrayBuffer"));
        };
        reader.onerror = () =>
          reject(reader.error ?? new Error("FileReader falhou"));
        reader.readAsArrayBuffer(file);
      });
      console.log("[fileToBytes] FileReader OK,", result.byteLength, "bytes");
      return result;
    } catch (fallbackErr) {
      console.error("[fileToBytes] FileReader também falhou:", fallbackErr);
      const msg =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      const fmsg =
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(`${msg} (fallback FileReader: ${fmsg})`);
    }
  }
}

/**
 * Abre o file picker nativo do Tauri e lê os arquivos via Rust
 * (`read_file_bytes`), construindo File objects em memória. Esse caminho
 * contorna o bug "I/O read operation failed" do WKWebView com certos
 * PDFs vindos do `<input type="file">` HTML.
 *
 * Retorna `{ files, errors }`: arquivos lidos com sucesso + mensagens
 * de erro por caminho que falhou (pra surfar na UI).
 */
export async function pickFilesNative(): Promise<{ files: File[]; errors: string[] }> {
  console.log("[picker] abrindo dialog nativo");
  let selected: string | string[] | null;
  try {
    selected = await openDialog({
      multiple: true,
      title: "Selecione arquivos para anexar",
    });
  } catch (err) {
    console.error("[picker] dialog open falhou:", err);
    return { files: [], errors: [`Dialog falhou: ${err instanceof Error ? err.message : String(err)}`] };
  }
  console.log("[picker] dialog retornou:", selected);
  if (!selected) return { files: [], errors: [] };
  const paths = Array.isArray(selected) ? selected : [selected];
  return readPathsAsFiles(paths);
}

/**
 * Lê caminhos de arquivo do disco via comando Rust e constrói File objects
 * em memória. Usado tanto pelo dialog nativo (pickFilesNative) quanto pelo
 * drag-and-drop de arquivos do OS (Tauri emite paths absolutos via evento
 * `tauri://drag-drop` quando dragDropEnabled=true na janela).
 */
export async function readPathsAsFiles(
  paths: string[],
): Promise<{ files: File[]; errors: string[] }> {
  const files: File[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    try {
      const raw = await invoke<number[]>("read_file_bytes", { path });
      if (!raw || raw.length === 0) {
        errors.push(`${path}: leitura devolveu vazio`);
        continue;
      }
      const bytes = new Uint8Array(raw);
      const name = path.split(/[\\/]/).pop() || path;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const mime = EXTENSION_FALLBACK[ext] ?? "application/octet-stream";
      const file = new File([bytes], name, { type: mime });
      files.push(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[readPathsAsFiles] falhou para", path, ":", err);
      errors.push(`${path.split(/[\\/]/).pop() ?? path}: ${msg}`);
    }
  }
  return { files, errors };
}

// Imagens maiores que ~1MB são comprimidas localmente antes de virarem
// PendingAttachment. Mantemos qualidade visualmente boa (1920px de borda,
// ~80% de JPEG) — fica boa pra IA descrever e pra usuários reverem depois
// no drawer. Imagens menores passam sem alteração. Vídeo e PDF não são
// comprimidos aqui (FFmpeg/Ghostscript seriam muito pesados pro browser).
const IMAGE_COMPRESS_THRESHOLD_BYTES = 1 * 1024 * 1024;

async function maybeCompressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size < IMAGE_COMPRESS_THRESHOLD_BYTES) return file;
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      // Preserva o tipo MIME original sempre que possível — evita transformar
      // PNG em JPG e perder transparência sem aviso.
      fileType: file.type,
    });
    console.log(
      "[buildPendingAttachment] compressão:",
      file.name,
      `${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressed.size / 1024 / 1024).toFixed(2)}MB`,
    );
    return compressed;
  } catch (err) {
    // Se a compressão falhar, devolvemos o original — preferir tamanho a
    // perder o anexo.
    console.warn("[buildPendingAttachment] compressão falhou:", err);
    return file;
  }
}

export async function buildPendingAttachment(
  file: File,
): Promise<PendingAttachment | { error: string }> {
  console.log("[buildPendingAttachment]", file.name, file.type, file.size, "bytes");

  // Validação preliminar (MIME). Compressão pode reduzir tamanho, então
  // checamos o size depois. Aqui só rejeitamos tipos não suportados / 0B.
  const preCheck = validateFile(file);
  if (!preCheck.ok && preCheck.error.startsWith("Tipo")) {
    console.warn("[buildPendingAttachment] validação falhou:", preCheck.error);
    return { error: preCheck.error };
  }

  const compressed = await maybeCompressImage(file);

  const v = validateFile(compressed);
  if (!v.ok) {
    console.warn("[buildPendingAttachment] validação pós-compressão falhou:", v.error);
    return { error: v.error };
  }
  const category = categorize(v.mime);
  const previewUrl = category === "image" ? URL.createObjectURL(compressed) : null;
  try {
    const bytes = await fileToBytes(compressed);
    console.log("[buildPendingAttachment] OK", compressed.name, bytes.byteLength, "bytes prontos");
    return {
      id: crypto.randomUUID(),
      file: compressed,
      mime: v.mime,
      category,
      previewUrl,
      bytes,
    };
  } catch (err) {
    console.error("[buildPendingAttachment] erro lendo bytes:", err);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    return {
      error: `Falha ao ler o arquivo: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function disposePending(pa: PendingAttachment) {
  if (pa.previewUrl) URL.revokeObjectURL(pa.previewUrl);
}

function extensionFromFile(file: File, mime: string): string {
  const fromName = file.name.split(".").pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  for (const [ext, m] of Object.entries(EXTENSION_FALLBACK)) {
    if (m === mime) return ext;
  }
  return "bin";
}

export type UploadResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

/**
 * Faz upload do arquivo para o bucket `attachments` e cria o registro em
 * `public.attachments`. O caminho segue a convenção {demand_id}/{id}.{ext}.
 */
export async function uploadAttachment(
  pending: PendingAttachment,
  demandId: string,
  userId: string,
): Promise<UploadResult> {
  const ext = extensionFromFile(pending.file, pending.mime);
  const path = `${demandId}/${pending.id}.${ext}`;

  // Reusa os bytes já materializados (mesma razão do PendingAttachment.bytes),
  // empacotados como Blob para o cliente do Storage.
  const blob = new Blob([new Uint8Array(pending.bytes)], { type: pending.mime });
  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(path, blob, {
      contentType: pending.mime,
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, error: `Upload falhou: ${uploadError.message}` };
  }

  const { data, error: insertError } = await supabase
    .from("attachments")
    .insert({
      id: pending.id,
      demand_id: demandId,
      file_path: path,
      file_name: pending.file.name,
      file_type: pending.mime,
      file_size_bytes: pending.file.size,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (insertError) {
    // Best-effort cleanup do objeto órfão no Storage.
    await supabase.storage.from("attachments").remove([path]).catch(() => {});
    return { ok: false, error: `Registro falhou: ${insertError.message}` };
  }

  return { ok: true, attachment: data as Attachment };
}

/** Gera uma URL assinada (60 min por padrão) pra download/preview privado. */
export async function getSignedUrl(filePath: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUrl(filePath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Lista os anexos de uma demanda em ordem de upload. */
export async function listAttachments(
  demandId: string,
): Promise<{ data: Attachment[]; error: string | null }> {
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("demand_id", demandId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[attachments] list failed:", error);
    return { data: [], error: error.message };
  }
  return { data: (data as Attachment[]) ?? [], error: null };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Tipos enviados como inlineData à Edge Function de extração. */
export type InlineAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  base64: string;
};

/** Converte bytes em base64 em chunks pra não estourar a stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // 32 KB por iteração
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length);
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)));
  }
  return btoa(binary);
}

export async function pendingToInlinePayload(
  pending: PendingAttachment,
): Promise<InlineAttachment> {
  return {
    id: pending.id,
    fileName: pending.file.name,
    mimeType: pending.mime,
    base64: bytesToBase64(pending.bytes),
  };
}

// ---------------------------------------------------------------------------
// Arquivos grandes → Storage temporário → Files API do Gemini
// ---------------------------------------------------------------------------

/** Referência a um anexo já gravado no Storage temporário. */
export type StorageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
  fileSizeBytes: number;
};

/** Path do arquivo no bucket attachments durante a fase pré-confirmação. */
function tmpPath(
  userId: string,
  sessionId: string,
  attachmentId: string,
  ext: string,
): string {
  return `tmp/${userId}/${sessionId}/${attachmentId}.${ext}`;
}

/**
 * Sobe o arquivo materializado pra `tmp/{user}/{session}/{id}.{ext}` no
 * bucket attachments. O upload usa as policies já existentes (owner deve ser
 * auth.uid()). Devolve a referência usada pela Edge Function pra montar a
 * chamada da Files API.
 */
async function uploadPendingToTmp(
  pending: PendingAttachment,
  sessionId: string,
  userId: string,
): Promise<{ ok: true; payload: StorageAttachment } | { ok: false; error: string }> {
  const ext = extensionFromFile(pending.file, pending.mime);
  const path = tmpPath(userId, sessionId, pending.id, ext);
  const blob = new Blob([new Uint8Array(pending.bytes)], { type: pending.mime });
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, blob, { contentType: pending.mime, upsert: false });
  if (error) {
    return { ok: false, error: `Upload tmp falhou: ${error.message}` };
  }
  return {
    ok: true,
    payload: {
      id: pending.id,
      fileName: pending.file.name,
      mimeType: pending.mime,
      storagePath: path,
      fileSizeBytes: pending.file.size,
    },
  };
}

export type MaterializedAttachments = {
  inline: InlineAttachment[];
  storage: StorageAttachment[];
  texts: AttachmentTextPayload[];
  sessionId: string;
  errors: string[];
};

/**
 * Para cada anexo decide o caminho pra IA:
 *   - DOCX/XLSX/TXT/CSV → extrai texto local (Gemini não lê esses como
 *     inlineData) e devolve como `texts`. O conteúdo entra direto no prompt.
 *   - Mídia < 4MB (image/audio/video/pdf) → `inline` (base64).
 *   - Mídia ≥ 4MB → upload pro `tmp/` no Storage + Files API.
 * Em todos os casos o anexo continua existindo como arquivo (ainda será
 * vinculado à demanda no upload final).
 *
 * O `sessionId` agrupa os arquivos da mesma captura em `tmp/{user}/{session}/`.
 */
export async function materializeAttachmentsForExtraction(
  pendings: PendingAttachment[],
  userId: string,
): Promise<MaterializedAttachments> {
  const sessionId = crypto.randomUUID();
  const inline: InlineAttachment[] = [];
  const storage: StorageAttachment[] = [];
  const texts: AttachmentTextPayload[] = [];
  const errors: string[] = [];

  for (const p of pendings) {
    if (hasExtractableText(p.mime)) {
      const extracted = await extractTextFromPending(p);
      if (extracted) texts.push(extracted);
      else errors.push(`${p.file.name}: falha ao extrair texto`);
      continue;
    }
    if (p.file.size < INLINE_PER_FILE_BYTES) {
      inline.push(await pendingToInlinePayload(p));
    } else {
      const res = await uploadPendingToTmp(p, sessionId, userId);
      if (res.ok) {
        storage.push(res.payload);
      } else {
        errors.push(`${p.file.name}: ${res.error}`);
      }
    }
  }

  return { inline, storage, texts, sessionId, errors };
}

/**
 * Após confirmar a captura, move o arquivo de `tmp/...` para o path final
 * `{demand_id}/{attachment_id}.{ext}` e cria o registro em `attachments`.
 * O `storage.move()` do Supabase é atômico (rename no S3-compatível).
 */
export async function uploadAttachmentFromTmp(
  payload: StorageAttachment,
  demandId: string,
  userId: string,
): Promise<UploadResult> {
  const ext = payload.storagePath.split(".").pop() ?? "bin";
  const finalPath = `${demandId}/${payload.id}.${ext}`;

  const { error: moveError } = await supabase.storage
    .from("attachments")
    .move(payload.storagePath, finalPath);

  if (moveError) {
    return { ok: false, error: `Mover do tmp falhou: ${moveError.message}` };
  }

  const { data, error: insertError } = await supabase
    .from("attachments")
    .insert({
      id: payload.id,
      demand_id: demandId,
      file_path: finalPath,
      file_name: payload.fileName,
      file_type: payload.mimeType,
      file_size_bytes: payload.fileSizeBytes,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (insertError) {
    await supabase.storage.from("attachments").remove([finalPath]).catch(() => {});
    return { ok: false, error: `Registro falhou: ${insertError.message}` };
  }

  return { ok: true, attachment: data as Attachment };
}

// ---------------------------------------------------------------------------
// Extração local de texto (DOCX / XLSX / TXT / CSV)
// ---------------------------------------------------------------------------
// O Gemini não aceita docx/xlsx como inlineData. Pra esses tipos, extraímos
// o conteúdo textual no client, enviamos como `attachment_texts` à Edge
// Function e o prompt o injeta. O arquivo original ainda sobe pro Storage
// como anexo normal pra reabertura futura no drawer. Libs (mammoth, xlsx)
// só são carregadas sob demanda via dynamic import — economiza ~200KB no
// bundle inicial.

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type AttachmentTextPayload = {
  id: string;
  fileName: string;
  mimeType: string;
  content: string;
};

/** True se o tipo MIME é texto puro / docx / xlsx / csv. */
export function hasExtractableText(mime: string): boolean {
  return (
    mime === DOCX_MIME ||
    mime === XLSX_MIME ||
    mime === "text/plain" ||
    mime === "text/csv"
  );
}

async function extractTextFromDocx(bytes: Uint8Array): Promise<string> {
  const { default: mammoth } = await import("mammoth");
  const result = await mammoth.extractRawText({
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  return result.value;
}

async function extractTextFromXlsx(bytes: Uint8Array, fileName: string): Promise<string> {
  // Subpath /web-worker — entry "raiz" do read-excel-file não funciona no Vite
  // (package.json sem export "."). O browser ainda lê normalmente sem
  // precisar configurar worker; o nome do subpath é só convenção da lib.
  const { default: readXlsxFile } = await import("read-excel-file/web-worker");
  const blob = new Blob([new Uint8Array(bytes)], { type: XLSX_MIME });
  const sheets = await readXlsxFile(blob, { getSheets: true });
  const out: string[] = [];
  for (const s of sheets) {
    const rows = await readXlsxFile(blob, { sheet: s.name });
    out.push(`## Planilha "${s.name}" — ${fileName}\n`);
    for (const row of rows) {
      out.push(row.map((c) => (c === null ? "" : String(c))).join(" | "));
    }
    out.push("");
  }
  return out.join("\n");
}

/**
 * Pra anexos textuais (docx/xlsx/txt/csv), devolve o conteúdo extraído pra
 * ser incluído no prompt. Retorna null pros outros tipos.
 */
export async function extractTextFromPending(
  pending: PendingAttachment,
): Promise<AttachmentTextPayload | null> {
  try {
    if (pending.mime === DOCX_MIME) {
      const content = await extractTextFromDocx(pending.bytes);
      return wrap(pending, content);
    }
    if (pending.mime === XLSX_MIME) {
      const content = await extractTextFromXlsx(pending.bytes, pending.file.name);
      return wrap(pending, content);
    }
    if (pending.mime === "text/plain" || pending.mime === "text/csv") {
      const content = new TextDecoder("utf-8").decode(pending.bytes);
      return wrap(pending, content);
    }
    return null;
  } catch (err) {
    console.error(
      `[extractTextFromPending] ${pending.file.name}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function wrap(pending: PendingAttachment, content: string): AttachmentTextPayload {
  // Limita conteúdo bruto a ~40KB pra não explodir o tamanho do prompt
  // (alguns XLSX e CSV ficam enormes). 40KB ≈ 10K tokens.
  const trimmed = content.length > 40_000 ? content.slice(0, 40_000) + "\n…[conteúdo truncado]" : content;
  return {
    id: pending.id,
    fileName: pending.file.name,
    mimeType: pending.mime,
    content: trimmed,
  };
}

// Classes Font Awesome (kit no index.html). Consumer faz
// <i className={categoryIconClass(c)} aria-hidden="true" />.
export function categoryIconClass(c: AttachmentCategory): string {
  switch (c) {
    case "image": return "fa-solid fa-image";
    case "audio": return "fa-solid fa-music";
    case "video": return "fa-solid fa-video";
    case "pdf":   return "fa-solid fa-file-pdf";
    case "doc":   return "fa-solid fa-file-word";
    case "sheet": return "fa-solid fa-file-excel";
    case "text":  return "fa-solid fa-file-lines";
  }
}
