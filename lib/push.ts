import webpush from "web-push";
import { createECDH } from "crypto";
import { supabase } from "@/lib/supabase/server";

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta que se abre al tocar la notificacion. */
  url?: string;
  /** Misma etiqueta = la notificacion nueva reemplaza a la anterior. */
  tag?: string;
}

/** Categorias que el usuario puede activar/desactivar por dispositivo (columna prefs). */
export type PushCategory = "stock" | "transfers" | "sales" | "sync" | "cash" | "system";
export const USER_PUSH_CATEGORIES = ["stock", "transfers", "sales", "sync", "cash"] as const;
export const DEFAULT_PUSH_PREFS: Record<(typeof USER_PUSH_CATEGORIES)[number], boolean> = {
  stock: true,
  transfers: true,
  sales: false,
  sync: true,
  cash: true,
};

export interface PushSendOptions {
  category: PushCategory;
  /** Si ya existe un evento con esta clave, no se envia (idempotencia ante reintentos). */
  dedupeKey?: string;
  /** No avisar al dispositivo que origino la accion. */
  excludeDeviceId?: string;
  /** Enviar solo a este dispositivo (pruebas). */
  onlyDeviceId?: string;
}

export interface PushSendError {
  /** Solo el host del servicio push (nunca el endpoint completo). */
  host: string;
  status: number | null;
  message: string;
}

/**
 * "accepted" = el servicio push del navegador acepto el mensaje (HTTP 2xx).
 * NO confirma que la notificacion llegara ni se mostrara en el telefono.
 */
export interface PushSendResult {
  configured: boolean;
  skippedDuplicate: boolean;
  attempted: number;
  accepted: number;
  /** Suscripciones caducadas (404/410) que se eliminaron. */
  expired: number;
  failed: number;
  errors: PushSendError[];
}

function emptyResult(over: Partial<PushSendResult> = {}): PushSendResult {
  return {
    configured: false,
    skippedDuplicate: false,
    attempted: 0,
    accepted: 0,
    expired: 0,
    failed: 0,
    errors: [],
    ...over,
  };
}

// ─── VAPID ───────────────────────────────────────────────────────────────────

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Deriva la clave publica VAPID a partir de la privada (P-256). Devuelve null si no es valida. */
export function derivePublicKey(privateKey: string): string | null {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(fromBase64Url(privateKey));
    return toBase64Url(ecdh.getPublicKey());
  } catch {
    return null;
  }
}

export interface VapidStatus {
  configured: boolean;
  publicKeyPresent: boolean;
  privateKeyPresent: boolean;
  subjectConfigured: boolean;
  /** true si la clave publica del navegador corresponde a la privada del servidor. */
  keysMatch: boolean | null;
}

export function getVapidStatus(): VapidStatus {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const keysMatch =
    publicKey && privateKey ? derivePublicKey(privateKey) === publicKey : null;
  return {
    configured: !!publicKey && !!privateKey,
    publicKeyPresent: !!publicKey,
    privateKeyPresent: !!privateKey,
    subjectConfigured: !!process.env.VAPID_SUBJECT?.trim(),
    keysMatch,
  };
}

let configured = false;

/** Devuelve false si faltan las llaves VAPID (las notificaciones quedan desactivadas). */
export function isPushConfigured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;

  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT?.trim() || "mailto:admin@puntobase.local",
      publicKey,
      privateKey
    );
    configured = true;
  }
  return true;
}

// ─── Deduplicacion ───────────────────────────────────────────────────────────

/**
 * Reserva una clave de evento. true = es la primera vez (hay que enviar);
 * false = ya se notifico antes. Si la tabla no existe (migracion 5 pendiente) se
 * envia de todos modos y se deja registro.
 */
export async function claimEvent(eventKey: string, category: string): Promise<boolean> {
  const { error } = await supabase.from("push_events").insert({ event_key: eventKey, category });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  console.error("[push] No se pudo registrar el evento (¿falta la migración 5?):", error.message);
  return true;
}

// ─── Envio ───────────────────────────────────────────────────────────────────

type SubscriptionRow = {
  id: string;
  device_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  prefs: Record<string, boolean> | null;
  failure_count: number | null;
};

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "desconocido";
  }
}

/** Suscripciones que deben recibir la categoria (prefs ausentes = valor por defecto). */
export function wantsCategory(
  prefs: Record<string, boolean> | null,
  category: PushCategory
): boolean {
  if (category === "system") return true;
  const value = prefs?.[category];
  if (typeof value === "boolean") return value;
  return DEFAULT_PUSH_PREFS[category];
}

/**
 * Envia una notificacion respetando preferencias, deduplicacion y dispositivo.
 * Nunca lanza errores; el detalle queda en el resultado y en los logs (sin secretos).
 */
export async function sendPush(
  payload: PushPayload,
  options: PushSendOptions
): Promise<PushSendResult> {
  try {
    if (!isPushConfigured()) return emptyResult();

    if (options.dedupeKey) {
      const first = await claimEvent(options.dedupeKey, options.category);
      if (!first) return emptyResult({ configured: true, skippedDuplicate: true });
    }

    let query = supabase
      .from("push_subscriptions")
      .select("id, device_id, endpoint, p256dh, auth, prefs, failure_count");
    if (options.onlyDeviceId) query = query.eq("device_id", options.onlyDeviceId);

    const { data, error } = await query;
    if (error) {
      console.error("[push] No se pudieron leer las suscripciones:", error.message);
      return emptyResult({
        configured: true,
        failed: 1,
        errors: [{ host: "base-de-datos", status: null, message: "No se pudieron leer las suscripciones" }],
      });
    }

    const targets = ((data ?? []) as SubscriptionRow[]).filter(
      (s) =>
        wantsCategory(s.prefs, options.category) &&
        !(options.excludeDeviceId && s.device_id === options.excludeDeviceId)
    );

    const result = emptyResult({ configured: true, attempted: targets.length });
    const now = new Date().toISOString();

    await Promise.all(
      targets.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60, urgency: "normal" }
          );
          result.accepted++;
          await supabase
            .from("push_subscriptions")
            .update({ last_success_at: now, failure_count: 0 })
            .eq("id", s.id);
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode ?? null;
          const host = hostOf(s.endpoint);
          if (status === 404 || status === 410) {
            // La suscripcion ya no existe (se desinstalo la app o se revoco el permiso).
            result.expired++;
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
            console.warn(`[push] Suscripción caducada eliminada (${host}, HTTP ${status}).`);
            return;
          }
          result.failed++;
          const message = status ? `El servicio push respondió HTTP ${status}` : "Error de red o de configuración";
          result.errors.push({ host, status, message });
          console.error(`[push] Envío rechazado (${host}, HTTP ${status ?? "sin respuesta"}).`);
          await supabase
            .from("push_subscriptions")
            .update({
              last_error_at: now,
              last_error_status: status,
              failure_count: (s.failure_count ?? 0) + 1,
            })
            .eq("id", s.id);
        }
      })
    );

    return result;
  } catch (error) {
    console.error("[push] Error inesperado:", error instanceof Error ? error.message : "desconocido");
    return emptyResult({
      configured: true,
      failed: 1,
      errors: [{ host: "servidor", status: null, message: "Error inesperado al enviar" }],
    });
  }
}
