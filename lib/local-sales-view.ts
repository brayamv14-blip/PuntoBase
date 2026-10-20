import { todayDateString } from "./utils";
import type { LocalSale } from "./local-sales";

/**
 * Ventas locales que corresponden a un dia (YYYY-MM-DD, hora de la Ciudad de Mexico).
 *  - Con conexion: solo las que el servidor aun no conoce (pendientes) o descartadas.
 *  - Sin conexion: todas las del dia, sincronizadas o no.
 */
export function localSalesForDay(
  sales: LocalSale[],
  date: string,
  includeSynced: boolean
): LocalSale[] {
  return sales
    .filter((sale) => todayDateString(new Date(sale.created_at)) === date)
    .filter((sale) => includeSynced || sale.local_status !== "synced")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface LocalTotals {
  count: number;
  cash: number;
  transferPaid: number;
  transferPending: number;
}

/** Totales por metodo de pago de ventas locales (las transferencias pendientes se separan). */
export function localTotals(sales: LocalSale[]): LocalTotals {
  const totals: LocalTotals = { count: 0, cash: 0, transferPaid: 0, transferPending: 0 };
  for (const sale of sales) {
    if (sale.local_status === "failed") continue;
    totals.count++;
    if (sale.payment_method === "cash") totals.cash += sale.total;
    else if (sale.payment_status === "paid") totals.transferPaid += sale.total;
    else totals.transferPending += sale.total;
  }
  return totals;
}
