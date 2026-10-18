/**
 * Service Worker personalizado (next-pwa lo fusiona con el generado por Workbox).
 * Implementa la Background Sync API: cuando el dispositivo recupera la red,
 * el navegador dispara "sync" y se vacia la cola de IndexedDB sin abrir la app.
 */
import { flushQueue } from "../lib/offline-queue";
import { SYNC_TAG, SYNC_DONE_MESSAGE } from "../lib/background-sync";

interface SyncEventLike extends Event {
  tag: string;
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerScope {
  addEventListener(type: "sync", listener: (event: SyncEventLike) => void): void;
  clients: {
    matchAll(options?: {
      type?: string;
      includeUncontrolled?: boolean;
    }): Promise<{ postMessage(message: unknown): void }[]>;
  };
}

const sw = self as unknown as WorkerScope;

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

  const windows = await sw.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
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
