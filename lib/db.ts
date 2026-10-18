import Dexie, { type Table } from "dexie";
import type { Category, ProductWithVariants } from "@/types";
import type { LocalSale } from "./local-sales";
import type { PendingSale } from "./offline-queue";
import type { OfflineOp } from "./offline-ops";

/** Fila guardada con su posicion para conservar el orden que mando el servidor. */
export type Positioned<T> = T & { __pos: number };

export interface OfflineNotice {
  id: string;
  message: string;
  createdAt: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Base de datos local de PuntoBase (IndexedDB administrado con Dexie.js).
 *  - products / categories : catalogo e inventario para trabajar sin conexion
 *  - local_sales           : historial de ventas hechas en este dispositivo
 *  - pending_sales         : cola de ventas por sincronizar
 *  - pending_ops           : cola de altas/ediciones de producto y cortes de caja
 *  - notices / meta        : avisos al usuario y marcas internas
 */
export class PuntoBaseDB extends Dexie {
  products!: Table<Positioned<ProductWithVariants>, string>;
  categories!: Table<Positioned<Category>, string>;
  local_sales!: Table<LocalSale, string>;
  pending_sales!: Table<PendingSale, string>;
  pending_ops!: Table<OfflineOp, string>;
  notices!: Table<OfflineNotice, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("puntobase");
    this.version(1).stores({
      products: "id, category_id, barcode",
      categories: "id",
      local_sales: "id, local_status, created_at",
      pending_sales: "localId, createdAt",
      pending_ops: "id, type, createdAt",
      notices: "id",
      meta: "key",
    });
  }
}

// ─── Migracion unica desde las bases IndexedDB anteriores (libreria idb) ─────

const LEGACY_FLAG = "legacy_migrated";

/** Lee todos los valores de las tiendas indicadas; devuelve null si la base no existe. */
function readLegacy(name: string, stores: string[]): Promise<Record<string, unknown[]> | null> {
  return new Promise((resolve) => {
    let existed = true;
    const request = indexedDB.open(name);

    request.onupgradeneeded = () => {
      // La base no existia: se aborta para no crearla vacia.
      existed = false;
      request.transaction?.abort();
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const legacy = request.result;
      if (!existed) {
        legacy.close();
        return resolve(null);
      }

      const present = stores.filter((s) => legacy.objectStoreNames.contains(s));
      if (present.length === 0) {
        legacy.close();
        return resolve(null);
      }

      const out: Record<string, unknown[]> = {};
      const tx = legacy.transaction(present, "readonly");
      for (const store of present) {
        const all = tx.objectStore(store).getAll();
        all.onsuccess = () => {
          out[store] = all.result;
        };
      }
      tx.oncomplete = () => {
        legacy.close();
        resolve(out);
      };
      tx.onerror = tx.onabort = () => {
        legacy.close();
        resolve(null);
      };
    };
  });
}

function deleteLegacy(name: string) {
  try {
    indexedDB.deleteDatabase(name);
  } catch {
    // mejor esfuerzo
  }
}

async function migrateLegacy(db: PuntoBaseDB): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  if (await db.meta.get(LEGACY_FLAG)) return;

  const queue = await readLegacy("pos-offline", ["pending_sales"]);
  const sales = await readLegacy("puntobase-local-sales", ["sales"]);
  const ops = await readLegacy("puntobase-offline-ops", ["ops", "notices"]);
  const catalog = await readLegacy("puntobase-catalog-cache", ["products", "categories"]);

  const asRows = <T>(rows: unknown[] | undefined): T[] => (Array.isArray(rows) ? (rows as T[]) : []);
  const position = <T>(rows: T[]): Positioned<T>[] => rows.map((r, i) => ({ ...r, __pos: i }));

  // El catalogo viejo guardaba UNA lista completa bajo la clave "latest".
  const oldProducts = asRows<ProductWithVariants[]>(catalog?.products)[0];
  const oldCategories = asRows<Category[]>(catalog?.categories)[0];

  await db.transaction(
    "rw",
    [db.pending_sales, db.local_sales, db.pending_ops, db.notices, db.products, db.categories, db.meta],
    async () => {
      await db.pending_sales.bulkPut(asRows<PendingSale>(queue?.pending_sales));
      await db.local_sales.bulkPut(asRows<LocalSale>(sales?.sales));
      await db.pending_ops.bulkPut(asRows<OfflineOp>(ops?.ops));
      await db.notices.bulkPut(asRows<OfflineNotice>(ops?.notices));

      // No pisar un catalogo mas nuevo si ya se guardo uno con Dexie.
      if (!(await db.meta.get("products_cached_at")) && Array.isArray(oldProducts)) {
        await db.products.bulkPut(position(oldProducts));
        await db.meta.put({ key: "products_cached_at", value: new Date().toISOString() });
      }
      if (!(await db.meta.get("categories_cached_at")) && Array.isArray(oldCategories)) {
        await db.categories.bulkPut(position(oldCategories));
        await db.meta.put({ key: "categories_cached_at", value: new Date().toISOString() });
      }

      await db.meta.put({ key: LEGACY_FLAG, value: new Date().toISOString() });
    }
  );

  for (const name of [
    "pos-offline",
    "puntobase-local-sales",
    "puntobase-offline-ops",
    "puntobase-catalog-cache",
  ]) {
    deleteLegacy(name);
  }
}

let dbPromise: Promise<PuntoBaseDB> | null = null;

/** Abre (una sola vez) la base local y, si hace falta, importa los datos de la version anterior. */
export function openDb(): Promise<PuntoBaseDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = new PuntoBaseDB();
      await db.open();
      try {
        await migrateLegacy(db);
      } catch (error) {
        console.error("[db] No se pudo importar la base anterior:", error);
      }
      return db;
    })().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}
