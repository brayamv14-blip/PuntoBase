import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Zona horaria del negocio. Todos los "dias" (caja, panel, reportes) se miden aqui. */
export const APP_TIMEZONE = "America/Mexico_City";

/**
 * Desfase fijo de la Ciudad de Mexico respecto a UTC. Mexico elimino el horario
 * de verano en 2022, por eso el desfase es constante todo el año.
 */
const APP_UTC_OFFSET = "-06:00";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatCurrency(amount: number): string {
  // Sin centavos si es un monto redondo ($120); con dos decimales si no ($12.50).
  const decimals = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    // "2026-10-17" ya es un dia calendario: no se mueve de zona horaria.
    timeZone: DATE_ONLY.test(dateStr) ? "UTC" : APP_TIMEZONE,
  }).format(d);
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIMEZONE,
  }).format(d);
}

/** Fecha de hoy (YYYY-MM-DD) en hora de la Ciudad de Mexico. */
export function todayDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Suma (o resta) dias a una fecha YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Primer instante (en UTC, ISO) del dia YYYY-MM-DD de la Ciudad de Mexico. */
export function dayStartISO(date: string): string {
  return new Date(`${date}T00:00:00.000${APP_UTC_OFFSET}`).toISOString();
}

/** Ultimo instante (en UTC, ISO) del dia YYYY-MM-DD de la Ciudad de Mexico. */
export function dayEndISO(date: string): string {
  return new Date(`${date}T23:59:59.999${APP_UTC_OFFSET}`).toISOString();
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && DATE_ONLY.test(value);
}
