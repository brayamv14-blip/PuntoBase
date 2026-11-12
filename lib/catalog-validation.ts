/** Validacion de datos de catalogo en el servidor (no se confia en lo que manda el navegador). */
export const MAX_PRICE = 1_000_000;
export const MAX_STOCK = 1_000_000;

export function validPrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE;
}

export function validStock(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_STOCK;
}

export function validName(v: unknown, max = 120): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}
