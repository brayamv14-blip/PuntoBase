/**
 * Service Worker personalizado (next-pwa lo fusiona con el generado por Workbox).
 *  - Background Sync API: al volver la red se vacia la cola de IndexedDB aunque la app este cerrada.
 *  - Push API: muestra las notificaciones enviadas por el servidor y abre la app al tocarlas.
 */
import { flushQueue } from "../lib/offline-queue";
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
  };
  clients: {
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  location: { origin: string };
}

const sw = self as unknown as WorkerScope;

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
