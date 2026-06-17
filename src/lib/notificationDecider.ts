// =============================================================================
// Decisor de notificações por role
// =============================================================================
// Função pura que recebe um evento do realtime + role do usuário atual e
// decide se deve disparar notificação. Mantida fora do DashboardScreen pra
// poder testar a matriz inteira (admin/membro × insert/update/delete × self/
// outro) sem precisar montar render React.
//
// Regras:
//   - admin: recebe TUDO exceto ações próprias (detectadas via wasLocalChange
//     e via author/created_by). É o "olhar de cima" do sistema.
//   - membro: só notifica quando ele é diretamente envolvido — é assignee
//     OU created_by da demanda alvo. Caso de "removeram minha atribuição"
//     também notifica (a demanda já foi minha, deve saber).
//
// O título/body é pensado pra notificação nativa do macOS/Windows: curto,
// foca em "o que mudou", não inclui nome do ator quando não tem (precisaria
// resolver via lookup async — caller que enriquece se quiser).
// =============================================================================

import { htmlToPlainText, legacyToHtml } from "./htmlContent";
import { fieldLabel, formatFieldValue } from "./demandHistory";
import type { Comment, Demand, NotificationPrefs } from "../types/database";

export type Role = "admin" | "member";

export type DemandRealtimeEvent = "INSERT" | "UPDATE" | "DELETE";

export type DemandChangePayload = {
  new: Demand | null;
  old: Demand | null;
};

export type Notification = {
  title: string;
  body: string;
  demandId: string;
};

export type LookupCtx = {
  // Lookup id→nome humano. Quando ausente, exibimos só o id ou "—".
  clientName?: (id: string | null) => string | undefined;
  profileName?: (id: string | null) => string | undefined;
};

// Campos que descrevem mudança relevante para o usuário. Excluímos contadores
// internos (comments_count, attachments_count) e campos que mudam automatic
// (updated_at, updated_by) pra evitar ruído de notificação.
const NOTIFIABLE_FIELDS: (keyof Demand)[] = [
  "title",
  "description",
  "status",
  "priority",
  "due_date",
  "client_id",
  "assignee_id",
  "infrastructure",
  "tags",
];

function demandLabel(d: Pick<Demand, "title" | "description">): string {
  if (d.title) return d.title;
  return htmlToPlainText(legacyToHtml(d.description)).slice(0, 80);
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function valueToString(field: keyof Demand, value: unknown, ctx?: LookupCtx): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.join(", ");
  }
  const str = String(value);
  if (field === "client_id") {
    return ctx?.clientName?.(str) ?? str;
  }
  if (field === "assignee_id") {
    return ctx?.profileName?.(str) ?? str;
  }
  return formatFieldValue(field, str);
}

// Lista as mudanças entre old e new, formatadas em "Campo: antigo → novo".
// Limitamos a 3 itens no body da notif pra não cortar feio no banner do SO.
export function summarizeDemandChanges(
  oldRow: Demand,
  newRow: Demand,
  ctx?: LookupCtx,
): string[] {
  const out: string[] = [];
  for (const f of NOTIFIABLE_FIELDS) {
    if (isSameValue(oldRow[f], newRow[f])) continue;
    const from = valueToString(f, oldRow[f], ctx);
    const to = valueToString(f, newRow[f], ctx);
    out.push(`${fieldLabel(f)}: ${from} → ${to}`);
  }
  return out;
}

export function decideDemandNotification(args: {
  event: DemandRealtimeEvent;
  change: DemandChangePayload;
  me: string | null;
  role: Role;
  wasLocalChange: (demandId: string) => boolean;
  ctx?: LookupCtx;
  // Preferências do user atual. Quando ausente, comporta como "todos true"
  // (compatível com chamadas legadas). Notif de due_soon é filtrada no
  // servidor — esta função não checa esse bucket.
  prefs?: NotificationPrefs;
}): Notification | null {
  const { event, change, me, role, wasLocalChange, ctx, prefs } = args;
  if (!me) return null;

  // ---------------------- INSERT --------------------------------------------
  if (event === "INSERT" && change.new) {
    const d = change.new;
    if (d.created_by === me) return null; // eu mesmo criei

    if (role === "admin") {
      return {
        title: "Nova demanda criada",
        body: demandLabel(d),
        demandId: d.id,
      };
    }
    // Membro: só se atribuída a ele
    if (d.assignee_id === me) {
      if (prefs && !prefs.assigned) return null;
      return {
        title: "Demanda atribuída a você",
        body: demandLabel(d),
        demandId: d.id,
      };
    }
    return null;
  }

  // ---------------------- UPDATE --------------------------------------------
  if (event === "UPDATE" && change.new && change.old) {
    if (wasLocalChange(change.new.id)) return null;
    const d = change.new;

    // Filtro por role: membro só vê o que é dele (ou foi dele).
    if (role === "member") {
      const involvedNow =
        d.assignee_id === me || d.created_by === me;
      const involvedBefore =
        change.old.assignee_id === me || change.old.created_by === me;
      if (!involvedNow && !involvedBefore) return null;
    }

    // Casos especiais com mensagem mais natural que o diff cru.

    // 1. Reatribuição a mim — só pra membro (admin já cobre via "atualizada")
    if (
      role === "member" &&
      d.assignee_id === me &&
      change.old.assignee_id !== me
    ) {
      if (prefs && !prefs.assigned) return null;
      return {
        title: "Demanda atribuída a você",
        body: demandLabel(d),
        demandId: d.id,
      };
    }

    // 2. Conclusão (todo|doing → done)
    if (d.status === "done" && change.old.status !== "done") {
      if (prefs && !prefs.completed) return null;
      return {
        title: "Demanda concluída",
        body: demandLabel(d),
        demandId: d.id,
      };
    }

    // 3. Diff genérico
    const changes = summarizeDemandChanges(change.old, d, ctx);
    if (changes.length === 0) return null;
    const body =
      changes.length <= 2
        ? changes.join(" · ")
        : `${changes.slice(0, 2).join(" · ")} · +${changes.length - 2}`;
    return {
      title: `Atualizada: ${demandLabel(d)}`,
      body,
      demandId: d.id,
    };
  }

  // ---------------------- DELETE --------------------------------------------
  if (event === "DELETE" && change.old) {
    const d = change.old;
    if (d.created_by === me) return null;
    if (role === "member") {
      if (d.assignee_id !== me && d.created_by !== me) return null;
    }
    return {
      title: "Demanda excluída",
      body: demandLabel(d),
      demandId: d.id,
    };
  }

  return null;
}

export function decideCommentNotification(args: {
  comment: Comment;
  demand: Demand | null;
  me: string | null;
  role: Role;
  prefs?: NotificationPrefs;
}): Notification | null {
  const { comment, demand, me, role, prefs } = args;
  if (!me) return null;
  if (comment.author_id === me) return null;
  if (!demand) return null;
  if (prefs && !prefs.comments) return null;

  if (role === "member") {
    if (demand.assignee_id !== me && demand.created_by !== me) return null;
  }

  return {
    title: `Comentário em "${demandLabel(demand)}"`,
    body: htmlToPlainText(legacyToHtml(comment.content)).slice(0, 140),
    demandId: demand.id,
  };
}
