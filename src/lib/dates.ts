// Helpers de data compartilhados entre Dashboard e Drawer.

export type DueTone = "overdue" | "urgent" | "soon" | "normal";

export type DueInfo = {
  // "20/06/26"
  dateLabel: string;
  // "Hoje", "Amanhã", "em 4 dias", "Vencido há 2 dias"
  relativeLabel: string;
  // Combinado: "Prazo: 20/06/26 (em 4 dias)"
  fullLabel: string;
  tone: DueTone;
  // Dias restantes (negativo = vencido). Útil pra ordenação.
  daysRemaining: number;
};

// Aceita "YYYY-MM-DD" (formato `date` do Postgres) e ISO completo. Ambos
// são interpretados como meia-noite local pra evitar deslize de fuso —
// se due_date salvo é 2026-06-20 mas o user está em UTC-3, queremos que
// "hoje" seja o dia 20 inteiro, não 19/20.
function parseDueDate(due: string): Date | null {
  if (!due) return null;
  const onlyDate = /^\d{4}-\d{2}-\d{2}$/.test(due);
  if (onlyDate) {
    const [y, m, d] = due.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatDueDate(due: string | null | undefined): DueInfo | null {
  if (!due) return null;
  const date = parseDueDate(due);
  if (!date) return null;

  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const daysRemaining = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(2);
  const dateLabel = `${dd}/${mm}/${yy}`;

  let relativeLabel: string;
  let tone: DueTone;
  if (daysRemaining < 0) {
    const abs = Math.abs(daysRemaining);
    relativeLabel = abs === 1 ? "Vencido há 1 dia" : `Vencido há ${abs} dias`;
    tone = "overdue";
  } else if (daysRemaining === 0) {
    relativeLabel = "Hoje";
    tone = "urgent";
  } else if (daysRemaining === 1) {
    relativeLabel = "Amanhã";
    tone = "urgent";
  } else if (daysRemaining <= 3) {
    relativeLabel = `em ${daysRemaining} dias`;
    tone = "soon";
  } else {
    relativeLabel = `em ${daysRemaining} dias`;
    tone = "normal";
  }

  const fullLabel = `Prazo: ${dateLabel} (${relativeLabel})`;
  return { dateLabel, relativeLabel, fullLabel, tone, daysRemaining };
}

export const DUE_TONE_CLASSES: Record<DueTone, string> = {
  overdue: "text-red-300 bg-red-900/40 border border-red-700/40",
  urgent: "text-red-300 bg-red-950/30 border border-red-800/40",
  soon: "text-tng-orange-400 bg-tng-orange-400/10 border border-tng-orange-400/30",
  normal: "text-tng-marine-300 bg-tng-marine-700/40 border border-tng-marine-600/40",
};
