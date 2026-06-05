import { supabase } from "./supabase/client";
import type { Attachment } from "../types/database";

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// Tamanho cumulativo (bytes do arquivo original, antes do base64) dos anexos
// enviados como inlineData à Edge Function. Mantemos margem segura abaixo do
// limite de 12MB de base64 aceito pela função.
export const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024;

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
};

export function buildPendingAttachment(file: File): PendingAttachment | { error: string } {
  const v = validateFile(file);
  if (!v.ok) return { error: v.error };
  const category = categorize(v.mime);
  const previewUrl = category === "image" ? URL.createObjectURL(file) : null;
  return {
    id: crypto.randomUUID(),
    file,
    mime: v.mime,
    category,
    previewUrl,
  };
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

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(path, pending.file, {
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

/** Converte um File em base64 puro (sem o prefixo data:URI). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export async function pendingToInlinePayload(
  pending: PendingAttachment,
): Promise<InlineAttachment> {
  return {
    id: pending.id,
    fileName: pending.file.name,
    mimeType: pending.mime,
    base64: await fileToBase64(pending.file),
  };
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
