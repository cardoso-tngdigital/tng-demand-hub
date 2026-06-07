import { supabase } from "./supabase/client";
import type { DemandInfrastructure, DemandPriority } from "../types/database";
import type {
  AttachmentTextPayload,
  InlineAttachment,
  StorageAttachment,
} from "./attachments";

export type Confianca = {
  cliente: number;
  responsavel: number;
  prioridade: number;
  prazo: number;
};

export type ExtractedDemand = {
  titulo: string;
  cliente: string | null;
  responsavel: string | null;
  prioridade: DemandPriority;
  prazo: string | null;
  descricao: string;
  tags: string[];
  infraestrutura: DemandInfrastructure | null;
  confianca: Confianca;
};

export type ExtractionUsage = {
  input_tokens: number;
  output_tokens: number;
  cost_micro: number;
  latency_ms: number;
};

export type ExtractionResult =
  | { ok: true; extracted: ExtractedDemand; usage: ExtractionUsage }
  | { ok: false; error: string; fallback: boolean };

/**
 * Chama a Edge Function `extract-demand` que aciona o Gemini 2.5 Flash.
 * Retorna os campos estruturados da demanda (com descricao já enriquecida
 * pelos blocos por anexo — RF-06b) ou um erro com fallback indicando que o
 * usuário pode preencher manualmente.
 */
export async function extractDemand(
  text: string,
  attachments: InlineAttachment[] = [],
  storageAttachments: StorageAttachment[] = [],
  attachmentTexts: AttachmentTextPayload[] = [],
): Promise<ExtractionResult> {
  try {
    const { data, error } = await supabase.functions.invoke<{
      extracted?: ExtractedDemand;
      usage?: ExtractionUsage;
      error?: string;
      fallback?: boolean;
    }>("extract-demand", {
      body: {
        text,
        attachments,
        // Mantém snake_case na fronteira por convenção com a Edge Function
        // (que segue Deno/Postgres). O client expõe camelCase.
        storage_attachments: storageAttachments.map((s) => ({
          id: s.id,
          file_name: s.fileName,
          mime_type: s.mimeType,
          storage_path: s.storagePath,
        })),
        attachment_texts: attachmentTexts.map((t) => ({
          id: t.id,
          file_name: t.fileName,
          mime_type: t.mimeType,
          content: t.content,
        })),
      },
    });

    if (error) {
      console.error("[ai] invoke error:", error);
      return { ok: false, error: error.message, fallback: true };
    }

    if (!data?.extracted || !data?.usage) {
      return {
        ok: false,
        error: data?.error ?? "Resposta inválida da IA",
        fallback: data?.fallback ?? true,
      };
    }

    return { ok: true, extracted: data.extracted, usage: data.usage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai] unexpected error:", msg);
    return { ok: false, error: msg, fallback: true };
  }
}
