/** Calculos del corte de caja (funciones puras, con pruebas unitarias). */

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface CashCutInput {
  openingBalance: number;
  /** Ventas en efectivo del dia (las transferencias NO entran). */
  cashSales: number;
  /** Retiros / gastos pagados desde caja. */
  expenses: number;
  /** Efectivo contado fisicamente. */
  actualCash: number;
}

export interface CashCut {
  expectedCash: number;
  /** Negativo = faltante, positivo = sobrante. */
  discrepancy: number;
}

/** efectivo esperado = fondo inicial + ventas en efectivo - retiros. */
export function computeCashCut(input: CashCutInput): CashCut {
  const expectedCash = round2(input.openingBalance + input.cashSales - input.expenses);
  return { expectedCash, discrepancy: round2(input.actualCash - expectedCash) };
}

export function sumAmounts(rows: { [key: string]: unknown }[] | null | undefined, field: string): number {
  return round2((rows ?? []).reduce((sum, row) => sum + Number(row[field] ?? 0), 0));
}

/** Valida el efectivo contado: numero finito, no negativo y con a lo mucho 2 decimales utiles. */
export function parseActualCash(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100_000_000) return null;
  return round2(n);
}
