import { openDB, type IDBPDatabase } from "idb";
import { apiFetch } from "./api";
import { requestBackgroundSync } from "./background-sync";

/**
 * Cola de operaciones que no son ventas y que se guardan primero en el
 * dispositivo: alta de productos y corte de caja.
 */
export type OfflineOpType = "create_product" | "close_cash_register";

export interface OfflineOp {
  id: string;
  type: OfflineOpType;
  payload: Record<string, unknown>;
  createdAt: string;
  lastError?: string;
}

const DB_NAME = "puntobase-offline-ops";
const DB_VERSION = 1;
const STORE = "ops";

const ENDPOINT: Record<OfflineOpType, string> = {
  create_product: "/api/products",
  close_cash_register: "/api/cash-register/close",
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export async function enqueueOp(
  type: OfflineOpType,
  payload: Record<string, unknown>
): Promise<string> {
  const db = await getDB();
  const op: OfflineOp = {
    id: `OP-${crypto.randomUUID()}`,
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
  await db.put(STORE, op);
  void requestBackgroundSync();
  return op.id;
}

export async function getPendingOps(): Promise<OfflineOp[]> {
  const db = await getDB();
  const ops = (await db.getAll(STORE)) as OfflineOp[];
  return ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPendingOps(): Promise<number> {
  const db = await getDB();
  return db.count(STORE);
}

/**
 * Envia al servidor las operaciones pendientes de los tipos indicados.
 * Solo se borra una operacion cuando la API responde con exito.
 */
export async function flushOps(
  types: OfflineOpType[],
  onSuccess?: (op: OfflineOp) => void,
  onError?: (op: OfflineOp, message: string) => void
): Promise<void> {
  const db = await getDB();
  const ops = (await getPendingOps()).filter((op) => types.includes(op.type));

  for (const op of ops) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;

    try {
      const response = await apiFetch(ENDPOINT[op.type], {
        method: "POST",
        body: JSON.stringify(op.payload),
      });

      if (response.ok) {
        await db.delete(STORE, op.id);
        onSuccess?.(op);
        continue;
      }

      let message = `Error HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data?.error) message = String(data.error);
      } catch {
        // respuesta sin JSON: se conserva el mensaje HTTP
      }
      await db.put(STORE, { ...op, lastError: message });
      onError?.(op, message);
    } catch {
      onError?.(op, "Error de conexión. La operación permanece pendiente.");
    }
  }
}
