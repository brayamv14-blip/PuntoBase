import { supabase } from "@/lib/supabase/server";
import { sendPush, type PushSendResult } from "@/lib/push";
import { todayDateString } from "@/lib/utils";

export interface DueLayaway {
  folio: string;
  customer_name: string;
  due_date: string;
}

export interface LayawayReminder {
  title: string;
  body: string;
  overdue: number;
  dueSoon: number;
}

/** Suma un dia a una fecha AAAA-MM-DD. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Arma el aviso diario de apartados: vencidos (fecha limite anterior a hoy) y por vencer (hoy o manana).
 * Devuelve null si no hay nada que avisar. Solo avisa: NUNCA libera inventario por su cuenta.
 */
export function buildLayawayReminder(rows: DueLayaway[], today: string): LayawayReminder | null {
  const tomorrow = nextDay(today);
  const overdue = rows.filter((r) => r.due_date < today);
  const soon = rows.filter((r) => r.due_date === today || r.due_date === tomorrow);
  if (overdue.length === 0 && soon.length === 0) return null;

  const parts: string[] = [];
  if (overdue.length > 0) parts.push(`${overdue.length} vencido${overdue.length === 1 ? "" : "s"}`);
  if (soon.length > 0) parts.push(`${soon.length} por vencer`);
  const sample = [...overdue, ...soon].slice(0, 3).map((r) => `${r.folio} (${r.customer_name})`).join(", ");
  return {
    title: "Apartados por atender",
    body: `${parts.join(" y ")}. ${sample}. Revisa si el cliente pasa o libera el inventario.`,
    overdue: overdue.length,
    dueSoon: soon.length,
  };
}

export interface ReminderOutcome {
  today: string;
  overdue: number;
  dueSoon: number;
  sent: boolean;
  push?: PushSendResult;
}

/** Revisa los apartados activos y manda un solo aviso por dia (idempotente: reintentos no duplican). */
export async function notifyLayawaysDue(now: Date = new Date()): Promise<ReminderOutcome> {
  const today = todayDateString(now);
  const { data, error } = await supabase
    .from("layaways")
    .select("folio, customer_name, due_date")
    .eq("status", "active")
    .lte("due_date", nextDay(today))
    .order("due_date", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);

  const reminder = buildLayawayReminder((data ?? []) as DueLayaway[], today);
  if (!reminder) return { today, overdue: 0, dueSoon: 0, sent: false };

  const push = await sendPush(
    { title: reminder.title, body: reminder.body, url: "/layaways", tag: "layaway-due" },
    { category: "sales", dedupeKey: `layaway-due:${today}` }
  );
  return { today, overdue: reminder.overdue, dueSoon: reminder.dueSoon, sent: push.accepted > 0, push };
}
