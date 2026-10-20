const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fecha efectiva de una venta enviada por un dispositivo: la que capturo el cliente si es una
 * fecha ISO valida, no esta en el futuro (tolerancia 5 min por relojes desfasados) y no tiene
 * mas de 30 dias. En cualquier otro caso se usa la hora del servidor.
 */
export function resolveSaleDate(value: unknown, now: Date = new Date()): Date {
  if (typeof value !== "string" || value.length > 40) return now;
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return now;
  if (time > now.getTime() + MAX_FUTURE_MS) return now;
  if (time < now.getTime() - MAX_AGE_MS) return now;
  return parsed;
}
