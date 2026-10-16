
import { openDB, type IDBPDatabase } from "idb";
import type {
  CreateSaleRequest,
  Customer,
  Sale,
  SaleItem,
} from "@/types";

export type LocalSale = Sale & {
  items: SaleItem[];
  customer: Customer | null;
  device: null;
  local_status: "pending" | "synced";
  server_sale_id: string | null;
};

const DB_NAME = "puntobase-local-sales";
const DB_VERSION = 1;
const STORE = "sales";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, {
            keyPath: "id",
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

export async function saveLocalSale(
  sale: LocalSale
): Promise<void> {
  const db = await getDB();
  await db.put(STORE, sale);
}

export async function getLocalSale(
  id: string
): Promise<LocalSale | undefined> {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function getAllLocalSales(): Promise<LocalSale[]> {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function createLocalSaleSnapshot(
  localId: string,
  payload: CreateSaleRequest,
  subtotal: number,
  total: number,
  createdAt = new Date().toISOString()
): Promise<LocalSale> {
  const discountType = payload.discount_type ?? null;
  const discountValue = Number(payload.discount_value ?? 0);

  const customer: Customer | null = payload.customer_id
    ? null
    : payload.customer_name?.trim()
      ? {
          id: `LOCAL-CUSTOMER-${localId}`,
          name: payload.customer_name.trim(),
          phone: payload.customer_phone?.trim() || null,
          created_at: createdAt,
        }
      : null;

  const items: SaleItem[] = payload.items.map((item, index) => ({
    id: `${localId}-ITEM-${index + 1}`,
    sale_id: localId,
    item_type: item.item_type,
    product_id: item.product_id ?? null,
    variant_id: item.variant_id ?? null,
    description: item.description,
    unit_price: Number(item.unit_price),
    qty: Number(item.qty),
    line_total: Number(
      (Number(item.unit_price) * Number(item.qty)).toFixed(2)
    ),
    refunded_qty: 0,
  }));

  const sale: LocalSale = {
    id: localId,
    sale_number: localId,
    device_id: null,
    customer_id: payload.customer_id ?? null,
    discount_type: discountType,
    discount_value: discountValue,
    subtotal: Number(subtotal),
    total: Number(total),
    payment_method: payload.payment_method,
    payment_status:
      payload.payment_method === "cash" ? "paid" : "pending",
    paid_at:
      payload.payment_method === "cash" ? createdAt : null,
    notes: payload.notes?.trim() || null,
    created_at: createdAt,
    items,
    customer,
    device: null,
    local_status: "pending",
    server_sale_id: null,
  };

  await saveLocalSale(sale);
  return sale;
}

export async function markLocalSaleSynced(
  localId: string,
  serverSaleId: string
): Promise<void> {
  const sale = await getLocalSale(localId);
  if (!sale) return;

  await saveLocalSale({
    ...sale,
    local_status: "synced",
    server_sale_id: serverSaleId,
  });
}
