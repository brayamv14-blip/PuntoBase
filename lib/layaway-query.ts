import { layawayBalance, layawayView } from "@/lib/layaways";

export const LAYAWAY_SELECT =
  "id, folio, customer_name, customer_phone, status, total, due_date, notes, delivered_at, cancelled_at, cancel_reason, created_at, device:devices(name), items:layaway_items(id, product_id, variant_id, description, unit_price, qty, line_total, reserved), payments:layaway_payments(id, kind, method, amount, payment_status, created_at)";

export type LayawayRow = Record<string, unknown> & {
  status: string;
  due_date: string;
  total: number;
  payments: { kind: "payment" | "refund"; amount: number; payment_status: "paid" | "pending" | "rejected" }[];
};

export function decorateLayaway(row: LayawayRow, today: string) {
  const bal = layawayBalance(Number(row.total), row.payments ?? []);
  return { ...row, view: layawayView(row.status, row.due_date, today), ...bal };
}
