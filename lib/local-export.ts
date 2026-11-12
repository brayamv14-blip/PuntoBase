import { openDb } from "@/lib/db";

export interface LocalStorageStats {
  products: number;
  categories: number;
  localSales: number;
  pendingSales: number;
  pendingOps: number;
}

/** Cuenta lo que hay guardado en este dispositivo (IndexedDB). */
export async function getLocalStats(): Promise<LocalStorageStats> {
  const db = await openDb();
  const [products, categories, localSales, pendingSales, pendingOps] = await Promise.all([
    db.products.count(),
    db.categories.count(),
    db.local_sales.count(),
    db.pending_sales.count(),
    db.pending_ops.count(),
  ]);
  return { products, categories, localSales, pendingSales, pendingOps };
}

/**
 * Copia de seguridad de lo que AUN NO llega al servidor (ventas y operaciones pendientes).
 * Sirve si el telefono se va a perder o a reiniciar con ventas sin sincronizar.
 * No incluye codigos de acceso ni datos de sesion.
 */
export async function exportPendingData(now: Date = new Date()) {
  const db = await openDb();
  const [pendingSales, pendingOps] = await Promise.all([db.pending_sales.toArray(), db.pending_ops.toArray()]);
  return {
    app: "PuntoBase",
    kind: "pendientes-sin-sincronizar",
    exportedAt: now.toISOString(),
    counts: { pendingSales: pendingSales.length, pendingOps: pendingOps.length },
    pendingSales,
    pendingOps,
  };
}

/**
 * Borra SOLO las cachés del navegador (pantallas, fotos). Nunca toca IndexedDB:
 * las ventas pendientes y el catalogo local se conservan.
 */
export async function clearBrowserCaches(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const names = await caches.keys();
  await Promise.all(names.map((n) => caches.delete(n)));
  return names.length;
}
