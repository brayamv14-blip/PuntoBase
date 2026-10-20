/**
 * Service Worker personalizado (next-pwa lo fusiona con el generado por Workbox).
 *  - Background Sync API: al volver la red se vacia la cola de IndexedDB aunque la app este cerrada.
 *  - Push API: muestra las notificaciones enviadas por el servidor y abre la app al tocarlas.
 */
import { flushQueue, getFailedItems } from "../lib/offline-queue";
import { openDb } from "../lib/db";
import { SYNC_TAG, SYNC_DONE_MESSAGE } from "../lib/background-sync";

interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface SyncEventLike extends ExtendableEventLike {
  tag: string;
}
interface PushEventLike extends ExtendableEventLike {
  data: { json(): unknown; text(): string } | null;
}
interface NotificationClickEventLike extends ExtendableEventLike {
  notification: { close(): void; data?: { url?: string } };
}
interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
  postMessage(message: unknown): void;
}

interface WorkerScope {
  addEventListener(type: "sync", listener: (event: SyncEventLike) => void): void;
  addEventListener(type: "push", listener: (event: PushEventLike) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickEventLike) => void
  ): void;
  registration: {
    showNotification(title: string, options?: Record<string, unknown>): Promise<void>;
    pushManager: { getSubscription(): Promise<unknown | null> };
  };
  clients: {
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  location: { origin: string };
}

const sw = self as unknown as WorkerScope;

// ---------- Avisos locales de sincronizacion ----------
const SYNC_ALERT_FLAG = "sync_alert_active";

/**
 * Notificacion local (no depende del servidor) cuando la sincronizacion necesita intervencion
 * del usuario (el servidor rechazo una operacion) y cuando se recupera. Solo si el usuario
 * activo las notificaciones en este dispositivo.
 */
async function notifySyncState(): Promise<void> {
  try {
    if (!(await sw.registration.pushManager.getSubscription())) return;

    const db = await openDb();
    const failed = await getFailedItems();
    const active = await db.meta.get(SYNC_ALERT_FLAG);

    if (failed.length > 0 && !active) {
      await sw.registration.showNotification("Sincronización con errores", {
        body: `${failed.length} operación${failed.length === 1 ? "" : "es"} necesita${failed.length === 1 ? "" : "n"} tu revisión.`,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "sync-error",
        data: { url: "/dashboard" },
      });
      await db.meta.put({ key: SYNC_ALERT_FLAG, value: new Date().toISOString() });
    } else if (failed.length === 0 && active) {
      await sw.registration.showNotification("Sincronización recuperada", {
        body: "Las operaciones pendientes ya se sincronizaron.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "sync-error",
        data: { url: "/dashboard" },
      });
      await db.meta.delete(SYNC_ALERT_FLAG);
    }
  } catch (error) {
    console.error("[sw] No se pudo evaluar el aviso de sincronización:", error);
  }
}

// ---------- Background Sync ----------
async function runSync(): Promise<void> {
  let synced = 0;
  let failures = 0;

  await flushQueue(
    () => {
      synced++;
    },
    () => {
      failures++;
    }
  );

  await notifySyncState();

  const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    client.postMessage({ type: SYNC_DONE_MESSAGE, synced, failures });
  }

  // Si algo fallo, lanzar el error hace que el navegador reintente el sync.
  if (failures > 0) throw new Error("Sincronizacion incompleta");
}

sw.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(runSync());
  }
});

// ---------- Notificaciones push ----------
interface PushData {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

sw.addEventListener("push", (event) => {
  const data: PushData = { title: "PuntoBase", body: "", url: "/dashboard" };

  try {
    Object.assign(data, event.data?.json() ?? {});
  } catch {
    data.body = event.data?.text() ?? "";
  }

  event.waitUntil(
    sw.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url },
    })
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url ?? "/dashboard";
  const target = new URL(path, sw.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(sw.location.origin));

      if (open) {
        await open.focus();
        if (open.navigate) await open.navigate(target);
        return;
      }
      await sw.clients.openWindow(target);
    })()
  );
});
