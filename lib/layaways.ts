import { round2 } from "@/lib/cash-math";

export interface LayawayPaymentRow {
  kind: "payment" | "refund";
  amount: number | string;
  payment_status: "paid" | "pending" | "rejected";
}

export interface LayawayBalance {
  /** Abonos cobrados menos reembolsos pagados. */
  paid: number;
  /** Abonos por transferencia aun sin confirmar. */
  pending: number;
  /** Lo que falta por cobrar: total - cobrado - pendiente de confirmar. */
  balance: number;
  /** Lo que falta contando solo lo ya cobrado (no incluye transferencias pendientes). */
  dueNow: number;
}

/** Calcula saldos de un apartado (funcion pura). */
export function layawayBalance(total: number, payments: LayawayPaymentRow[]): LayawayBalance {
  let paid = 0;
  let pending = 0;
  for (const p of payments) {
    const amount = Number(p.amount);
    if (p.kind === "payment") {
      if (p.payment_status === "paid") paid += amount;
      else if (p.payment_status === "pending") pending += amount;
    } else if (p.payment_status === "paid") {
      paid -= amount;
    }
  }
  paid = round2(paid);
  pending = round2(pending);
  return {
    paid,
    pending,
    balance: Math.max(0, round2(total - paid - pending)),
    dueNow: Math.max(0, round2(total - paid)),
  };
}

export type LayawayView = "active" | "expired" | "delivered" | "cancelled";

/** Un apartado activo cuya fecha limite ya paso es "vencido" (el inventario sigue apartado hasta liberarlo). */
export function layawayView(status: string, dueDate: string, today: string): LayawayView {
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "cancelled";
  return dueDate < today ? "expired" : "active";
}

export const MAX_LAYAWAY_DAYS = 180;

/** Valida la fecha limite (AAAA-MM-DD): no en el pasado y no mas de MAX_LAYAWAY_DAYS adelante. */
export function validateDueDate(due: unknown, today: string): string | null {
  if (typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return "Indica la fecha límite.";
  const d = new Date(`${due}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== due) return "La fecha límite no es válida.";
  if (due < today) return "La fecha límite no puede estar en el pasado.";
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + MAX_LAYAWAY_DAYS);
  if (d > max) return `La fecha límite no puede pasar de ${MAX_LAYAWAY_DAYS} días.`;
  return null;
}
