import { round2 } from "@/lib/cash-math";
import { todayDateString } from "@/lib/utils";

// ── Entradas (filas ya leidas de la base) ────────────────────────────────────
export interface ASale { id: string; total: number; subtotal: number; payment_method: string; payment_status: string; created_at: string }
export interface AItem { sale_id: string; id: string; variant_id: string | null; description: string; unit_price: number; unit_cost: number | null; qty: number; line_total: number }
export interface AReturn { id: string; sale_id: string; total_refund: number; refund_method: string; created_at: string }
export interface AReturnItem { return_id: string; sale_item_id: string; qty: number; amount: number }
export interface AExpense { amount: number; created_at: string }
export interface ALayawayPayment { kind: "payment" | "refund"; method: string; amount: number; payment_status: string; created_at: string }

export interface AnalyticsInput {
  sales: ASale[];
  items: AItem[];
  returns: AReturn[];
  returnItems: AReturnItem[];
  expenses: AExpense[];
  layawayPayments: ALayawayPayment[];
}

export interface ProductStat { name: string; qty: number; revenue: number; profit: number | null }

export interface AnalyticsResult {
  /** Ventas cobradas (efectivo + transferencias confirmadas), antes de devoluciones. */
  grossSales: number;
  returnsTotal: number;
  returnsCount: number;
  /** Ventas cobradas - devoluciones. */
  netSales: number;
  cashSales: number;
  transferSales: number;
  /** Transferencias aun por confirmar: NO son ingreso cobrado. */
  pendingTransfers: number;
  pendingTransfersCount: number;
  rejectedCount: number;
  rejectedTotal: number;
  expenses: number;
  /** Abonos de apartados cobrados (menos reembolsos) y los que siguen pendientes. */
  layawayCollected: number;
  layawayPending: number;
  /** Lo realmente cobrado en el periodo: ventas netas + apartados - gastos. */
  netCashFlow: number;
  transactionCount: number;
  averageTicket: number;
  /** Ganancia estimada = ingreso neto - costo, solo de partidas con costo registrado. */
  estimatedProfit: number;
  estimatedCost: number;
  /** % de unidades vendidas que tienen costo registrado (para saber cuanto confiar en la ganancia). */
  costCoverage: number;
  byDay: { day: string; total: number }[];
  byHour: { hour: number; total: number }[];
  topProducts: ProductStat[];
}

const mxHour = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", hour12: false });

