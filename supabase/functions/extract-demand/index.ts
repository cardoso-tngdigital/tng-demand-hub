// =============================================================================
// Edge Function: extract-demand
// =============================================================================
// Recebe um texto de captura, monta o contexto da empresa (clientes ativos +
// membros da equipe), chama o Gemini 2.0 Flash e devolve um JSON estruturado
// com cliente, responsável, prioridade, prazo, descrição, tags e confiança.
//
// Cada chamada é registrada em ai_usage_log para controle de custo.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Preço aproximado em micro-dólares por token (1 micro = US$ 0.000001)
// Gemini 2.0 Flash: ~$0.10 / 1M input tokens, ~$0.40 / 1M output tokens
const INPUT_COST_PER_TOKEN_MICRO = 0.1; // micro dólares
const OUTPUT_COST_PER_TOKEN_MICRO = 0.4;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Limite cumulativo (em bytes do payload base64) dos anexos inline.
// O Supabase Edge Functions tolera bem além disso, mas mantemos margem
// segura para latência do Gemini multimodal.
const MAX_ATTACHMENTS_TOTAL_B64_BYTES = 12 * 1024 * 1024;

type AttachmentPayload = {
  id: string;
  fileName: string;
  mimeType: string;
  base64: string;
};

type ExtractRequest = {
  text: string;
  attachments?: AttachmentPayload[];
};

type Confianca = {
  cliente: number;
  responsavel: number;
  prioridade: number;
  prazo: number;
};

type ExtractedDemand = {
  cliente: string | null;
  responsavel: string | null;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  prazo: string | null;
  descricao: string;
  tags: string[];
  confianca: Confianca;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Método não suportado" }, 405);
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  if (!geminiKey) {
    return json({ error: "GEMINI_API_KEY não configurada na Edge Function" }, 500);
  }

  // -----------------------------------------------------------------------
  // 1. Autenticação do usuário
  // -----------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Faltando token de autenticação" }, 401);

  const supabaseAuth = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseAuth.auth.getUser();

  if (userError || !user) {
    return json({ error: "Token inválido" }, 401);
  }

  // -----------------------------------------------------------------------
  // 2. Validação do body
  // -----------------------------------------------------------------------
  let body: ExtractRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const text = (body.text ?? "").trim();
  if (!text) return json({ error: "Texto vazio" }, 400);
  if (text.length > 4000) return json({ error: "Texto excede 4000 caracteres" }, 400);

  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  let attachmentsBytes = 0;
  for (const a of attachments) {
    if (typeof a.base64 !== "string" || typeof a.mimeType !== "string" || typeof a.fileName !== "string") {
      return json({ error: "Anexo com campos faltando" }, 400);
    }
    attachmentsBytes += a.base64.length;
  }
  if (attachmentsBytes > MAX_ATTACHMENTS_TOTAL_B64_BYTES) {
    return json(
      { error: `Anexos excedem o limite de ${Math.round(MAX_ATTACHMENTS_TOTAL_B64_BYTES / 1024 / 1024)} MB processáveis pela IA.` },
      413,
    );
  }

  // -----------------------------------------------------------------------
  // 3. Monta contexto da empresa
  // -----------------------------------------------------------------------
  const supabase = createClient(supabaseUrl, serviceKey);
  const [{ data: clients }, { data: members }] = await Promise.all([
    supabase
      .from("clients")
      .select("name, alias")
      .eq("status", "active")
      .order("name"),
    supabase
      .from("profiles")
      .select("full_name, area")
      .eq("active", true)
      .order("full_name"),
  ]);

  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);
  const weekday = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][
    today.getDay()
  ];

  const clientsList =
    clients
      ?.map((c) => `- ${c.name}${c.alias ? ` (alias: ${c.alias})` : ""}`)
      .join("\n") ?? "(sem clientes cadastrados)";
  const membersList =
    members
      ?.map((m) => `- ${m.full_name}${m.area ? ` (${m.area})` : ""}`)
      .join("\n") ?? "(sem membros cadastrados)";

  const prompt = buildPrompt({
    text,
    clientsList,
    membersList,
    isoDate,
    weekday,
    attachments,
  });

  // Cada anexo entra como uma parte inlineData logo após o prompt; a ordem
  // do array é preservada e a lista enumerada no prompt usa esses mesmos índices.
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const a of attachments) {
    parts.push({
      inlineData: {
        mimeType: a.mimeType,
        data: a.base64,
      },
    });
  }

  // -----------------------------------------------------------------------
  // 4. Chama Gemini
  // -----------------------------------------------------------------------
  let extracted: ExtractedDemand | null = null;
  let geminiError: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
    }

    const payload = await res.json();
    inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;

    const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("Resposta do Gemini sem conteúdo");
    extracted = JSON.parse(raw) as ExtractedDemand;
    validateExtracted(extracted);
  } catch (err) {
    geminiError = err instanceof Error ? err.message : String(err);
    console.error("[extract-demand] erro:", geminiError);
  }

  const latencyMs = Date.now() - startedAt;
  const costMicro = Math.ceil(
    inputTokens * INPUT_COST_PER_TOKEN_MICRO + outputTokens * OUTPUT_COST_PER_TOKEN_MICRO,
  );

  // -----------------------------------------------------------------------
  // 5. Registra uso (com service_role contornando RLS)
  // -----------------------------------------------------------------------
  await supabase.from("ai_usage_log").insert({
    user_id: user.id,
    operation: "extract",
    model: GEMINI_MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_micro: costMicro,
    latency_ms: latencyMs,
    status: extracted ? "success" : "error",
    error_message: geminiError,
  });

  if (!extracted) {
    return json(
      { error: geminiError ?? "Falha ao extrair", fallback: true },
      502,
    );
  }

  return json({
    extracted,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_micro: costMicro,
      latency_ms: latencyMs,
    },
  });
});

// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildPrompt(args: {
  text: string;
  clientsList: string;
  membersList: string;
  isoDate: string;
  weekday: string;
  attachments: AttachmentPayload[];
}): string {
  const attachmentsBlock = args.attachments.length === 0
    ? "(nenhum anexo nesta captura)"
    : args.attachments
        .map((a, i) => `${i + 1}. ${a.fileName} (${a.mimeType})`)
        .join("\n");

  const enrichmentInstructions = args.attachments.length === 0
    ? ""
    : `

4. ENRIQUECIMENTO DA DESCRIÇÃO (RF-06b) — obrigatório quando há anexos:

   Os ${args.attachments.length} anexo(s) listado(s) acima vêm logo após este
   prompt, na MESMA ORDEM. Use-os para gerar UM BLOCO por anexo, anexado ao
   FIM do campo \`descricao\` após uma linha separadora "---". Não invente
   anexos, não pule nenhum, e use SEMPRE o nome de arquivo informado.

   Formato de cada bloco (markdown), conforme o tipo MIME do anexo:

   • image/* — descrição visual breve do que aparece na imagem:
     🖼️ {nome} — {1 frase descrevendo o conteúdo visual}

   • audio/* — transcrição COMPLETA do áudio em português:
     🎵 {nome}
     > Transcrição: "{texto integral transcrito}"

   • video/* — sinopse de 1-2 frases:
     🎬 {nome}
     > Sinopse: {1-2 frases resumindo o vídeo}

   • application/pdf — título descritivo do conteúdo:
     📄 {nome} — {1 frase sintetizando o documento}

   Exemplo de descricao final com anexos:

   Pedro precisa ajustar o banner do cliente Acme.

   ---

   🖼️ screenshot.png — Tela do checkout exibindo erro 500 no botão Finalizar.
   🎵 audio.ogg
   > Transcrição: "Oi pessoal, preciso que o banner do topo mude até quinta..."`;

  return `Você é um assistente da TNG Digital especializado em extrair informações
estruturadas de capturas rápidas feitas pela equipe interna.

CONTEXTO DA EMPRESA (TNG Digital):

Membros ativos da equipe:
${args.membersList}

Clientes ativos:
${args.clientsList}

Prioridades válidas: baixa, media, alta, urgente
Status inicial padrão: todo

DATA DE REFERÊNCIA: ${args.isoDate}
DIA DA SEMANA ATUAL: ${args.weekday}

CONTEÚDO CAPTURADO (texto):
${args.text}

ANEXOS ANEXADOS (mesma ordem das partes inlineData a seguir):
${attachmentsBlock}

INSTRUÇÕES:

1. Extraia os seguintes campos:
   - cliente: nome do cliente mencionado, batendo com a lista (null se não houver).
   - responsavel: nome do membro da equipe (null se não houver atribuição clara).
   - prioridade: inferir do tom (urgente/asap -> 'urgente'; importante -> 'alta';
     quando puder -> 'baixa'; default 'media').
   - prazo: data ISO 8601 (YYYY-MM-DD). Interprete expressões relativas
     ('quinta', 'amanhã', 'fim do mês') usando a DATA DE REFERÊNCIA. Null se
     não houver menção.
   - descricao: reescreva o conteúdo principal em frases claras, objetivas, em
     terceira pessoa, descrevendo a tarefa a ser feita.
   - tags: 1 a 3 palavras-chave curtas em kebab-case.

2. Confiança de 0 a 1 para cada campo (exceto descricao e tags).

3. Retorne APENAS JSON válido no formato exato abaixo:

{
  "cliente": "string | null",
  "responsavel": "string | null",
  "prioridade": "baixa | media | alta | urgente",
  "prazo": "YYYY-MM-DD | null",
  "descricao": "string",
  "tags": ["string"],
  "confianca": {
    "cliente": 0.0,
    "responsavel": 0.0,
    "prioridade": 0.0,
    "prazo": 0.0
  }
}${enrichmentInstructions}

Nunca invente informação que não esteja na captura. Para campos não detectados,
use null e confiança baixa.`;
}

function validateExtracted(e: ExtractedDemand): void {
  if (typeof e.descricao !== "string") throw new Error("Campo descricao ausente");
  if (!["baixa", "media", "alta", "urgente"].includes(e.prioridade)) {
    throw new Error(`Prioridade inválida: ${e.prioridade}`);
  }
  if (!Array.isArray(e.tags)) throw new Error("Campo tags deve ser array");
  if (!e.confianca || typeof e.confianca !== "object") {
    throw new Error("Campo confianca ausente");
  }
}
