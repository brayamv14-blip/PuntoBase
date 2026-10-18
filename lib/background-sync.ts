/**
 * Background Sync API: pide al navegador que despierte al Service Worker
 * cuando vuelva la red para vaciar la cola, aunque la app este cerrada.
 * Solo Chromium (Chrome/Edge/Android) lo soporta; en Safari y Firefox
 * se usa el respaldo: evento "online" + boton "Sincronizar ahora".
 */
export const SYNC_TAG = "puntobase-sync";
export const SYNC_DONE_MESSAGE = "PUNTOBASE_SYNC_DONE";

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

export async function requestBackgroundSync(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return false;
    }
    const registration = (await navigator.serviceWorker.ready) as SyncRegistration;
    if (!registration.sync) return false;
    await registration.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

/**
 * Evita que la pagina y el Service Worker vacien la cola al mismo tiempo.
 * Si Web Locks no existe, ejecuta la tarea directamente.
 */
export async function withFlushLock<T>(task: () => Promise<T>): Promise<T | undefined> {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;

  if (!locks) return task();

  return locks.request("puntobase-flush", { ifAvailable: true }, async (lock) => {
    if (!lock) return undefined;
    return task();
  });
}