/** Calcula las metricas de un periodo (funcion pura). Los datos ya vienen filtrados por fecha. */
export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const paid = input.sales.filter((s) => s.payment_status === "paid");
  const pending = input.sales.filter((s) => s.payment_status === "pending");
  const rejected = input.sales.filter((s) => s.payment_status === "rejected");
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

  const grossSales = sum(paid.map((s) => Number(s.total)));
  const returnsTotal = sum(input.returns.map((r) => Number(r.total_refund)));
  const cashSalesGross = sum(paid.filter((s) => s.payment_method === "cash").map((s) => Number(s.total)));
  const cashReturns = sum(input.returns.filter((r) => r.refund_method === "cash").map((r) => Number(r.total_refund)));

  const layawayCollected = sum(
    input.layawayPayments
      .filter((p) => p.payment_status === "paid")
      .map((p) => (p.kind === "payment" ? Number(p.amount) : -Number(p.amount)))
  );
  const layawayPending = sum(
    input.layawayPayments.filter((p) => p.kind === "payment" && p.payment_status === "pending").map((p) => Number(p.amount))
  );
  const expenses = sum(input.expenses.map((e) => Number(e.amount)));
  const netSales = round2(grossSales - returnsTotal);

  // Dia y hora (CDMX).
  const byDay = new Map<string, number>();
  const byHour = new Map<number, number>();
  for (const s of paid) {
    const day = todayDateString(new Date(s.created_at));
    byDay.set(day, round2((byDay.get(day) ?? 0) + Number(s.total)));
    const hour = Number(mxHour.format(new Date(s.created_at))) % 24;
    byHour.set(hour, round2((byHour.get(hour) ?? 0) + Number(s.total)));
  }
  for (const r of input.returns) {
    const day = todayDateString(new Date(r.created_at));
    byDay.set(day, round2((byDay.get(day) ?? 0) - Number(r.total_refund)));
  }

  // Productos, costo y ganancia estimada (solo partidas de ventas cobradas).
  const paidIds = new Set(paid.map((s) => s.id));
  const saleById = new Map(input.sales.map((s) => [s.id, s]));
  const returnedQty = new Map<string, number>();
  const returnedAmount = new Map<string, number>();
  for (const ri of input.returnItems) {
    returnedQty.set(ri.sale_item_id, (returnedQty.get(ri.sale_item_id) ?? 0) + Number(ri.qty));
    returnedAmount.set(ri.sale_item_id, (returnedAmount.get(ri.sale_item_id) ?? 0) + Number(ri.amount));
  }

  const products = new Map<string, { name: string; qty: number; revenue: number; profit: number; hasCost: boolean }>();
  let cost = 0;
  let profit = 0;
  let unitsTotal = 0;
  let unitsWithCost = 0;
  for (const it of input.items) {
    if (!paidIds.has(it.sale_id)) continue;
    const sale = saleById.get(it.sale_id)!;
    const qty = Number(it.qty) - (returnedQty.get(it.id) ?? 0);
    if (qty <= 0) continue;
    // Ingreso de la partida con el descuento de la venta prorrateado, menos lo ya devuelto.
    const ratio = Number(sale.subtotal) > 0 ? Number(sale.total) / Number(sale.subtotal) : 1;
    const revenue = round2(Number(it.line_total) * ratio - (returnedAmount.get(it.id) ?? 0));
    unitsTotal += qty;
    const entry = products.get(it.description) ?? { name: it.description, qty: 0, revenue: 0, profit: 0, hasCost: false };
    entry.qty += qty;
    entry.revenue = round2(entry.revenue + revenue);
    if (it.unit_cost != null) {
      const c = round2(Number(it.unit_cost) * qty);
      unitsWithCost += qty;
      cost = round2(cost + c);
      profit = round2(profit + revenue - c);
      entry.profit = round2(entry.profit + revenue - c);
      entry.hasCost = true;
    }
    products.set(it.description, entry);
  }

  return {
    grossSales,
    returnsTotal,
    returnsCount: input.returns.length,
    netSales,
    cashSales: round2(cashSalesGross - cashReturns),
    transferSales: round2(grossSales - cashSalesGross - (returnsTotal - cashReturns)),
    pendingTransfers: sum(pending.map((s) => Number(s.total))),
    pendingTransfersCount: pending.length,
    rejectedCount: rejected.length,
    rejectedTotal: sum(rejected.map((s) => Number(s.total))),
    expenses,
    layawayCollected,
    layawayPending,
    netCashFlow: round2(netSales + layawayCollected - expenses),
    transactionCount: paid.length,
    averageTicket: paid.length ? round2(grossSales / paid.length) : 0,
    estimatedProfit: profit,
    estimatedCost: cost,
    costCoverage: unitsTotal ? Math.round((unitsWithCost / unitsTotal) * 100) : 100,
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, total]) => ({ day, total })),
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, total]) => ({ hour, total })),
    topProducts: [...products.values()]
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
      .slice(0, 10)
      .map((p) => ({ name: p.name, qty: p.qty, revenue: p.revenue, profit: p.hasCost ? p.profit : null })),
  };
}

/** Variacion porcentual (null si no hay base de comparacion). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Periodo anterior de la misma duracion, inmediatamente antes de [from, to] (AAAA-MM-DD). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  const days = Math.round((b - a) / 86400000) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(a - days * 86400000), to: iso(a - 86400000) };
}

// ── Sugerencia de resurtido ──────────────────────────────────────────────────
export interface VariantStock { id: string; name: string; stock_qty: number; low_stock_threshold: number }
export interface RestockSuggestion { variant_id: string; name: string; stock: number; sold: number; perDay: number; daysLeft: number | null; suggested: number }

/**
 * Sugiere reponer variantes que se agotan pronto o ya estan bajo su minimo.
 * Cubre `coverDays` dias de venta al ritmo del periodo observado.
 */
export function restockSuggestions(
  variants: VariantStock[],
  soldByVariant: Map<string, number>,
  observedDays: number,
  coverDays = 14
): RestockSuggestion[] {
  const out: RestockSuggestion[] = [];
  for (const v of variants) {
    const sold = soldByVariant.get(v.id) ?? 0;
    const perDay = observedDays > 0 ? sold / observedDays : 0;
    // Sin existencias el faltante es inmediato, aunque no haya ventas en el periodo.
    const daysLeft = v.stock_qty <= 0 ? 0 : perDay > 0 ? v.stock_qty / perDay : null;
    const low = v.stock_qty <= v.low_stock_threshold;
    const runningOut = daysLeft !== null && daysLeft < 7;
    if (!low && !runningOut) continue;
    const target = Math.ceil(perDay * coverDays);
    const suggested = Math.max(target - v.stock_qty, low ? v.low_stock_threshold * 2 - v.stock_qty : 0, 0);
    if (suggested <= 0) continue;
    out.push({
      variant_id: v.id, name: v.name, stock: v.stock_qty, sold,
      perDay: Math.round(perDay * 100) / 100,
      daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
      suggested,
    });
  }
  return out.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}
