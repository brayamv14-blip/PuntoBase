
import { openDB, type IDBPDatabase } from "idb";
import { apiFetch } from "./api";
import { requestBackgroundSync, withFlushLock } from "./background-sync";
import { flushOps } from "./offline-ops";
import {
  getAllLocalSales,
  markLocalSaleSynced,
} from "./local-sales";
import type { CreateSaleRequest } from "@/types";

const DB_NAME = "pos-offline";
const DB_VERSION = 1;
const STORE = "pending_sales";

export interface PendingSale {
  localId: string;
  payload: CreateSaleRequest;
  createdAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
let isFlushing = false;

async function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, {
            keyPath: "localId",
          });
        }
      },
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

export async function enqueueSale(
  payload: CreateSaleRequest,
  existingLocalId?: string
): Promise<string> {
  const db = await getDB();

  const localId =
    existingLocalId ?? `LOCAL-${crypto.randomUUID()}`;

  const entry: PendingSale = {
    localId,
    payload,
    createdAt: new Date().toISOString(),
  };

  await db.put(STORE, entry);

  // Background Sync: el Service Worker sincroniza al volver la red.
  void requestBackgroundSync();

  return localId;
}

export async function getPendingSales(): Promise<PendingSale[]> {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function deletePendingSale(
  localId: string
): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, localId);
}

/**
 * Reconstruye la cola con ventas que siguen guardadas localmente
 * y cuyo estado es pending.
 *
 * No borra ventas de IndexedDB.
 */
export async function restorePendingSalesFromLocalStorage(): Promise<number> {
  const localSales = await getAllLocalSales();
  const pendingSales = await getPendingSales();

  const pendingIds = new Set(
    pendingSales.map((entry) => entry.localId)
  );

  let restored = 0;

  for (const sale of localSales) {
    if (sale.local_status !== "pending") {
      continue;
    }

    if (pendingIds.has(sale.id)) {
      continue;
    }

    const payload: CreateSaleRequest = {
      items: sale.items.map((item) => ({
        item_type: item.item_type,
        product_id: item.product_id ?? undefined,
        variant_id: item.variant_id ?? undefined,
        description: item.description,
        unit_price: Number(item.unit_price),
        qty: Number(item.qty),
      })),
      customer_id: sale.customer_id ?? undefined,
      customer_name: sale.customer_id
        ? undefined
        : sale.customer?.name ?? undefined,
      customer_phone: sale.customer_id
        ? undefined
        : sale.customer?.phone ?? undefined,
      discount_type: sale.discount_type ?? undefined,
      discount_value: Number(sale.discount_value ?? 0),
      payment_method: sale.payment_method,
      notes: sale.notes ?? undefined,
    };

    await enqueueSale(payload, sale.id);

    pendingIds.add(sale.id);
    restored++;
  }

  return restored;
}

/**
 * Envía las ventas pendientes al servidor.
 *
 * Solo elimina una entrada de la cola cuando la API confirma
 * que la venta existe en el servidor.
 */
async function flushQueueUnlocked(
  onSuccess: (localId: string, saleId: string) => void,
  onError: (localId: string, error: string) => void
): Promise<void> {
  if (isFlushing || !navigator.onLine) {
    return;
  }

  isFlushing = true;

  try {
    // 1) Altas y ediciones de producto pendientes (las ventas pueden depender de ellas).
    await flushOps(["create_product", "update_product"], undefined, (op, message) =>
      onError(op.id, message)
    );

    const pending = await getPendingSales();

    for (const entry of pending) {
      if (!navigator.onLine) {
        break;
      }

      try {
        const response = await apiFetch("/api/sales", {
          method: "POST",
          body: JSON.stringify({
            ...entry.payload,
            client_sale_id: entry.localId,
          }),
        });

        let data: {
          id?: string;
          error?: string;
          duplicate?: boolean;
        };

        try {
          data = await response.json();
        } catch {
          onError(
            entry.localId,
            "El servidor devolvió una respuesta que no se pudo leer."
          );
          continue;
        }

        if (!response.ok || !data.id) {
          onError(
            entry.localId,
            data.error ??
              `No se pudo sincronizar la venta (HTTP ${response.status}).`
          );
          continue;
        }

        // Actualizar primero el registro local.
        // Si esto falla, la entrada sigue en la cola para reintentar.
        await markLocalSaleSynced(entry.localId, data.id);

        // Solo quitar de la cola después de actualizar IndexedDB.
        await deletePendingSale(entry.localId);

        onSuccess(entry.localId, data.id);
      } catch (error) {
        console.error(
          `[offline-queue] Error sincronizando ${entry.localId}:`,
          error
        );

        onError(
          entry.localId,
          "Error de conexión o almacenamiento. La venta permanece pendiente."
        );
      }
    }

    // 3) Cortes de caja al final, cuando ya estan sincronizadas todas las ventas.
    await flushOps(["close_cash_register"], undefined, (op, message) =>
      onError(op.id, message)
    );
  } finally {
    isFlushing = false;
  }
}

/**
 * Vacia la cola (productos, ventas y corte de caja). Segura para llamarse
 * desde la pagina y desde el Service Worker a la vez gracias a Web Locks.
 */
export async function flushQueue(
  onSuccess: (localId: string, saleId: string) => void,
  onError: (localId: string, error: string) => void
): Promise<void> {
  await withFlushLock(() => flushQueueUnlocked(onSuccess, onError));
}
