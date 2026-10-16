import { openDB, type IDBPDatabase } from "idb";
import { apiFetch } from "./api";
import type { CreateSaleRequest } from "@/types";

const DB_NAME = "pos-offline";
const DB_VERSION = 1;
const STORE = "pending_sales";

export interface PendingSale {
  localId: string;
  payload: CreateSaleRequest;
  createdAt: string;
}

let _db: IDBPDatabase | null = null;
let isFlushing = false;

async function getDB() {
  if (!_db) {
    _db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "localId" });
        }
      },
    });
  }

  return _db;
}

export async function enqueueSale(
  payload: CreateSaleRequest,
  existingLocalId?: string
): Promise<string> {
  const db = await getDB();
  const localId = existingLocalId ?? `LOCAL-${crypto.randomUUID()}`;

  const entry: PendingSale = {
    localId,
    payload,
    createdAt: new Date().toISOString(),
  };

  await db.put(STORE, entry);
  return localId;
}

export async function getPendingSales(): Promise<PendingSale[]> {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function deletePendingSale(localId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, localId);
}

export async function flushQueue(
  onSuccess: (localId: string, saleId: string) => void,
  onError: (localId: string, error: string) => void
): Promise<void> {
  if (isFlushing || !navigator.onLine) return;

  isFlushing = true;

  try {
    const pending = await getPendingSales();

    for (const entry of pending) {
      if (!navigator.onLine) break;

      try {
        const res = await apiFetch("/api/sales", {
          method: "POST",
          body: JSON.stringify({
            ...entry.payload,
            client_sale_id: entry.localId,
          }),
        });

        const data = await res.json();

        if (res.ok && data.id) {
          await deletePendingSale(entry.localId);
          onSuccess(entry.localId, data.id);
        } else {
          onError(
            entry.localId,
            data.error ?? "No se pudo sincronizar la venta."
          );
        }
      } catch {
        onError(
          entry.localId,
          "Error de conexión durante la sincronización."
        );
      }
    }
  } finally {
    isFlushing = false;
  }
}