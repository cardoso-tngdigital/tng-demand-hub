import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { supabase } from "./supabase/client";
import type { Attachment } from "../types/database";

// 200 MB. Antes era 50, mas com a Files API do Gemini agora aceitamos vídeos
// reais (WhatsApp Forward, capturas de tela longa, etc.). Acima desse limite
// o uso prático é raro o suficiente pra exigir conversa.
export const MAX_FILE_SIZE = 200 * 1024 * 1024;

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
  "video/quicktime",
  "video/webm",
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
  webm: "video/webm",
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
  return EXTENSION_FALLBACK[ext] ?? file.type ?? "application/octet-stream";
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
  const files: File[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    console.log("[picker] lendo via Rust:", path);
    try {
      const raw = await invoke<number[]>("read_file_bytes", { path });
      console.log("[picker] read_file_bytes devolveu", raw?.length ?? "null", "bytes para", path);
      if (!raw || raw.length === 0) {
        errors.push(`${path}: leitura devolveu vazio`);
        continue;
      }
      const bytes = new Uint8Array(raw);
      const name = path.split(/[\\/]/).pop() || path;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const mime = EXTENSION_FALLBACK[ext] ?? "application/octet-stream";
      const file = new File([bytes], name, { type: mime });
      console.log("[picker] File criado:", { name, size: file.size, type: mime });
      files.push(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[picker] read_file_bytes falhou para", path, ":", err);
      errors.push(`${path.split(/[\\/]/).pop() ?? path}: ${msg}`);
    }
  }
  console.log("[picker] resultado final:", { ok: files.length, err: errors.length });
  return { files, errors };
}

export async function buildPendingAttachment(
  file: File,
): Promise<PendingAttachment | { error: string }> {
  console.log("[buildPendingAttachment]", file.name, file.type, file.size, "bytes");
  const v = validateFile(file);
  if (!v.ok) {
    console.warn("[buildPendingAttachment] validação falhou:", v.error);
    return { error: v.error };
  }
  const category = categorize(v.mime);
  const previewUrl = category === "image" ? URL.createObjectURL(file) : null;
  try {
    const bytes = await fileToBytes(file);
    console.log("[buildPendingAttachment] OK", file.name, bytes.byteLength, "bytes prontos");
    return {
      id: crypto.randomUUID(),
      file,
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
  sessionId: string;
  errors: string[];
};

/**
 * Decide, anexo a anexo, se vai como inlineData (rápido, < 4MB) ou pelo fluxo
 * Storage + Files API (mais lento, mas suporta vídeos de WhatsApp). Sobe os
 * grandes antes de retornar; os pequenos vão materializados como base64.
 *
 * O `sessionId` agrupa os anexos da mesma captura em `tmp/{user}/{session}/`
 * pra facilitar cleanup futuro.
 */
export async function materializeAttachmentsForExtraction(
  pendings: PendingAttachment[],
  userId: string,
): Promise<MaterializedAttachments> {
  const sessionId = crypto.randomUUID();
  const inline: InlineAttachment[] = [];
  const storage: StorageAttachment[] = [];
  const errors: string[] = [];

  for (const p of pendings) {
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

  return { inline, storage, sessionId, errors };
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

export function categoryIcon(c: AttachmentCategory): string {
  switch (c) {
    case "image": return "🖼️";
    case "audio": return "🎵";
    case "video": return "🎬";
    case "pdf":   return "📄";
    case "doc":   return "📄";
    case "sheet": return "📊";
    case "text":  return "📝";
  }
}
