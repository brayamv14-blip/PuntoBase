
import { openDb } from "./db";
import { apiFetch } from "./api";
import { requestBackgroundSync, withFlushLock } from "./background-sync";
import { flushOps, getFailedOps, clearOpErrors, type FailedOp } from "./offline-ops";
import {
  getAllLocalSales,
  getLocalSale,
  markLocalSaleSynced,
  saveLocalSale,
} from "./local-sales";
import type { CreateSaleRequest } from "@/types";

export interface PendingSale {
  localId: string;
  payload: CreateSaleRequest;
  createdAt: string;
  /** Intentos que el servidor respondio con error (no cuenta las caidas de red). */
  attempts?: number;
  lastError?: string;
  /** No reintentar antes de esta fecha (espera creciente tras errores del servidor). */
  nextAttemptAt?: string;
  /** El servidor rechazo la venta de forma definitiva (error 4xx): requiere decision del usuario. */
  failed?: boolean;
}

const MAX_BACKOFF_MS = 30 * 60 * 1000;

/** Espera antes del siguiente intento: 30 s, 1 min, 2 min... hasta 30 min. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/** true si el codigo HTTP es un error definitivo de la venta (no se arregla reintentando). */
export function isPermanentSaleError(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status);
}

let isFlushing = false;

export async function enqueueSale(
  payload: CreateSaleRequest,
  existingLocalId?: string
): Promise<string> {
  const db = await openDb();

  const localId =
    existingLocalId ?? `LOCAL-${crypto.randomUUID()}`;

  const entry: PendingSale = {
    localId,
    payload,
    createdAt: new Date().toISOString(),
  };

  await db.pending_sales.put(entry);

  // Background Sync: el Service Worker sincroniza al volver la red.
  void requestBackgroundSync();

  return localId;
}

export async function getPendingSales(): Promise<PendingSale[]> {
  const db = await openDb();
  return db.pending_sales.toArray();
}

export async function deletePendingSale(
  localId: string
): Promise<void> {
  const db = await openDb();
  await db.pending_sales.delete(localId);
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
      created_at: sale.created_at,
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
  onError: (localId: string, error: string) => void,
  force = false
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

    const pending = (await getPendingSales()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    const db = await openDb();

    for (const entry of pending) {
      if (!navigator.onLine) {
        break;
      }

      // Ventas rechazadas de forma definitiva o en espera de reintento.
      if (!force) {
        if (entry.failed) continue;
        if (entry.nextAttemptAt && entry.nextAttemptAt > new Date().toISOString()) continue;
      }

      try {
        const response = await apiFetch("/api/sales", {
          method: "POST",
          body: JSON.stringify({
            ...entry.payload,
            // La venta conserva la fecha en que ocurrio, no la de la sincronizacion.
            created_at: entry.payload.created_at ?? entry.createdAt,
            client_sale_id: entry.localId,
          }),
        });

        let data: {
          id?: string;
          error?: string;
          duplicate?: boolean;
        } = {};

        try {
          data = await response.json();
        } catch {
          data = {};
        }

        if (response.ok && data.id) {
          // Actualizar primero el registro local.
          // Si esto falla, la entrada sigue en la cola para reintentar (el servidor es idempotente).
          await markLocalSaleSynced(entry.localId, data.id);

          // Solo quitar de la cola después de actualizar IndexedDB.
          await deletePendingSale(entry.localId);

          onSuccess(entry.localId, data.id);
          continue;
        }

        const message =
          data.error ?? `No se pudo sincronizar la venta (HTTP ${response.status}).`;
        const attempts = (entry.attempts ?? 0) + 1;
        const permanent = isPermanentSaleError(response.status);

        await db.pending_sales.put({
          ...entry,
          attempts,
          lastError: message,
          failed: permanent,
          nextAttemptAt: permanent
            ? undefined
            : new Date(Date.now() + backoffMs(attempts)).toISOString(),
        });
        onError(entry.localId, message);
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

/** Operaciones y ventas que el servidor rechazo y esperan una decision del usuario. */
export async function getFailedItems(): Promise<FailedOp[]> {
  const ops = await getFailedOps();
  const sales = (await getPendingSales())
    .filter((entry) => entry.failed)
    .map<FailedOp>((entry) => ({
      id: entry.localId,
      type: "sale",
      message: `Venta ${entry.localId.slice(-6)} rechazada: ${entry.lastError ?? "error desconocido"}`,
    }));
  return [...sales, ...ops];
}

/** Quita los errores guardados (ventas y operaciones) para reintentar desde cero. */
export async function clearQueueErrors(): Promise<void> {
  await clearOpErrors();
  const db = await openDb();
  for (const entry of await db.pending_sales.toArray()) {
    if (entry.failed || entry.lastError || entry.nextAttemptAt) {
      const { failed: _f, lastError: _l, nextAttemptAt: _n, ...rest } = entry;
      void _f;
      void _l;
      void _n;
      await db.pending_sales.put(rest);
    }
  }
}

/** Descarta una venta rechazada: sale de la cola y queda marcada como descartada en el historial local. */
export async function discardFailedSale(localId: string): Promise<void> {
  const sale = await getLocalSale(localId);
  if (sale) await saveLocalSale({ ...sale, local_status: "failed" });
  await deletePendingSale(localId);
}

/**
 * Vacia la cola (productos, ventas y corte de caja). Segura para llamarse
 * desde la pagina y desde el Service Worker a la vez gracias a Web Locks.
 */
export async function flushQueue(
  onSuccess: (localId: string, saleId: string) => void,
  onError: (localId: string, error: string) => void,
  options: { force?: boolean } = {}
): Promise<void> {
  await withFlushLock(() => flushQueueUnlocked(onSuccess, onError, options.force));
}
