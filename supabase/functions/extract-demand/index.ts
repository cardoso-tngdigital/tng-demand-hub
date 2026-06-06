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

// Lista ordenada de modelos a tentar. O primeiro é o preferido; em 429/503
// caímos pro próximo automaticamente, devolvendo erro pro client só quando
// todos falham. Cada modelo Gemini tem cota separada no free tier.
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];
const geminiEndpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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

// Anexos grandes (>= ~4MB) entram pelo fluxo Storage → Files API. O client
// faz upload prévio no path informado, e a Edge Function lê via service_role
// + repassa para a Files API do Gemini.
type StorageAttachmentPayload = {
  id: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
};

type ExtractRequest = {
  text: string;
  attachments?: AttachmentPayload[];
  storage_attachments?: StorageAttachmentPayload[];
};

// Arquivo já carregado na Files API do Gemini, pronto pra usar no parts via
// fileData.fileUri. Construído pela Edge Function pós upload+polling.
type GeminiFileRef = {
  uri: string;
  mimeType: string;
  fileName: string;
};

type Confianca = {
  cliente: number;
  responsavel: number;
  prioridade: number;
  prazo: number;
};

// Resposta crua do Gemini: separamos descricao_principal e descricao_anexos
// em campos distintos para forçar consistência do bloco RF-06b. O Gemini
// ignorava regularmente a instrução "anexa um bloco" quando esses dados
// dividiam o mesmo campo. A Edge Function faz a fusão depois — o client
// recebe um único `descricao` como sempre.
type RawExtraction = {
  cliente: string | null;
  responsavel: string | null;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  prazo: string | null;
  descricao_principal: string;
  descricao_anexos: string | null;
  tags: string[];
  confianca: Confianca;
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

  const storageAttachments = Array.isArray(body.storage_attachments)
    ? body.storage_attachments
    : [];
  for (const s of storageAttachments) {
    if (
      typeof s.id !== "string" ||
      typeof s.file_name !== "string" ||
      typeof s.mime_type !== "string" ||
      typeof s.storage_path !== "string"
    ) {
      return json({ error: "storage_attachment com campos faltando" }, 400);
    }
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

  // -----------------------------------------------------------------------
  // 3b. Anexos grandes via Files API do Gemini
  // -----------------------------------------------------------------------
  // Baixa cada anexo do Supabase Storage e sobe pra Files API. Roda em
  // paralelo pra ganhar latência; um erro em qualquer um quebra a captura
  // (o usuário pode tentar de novo ou seguir com fallback manual).
  let geminiFiles: GeminiFileRef[] = [];
  let storageStageError: string | null = null;

  if (storageAttachments.length > 0) {
    try {
      geminiFiles = await Promise.all(
        storageAttachments.map((s) =>
          uploadStorageAttachmentToGemini({
            supabase,
            geminiKey,
            payload: s,
          }),
        ),
      );
    } catch (err) {
      storageStageError =
        "Falha ao preparar anexo grande pra IA: " +
        (err instanceof Error ? err.message : String(err));
      console.error("[extract-demand]", storageStageError);
    }
  }

  // Lista combinada na ordem em que vão pro prompt: inline primeiro, depois
  // storage. Mantém numeração consistente entre prompt e parts.
  const allAttachmentsForPrompt: Array<{ fileName: string; mimeType: string }> = [
    ...attachments.map((a) => ({ fileName: a.fileName, mimeType: a.mimeType })),
    ...geminiFiles.map((g) => ({ fileName: g.fileName, mimeType: g.mimeType })),
  ];

  const prompt = buildPrompt({
    text,
    clientsList,
    membersList,
    isoDate,
    weekday,
    attachments: allAttachmentsForPrompt,
  });

  // Parts na MESMA ordem do prompt: inline + fileData dos uploads grandes.
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const a of attachments) {
    parts.push({ inlineData: { mimeType: a.mimeType, data: a.base64 } });
  }
  for (const g of geminiFiles) {
    parts.push({ fileData: { mimeType: g.mimeType, fileUri: g.uri } });
  }

  // Se a preparação de Files API falhou, devolve erro antes de chamar o
  // modelo — não faz sentido gastar tokens em uma chamada incompleta.
  if (storageStageError) {
    await supabase.from("ai_usage_log").insert({
      user_id: user.id,
      operation: "extract",
      model: GEMINI_MODELS[0],
      input_tokens: 0,
      output_tokens: 0,
      cost_micro: 0,
      latency_ms: Date.now() - startedAt,
      status: "error",
      error_message: storageStageError,
    });
    return json({ error: storageStageError, fallback: true }, 502);
  }

  // -----------------------------------------------------------------------
  // 4. Chama Gemini — tenta cada modelo da lista em ordem; falhas de cota
  //    (429) e indisponibilidade temporária (503) caem para o próximo.
  // -----------------------------------------------------------------------
  let extracted: ExtractedDemand | null = null;
  let geminiError: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let modelUsed = GEMINI_MODELS[0];
  const modelAttempts: string[] = [];

  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  for (const model of GEMINI_MODELS) {
    modelAttempts.push(model);
    modelUsed = model;
    try {
      const res = await fetch(`${geminiEndpoint(model)}?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      if (!res.ok) {
        const errText = await res.text();
        // 429 (cota) e 503 (indisponível) são retentáveis: pula pro próximo modelo
        if ((res.status === 429 || res.status === 503) && model !== GEMINI_MODELS[GEMINI_MODELS.length - 1]) {
          geminiError = `Gemini ${res.status} em ${model}: ${errText.slice(0, 120)}`;
          console.warn(`[extract-demand] ${model} → ${res.status}, tentando próximo`);
          continue;
        }
        throw new Error(`Gemini ${res.status} em ${model}: ${errText.slice(0, 300)}`);
      }

      const payload = await res.json();
      inputTokens = payload.usageMetadata?.promptTokenCount ?? 0;
      outputTokens = payload.usageMetadata?.candidatesTokenCount ?? 0;

      const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new Error("Resposta do Gemini sem conteúdo");
      const rawExtraction = JSON.parse(raw) as RawExtraction;
      validateRaw(rawExtraction);
      extracted = mergeExtraction(rawExtraction);
      geminiError = null;
      break;
    } catch (err) {
      geminiError = err instanceof Error ? err.message : String(err);
      console.error("[extract-demand] erro:", geminiError);
      // Sai do loop — erros não-retentáveis ou último modelo
      break;
    }
  }

  // Re-empacota o try/catch original pra manter o restante do código intacto
  try {
    if (extracted) {
      // sucesso — já está populado
    } else if (!geminiError) {
      throw new Error("Nenhum modelo Gemini retornou resultado");
    }
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
  // Quando fallback aconteceu, anexamos o registro dos modelos tentados
  // ao error_message — no caso de success, só fica null se foi o primeiro.
  const attemptsNote =
    modelAttempts.length > 1
      ? `tentativas: ${modelAttempts.join(" → ")}`
      : null;

  await supabase.from("ai_usage_log").insert({
    user_id: user.id,
    operation: "extract",
    model: modelUsed,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_micro: costMicro,
    latency_ms: latencyMs,
    status: extracted ? "success" : "error",
    error_message: extracted
      ? (attemptsNote ?? null)
      : [geminiError, attemptsNote].filter(Boolean).join(" · ") || null,
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
  attachments: Array<{ fileName: string; mimeType: string }>;
}): string {
  const attachmentsBlock = args.attachments.length === 0
    ? "(nenhum anexo nesta captura)"
    : args.attachments
        .map((a, i) => `${i + 1}. ${a.fileName} (${a.mimeType})`)
        .join("\n");

  const hasAttachments = args.attachments.length > 0;
  const attachmentsRule = hasAttachments
    ? `OBRIGATÓRIO porque há ${args.attachments.length} anexo(s). Para CADA anexo, gere UM bloco no formato abaixo, separado por uma linha em branco. NÃO descreva os anexos dentro de \`descricao_principal\` — esse campo é só sobre a tarefa em si.`
    : `Deixe NULL. Não há anexos nesta captura.`;

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

1. Extraia os campos:
   - cliente: nome do cliente mencionado, batendo com a lista (null se não houver).
   - responsavel: nome do membro da equipe (null se não houver atribuição clara).
   - prioridade: inferir do tom (urgente/asap → 'urgente'; importante → 'alta';
     quando puder → 'baixa'; default 'media').
   - prazo: data ISO 8601 (YYYY-MM-DD). Interprete expressões relativas
     ('quinta', 'amanhã', 'fim do mês') usando a DATA DE REFERÊNCIA. Null se
     não houver menção.
   - descricao_principal: reescreva o que a equipe pediu em frases claras, em
     terceira pessoa, descrevendo a tarefa. SEM mencionar anexos aqui.
   - descricao_anexos: ${attachmentsRule}
   - tags: 1 a 3 palavras-chave curtas em kebab-case.

2. Confiança de 0 a 1 para cliente, responsavel, prioridade, prazo.

3. REGRAS DOS BLOCOS DE ANEXO (campo \`descricao_anexos\`):

   Para cada anexo, gere um bloco em markdown conforme o tipo MIME. Use o
   NOME do arquivo informado (não invente nomes). Os blocos NÃO devem aparecer
   em \`descricao_principal\` em hipótese alguma.

   • image/* →
     🖼️ {nome} — {1 frase descrevendo o conteúdo visual}

   • audio/* →
     🎵 {nome}
     > Transcrição: "{texto integral transcrito em português}"

   • video/* →
     🎬 {nome}
     > Sinopse: {1-2 frases resumindo o vídeo}

   • application/pdf →
     📄 {nome} — {1 frase sintetizando o documento}

   • outros tipos →
     📎 {nome} — {breve descrição se puder inferir; caso contrário só o nome}

   EXEMPLO CORRETO (texto + 1 áudio + 1 imagem):

   {
     "descricao_principal": "Pedro precisa ajustar o banner do cliente Acme até quinta-feira.",
     "descricao_anexos": "🎵 audio.ogg\\n> Transcrição: \\"Oi pessoal, preciso que o banner do topo mude até quinta-feira.\\"\\n\\n🖼️ screenshot.png — Tela atual do site da Acme mostrando o banner antigo no topo."
   }

   EXEMPLO INCORRETO (NUNCA faça isso — funde anexo na descricao_principal):

   {
     "descricao_principal": "Pedro pediu por áudio para ajustar o banner do cliente Acme. No áudio ele fala que precisa até quinta-feira. Na imagem screenshot.png aparece o banner antigo.",
     "descricao_anexos": null
   }

4. Retorne APENAS JSON válido neste formato exato:

{
  "cliente": "string | null",
  "responsavel": "string | null",
  "prioridade": "baixa | media | alta | urgente",
  "prazo": "YYYY-MM-DD | null",
  "descricao_principal": "string",
  "descricao_anexos": "string | null",
  "tags": ["string"],
  "confianca": {
    "cliente": 0.0,
    "responsavel": 0.0,
    "prioridade": 0.0,
    "prazo": 0.0
  }
}

Nunca invente informação que não esteja na captura. Para campos não detectados,
use null e confiança baixa.`;
}

// ---------------------------------------------------------------------------
// Files API do Gemini — upload de anexo grande
// ---------------------------------------------------------------------------
// Fluxo:
//   1. Baixa o arquivo do Supabase Storage (via service_role, bypass RLS).
//   2. Sobe pra Files API do Gemini com `uploadType=media` (raw upload).
//      Endpoint devolve { file: { uri, state, ... } }.
//   3. Faz polling em GET /v1beta/files/{name} até state = "ACTIVE" ou
//      timeout. Vídeos costumam levar 5-30s pra serem processados; áudios
//      são mais rápidos.
//
// Não tentamos baixar paralelo + upload sequencial (ou vice-versa) — o
// chamador já roda em paralelo via Promise.all.

const GEMINI_FILES_UPLOAD_URL =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";

const FILE_ACTIVE_TIMEOUT_MS = 45_000;
const FILE_POLL_INTERVAL_MS = 1500;

async function uploadStorageAttachmentToGemini(args: {
  supabase: ReturnType<typeof createClient>;
  geminiKey: string;
  payload: StorageAttachmentPayload;
}): Promise<GeminiFileRef> {
  const { supabase, geminiKey, payload } = args;

  // 1. Download do Storage.
  const { data: blob, error: dlError } = await supabase.storage
    .from("attachments")
    .download(payload.storage_path);
  if (dlError || !blob) {
    throw new Error(
      `download(${payload.storage_path}) falhou: ${dlError?.message ?? "blob nulo"}`,
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // 2. Upload pra Files API (raw).
  const uploadRes = await fetch(
    `${GEMINI_FILES_UPLOAD_URL}?key=${geminiKey}&uploadType=media`,
    {
      method: "POST",
      headers: {
        "Content-Type": payload.mime_type,
        "X-Goog-Upload-File-Name": payload.file_name,
      },
      body: bytes,
    },
  );
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(
      `Files API upload ${uploadRes.status}: ${errText.slice(0, 200)}`,
    );
  }
  const uploaded = await uploadRes.json();
  const file = uploaded.file as { name: string; uri: string; state?: string } | undefined;
  if (!file?.uri || !file?.name) {
    throw new Error("Files API não devolveu uri/name");
  }

  // 3. Poll até ACTIVE.
  let state = file.state ?? "PROCESSING";
  const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS;
  while (state !== "ACTIVE" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${geminiKey}`,
    );
    if (!pollRes.ok) {
      const errText = await pollRes.text();
      throw new Error(`poll ${pollRes.status}: ${errText.slice(0, 200)}`);
    }
    const polled = await pollRes.json();
    state = polled.state ?? state;
    if (state === "FAILED") {
      throw new Error(`Files API state=FAILED para ${payload.file_name}`);
    }
  }
  if (state !== "ACTIVE") {
    throw new Error(
      `Files API ainda em ${state} após ${FILE_ACTIVE_TIMEOUT_MS}ms — arquivo grande demais ou processamento lento`,
    );
  }

  return {
    uri: file.uri,
    mimeType: payload.mime_type,
    fileName: payload.file_name,
  };
}

function validateRaw(e: RawExtraction): void {
  if (typeof e.descricao_principal !== "string" || !e.descricao_principal.trim()) {
    throw new Error("Campo descricao_principal ausente ou vazio");
  }
  if (
    e.descricao_anexos !== null &&
    e.descricao_anexos !== undefined &&
    typeof e.descricao_anexos !== "string"
  ) {
    throw new Error("Campo descricao_anexos deve ser string ou null");
  }
  if (!["baixa", "media", "alta", "urgente"].includes(e.prioridade)) {
    throw new Error(`Prioridade inválida: ${e.prioridade}`);
  }
  if (!Array.isArray(e.tags)) throw new Error("Campo tags deve ser array");
  if (!e.confianca || typeof e.confianca !== "object") {
    throw new Error("Campo confianca ausente");
  }
}

// Junta os dois campos da IA num único `descricao` antes de devolver ao
// client. Separador "---" só aparece quando há bloco de anexos efetivo.
function mergeExtraction(r: RawExtraction): ExtractedDemand {
  const principal = r.descricao_principal.trim();
  const anexos = (r.descricao_anexos ?? "").trim();
  const descricao = anexos ? `${principal}\n\n---\n\n${anexos}` : principal;
  return {
    cliente: r.cliente,
    responsavel: r.responsavel,
    prioridade: r.prioridade,
    prazo: r.prazo,
    descricao,
    tags: r.tags,
    confianca: r.confianca,
  };
}
