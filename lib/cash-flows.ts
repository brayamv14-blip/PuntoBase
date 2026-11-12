import { supabase } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/paginate";
import { round2, sumAmounts } from "@/lib/cash-math";

export interface CashFlows {
  /** Ventas cobradas en efectivo. */
  cashSales: number;
  /** Devoluciones pagadas en efectivo (salen de caja el dia de la devolucion). */
  cashRefunds: number;
  /** Abonos de apartados cobrados en efectivo. */
  layawayCashIn: number;
  /** Reembolsos de apartados entregados en efectivo. */
  layawayCashOut: number;
  /** Gastos / retiros. */
  expenses: number;
}

async function rows(
  table: string,
  select: string,
  start: string,
  end: string,
  filter: (q: any) => any = (q) => q // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<Record<string, unknown>[]> {
  return fetchAll((from, to) =>
    filter(supabase.from(table).select(select))
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: true })
      .range(from, to)
  );
}

/** Movimientos de efectivo del periodo [start, end] (ISO). */
export async function getCashFlows(start: string, end: string): Promise<CashFlows> {
  const [sales, refunds, layIn, layOut, expenses] = await Promise.all([
    rows("sales", "total", start, end, (q) => q.eq("payment_method", "cash").eq("payment_status", "paid")),
    rows("sale_returns", "total_refund", start, end, (q) => q.eq("refund_method", "cash")),
    rows("layaway_payments", "amount", start, end, (q) => q.eq("kind", "payment").eq("method", "cash").eq("payment_status", "paid")),
    rows("layaway_payments", "amount", start, end, (q) => q.eq("kind", "refund").eq("method", "cash").eq("payment_status", "paid")),
    rows("expenses", "amount", start, end),
  ]);
  return {
    cashSales: sumAmounts(sales, "total"),
    cashRefunds: sumAmounts(refunds, "total_refund"),
    layawayCashIn: sumAmounts(layIn, "amount"),
    layawayCashOut: sumAmounts(layOut, "amount"),
    expenses: sumAmounts(expenses, "amount"),
  };
}

/** Efectivo esperado a partir del fondo inicial y los movimientos. */
export function expectedFromFlows(openingBalance: number, f: CashFlows): number {
  return round2(
    openingBalance + f.cashSales + f.layawayCashIn - f.cashRefunds - f.layawayCashOut - f.expenses
  );
}
