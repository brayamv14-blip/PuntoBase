import webpush from "web-push";
import { supabase } from "@/lib/supabase/server";

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta que se abre al tocar la notificacion. */
  url?: string;
  /** Misma etiqueta = la notificacion nueva reemplaza a la anterior. */
  tag?: string;
}

let configured = false;

/** Devuelve false si faltan las llaves VAPID (las notificaciones quedan desactivadas). */
export function isPushConfigured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:admin@puntobase.local",
      publicKey,
      privateKey
    );
    configured = true;
  }
  return true;
}

/** Envia una notificacion a todos los dispositivos suscritos. Nunca lanza errores. */
export async function sendPushToAll(payload: PushPayload): Promise<number> {
  if (!isPushConfigured()) return 0;

  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  const subscriptions = (data ?? []) as {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];

  let sent = 0;
  await Promise.all(
    subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 }
        );
        sent++;
      } catch (error) {
        // 404/410: la suscripcion ya no existe (se desinstalo la app o se revoco el permiso).
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    })
  );

  return sent;
}
