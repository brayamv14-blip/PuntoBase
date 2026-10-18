import { openDB, type IDBPDatabase } from "idb";
import { apiFetch } from "./api";
import { requestBackgroundSync } from "./background-sync";

/**
 * Cola de operaciones que no son ventas y que se guardan primero en el
 * dispositivo: alta y edicion de productos, y corte de caja.
 *
 * Conflictos (limitante 3 del MVP): "Last Write Wins". Si el producto cambio en
 * otro dispositivo mientras este estaba sin conexion, se aplica de todos modos
 * el cambio local y se deja un aviso para el usuario (ver takeNotices).
 */
export type OfflineOpType =
  | "create_product"
  | "update_product"
  | "close_cash_register";

export interface OfflineOp {
  id: string;
  type: OfflineOpType;
  payload: Record<string, unknown>;
  createdAt: string;
  lastError?: string;
  /** Pasos de una operacion de varios pasos que ya se completaron (evita repetirlos). */
  done?: string[];
}

/** Carga de update_product: lo que el formulario necesita para repetir la edicion al reconectar. */
export interface UpdateProductPayload {
  product_id: string;
  product_name: string;
  /** Valores que se veian al empezar a editar; sirven para detectar cambios hechos en otro dispositivo. */
  base: {
    name: string;
    category_id: string | null;
    barcode: string | null;
    price: number | null;
    low_stock_threshold: number;
  };
  /** Cuerpo del PUT /api/products/:id */
  product: Record<string, unknown>;
  /** Cuerpo del PUT de la variante predeterminada (si el producto la tiene). */
  variant?: { id: string; price: number; low_stock_threshold: number };
  /** Ajuste de inventario relativo (+/-), asi no pisa las ventas hechas mientras tanto. */
  stock?: { variant_id: string; qty_change: number; note: string | null };
}

export interface FailedOp {
  id: string;
  type: OfflineOpType;
  message: string;
}

const DB_NAME = "puntobase-offline-ops";
const DB_VERSION = 2;
const STORE = "ops";
const NOTICES = "notices";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(NOTICES)) {
          db.createObjectStore(NOTICES, { keyPath: "id" });
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
  const id = `OP-${crypto.randomUUID()}`;
  const op: OfflineOp = {
    id,
    type,
    // client_id hace idempotente el alta: si se reenvia, el servidor devuelve el mismo producto.
    payload: type === "create_product" ? { ...payload, client_id: id } : payload,
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

/** Operaciones que el servidor rechazo (se quedan en cola hasta reintentar o descartar). */
export async function getFailedOps(): Promise<FailedOp[]> {
  const ops = await getPendingOps();
  return ops
    .filter((op) => !!op.lastError)
    .map((op) => ({ id: op.id, type: op.type, message: op.lastError as string }));
}

export async function discardOp(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

/** Quita el error guardado para que la operacion se reintente limpia. */
export async function clearOpErrors(): Promise<void> {
  const db = await getDB();
  const ops = (await db.getAll(STORE)) as OfflineOp[];
  for (const op of ops) {
    if (op.lastError) {
      const { lastError: _ignored, ...rest } = op;
      void _ignored;
      await db.put(STORE, rest);
    }
  }
}

// ─── Avisos (por ejemplo, "se sobrescribio un cambio de otro dispositivo") ────

async function addNotice(message: string): Promise<void> {
  const db = await getDB();
  await db.put(NOTICES, {
    id: `N-${crypto.randomUUID()}`,
    message,
    createdAt: new Date().toISOString(),
  });
}

/** Devuelve y borra los avisos pendientes de mostrar al usuario. */
export async function takeNotices(): Promise<string[]> {
  const db = await getDB();
  const all = (await db.getAll(NOTICES)) as {
    id: string;
    message: string;
    createdAt: string;
  }[];
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const n of all) await db.delete(NOTICES, n.id);
  return all.map((n) => n.message);
}

// ─── Envio al servidor ───────────────────────────────────────────────────────

async function responseError(response: Response): Promise<string> {
  let message = `Error HTTP ${response.status}`;
  try {
    const data = await response.json();
    if (data?.error) message = String(data.error);
  } catch {
    // respuesta sin JSON: se conserva el mensaje HTTP
  }
  return message;
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  return apiFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type ServerProduct = {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string | null;
  low_stock_threshold: number;
  variants?: { id: string; size_label: string; price: number | string }[];
};

/** Lista los campos que otro dispositivo cambio mientras este editaba sin conexion. */
function detectConflicts(server: ServerProduct, payload: UpdateProductPayload): string[] {
  const { base } = payload;
  const changed: string[] = [];
  if (server.name !== base.name) changed.push("nombre");
  if ((server.category_id ?? null) !== base.category_id) changed.push("categoría");
  if ((server.barcode ?? null) !== base.barcode) changed.push("código de barras");
  if (Number(server.low_stock_threshold) !== Number(base.low_stock_threshold)) {
    changed.push("mínimo de inventario");
  }
  if (payload.variant) {
    const variant = server.variants?.find((v) => v.id === payload.variant!.id);
    if (variant && base.price != null && Number(variant.price) !== Number(base.price)) {
      changed.push("precio");
    }
  }
  return changed;
}

/** Ejecuta update_product por pasos; cada paso terminado se guarda para no repetirlo si falla uno posterior. */
async function runUpdateProduct(
  db: IDBPDatabase,
  op: OfflineOp
): Promise<{ discarded?: boolean }> {
  const payload = op.payload as unknown as UpdateProductPayload;
  const done = new Set(op.done ?? []);
  const mark = async (step: string) => {
    done.add(step);
    await db.put(STORE, { ...op, done: [...done], lastError: undefined });
  };

  if (!done.has("check")) {
    const listRes = await send("/api/products", "GET");
    if (!listRes.ok) throw new Error(await responseError(listRes));
    const list = (await listRes.json()) as ServerProduct[];
    const server = list.find((p) => p.id === payload.product_id);

    if (!server) {
      await addNotice(
        `"${payload.product_name}" ya no existe en el servidor; se descartó el cambio hecho sin conexión.`
      );
      return { discarded: true };
    }

    const conflicts = detectConflicts(server, payload);
    if (conflicts.length > 0) {
      await addNotice(
        `"${payload.product_name}": otro dispositivo cambió ${conflicts.join(", ")}. Se aplicó tu cambio (la última escritura gana).`
      );
    }
    await mark("check");
  }

  if (!done.has("product")) {
    const res = await send(`/api/products/${payload.product_id}`, "PUT", payload.product);
    if (!res.ok) throw new Error(await responseError(res));
    await mark("product");
  }

  if (payload.variant && !done.has("variant")) {
    const res = await send(
      `/api/products/${payload.product_id}/variants/${payload.variant.id}`,
      "PUT",
      {
        size_label: "",
        price: payload.variant.price,
        low_stock_threshold: payload.variant.low_stock_threshold,
      }
    );
    if (!res.ok) throw new Error(await responseError(res));
    await mark("variant");
  }

  if (payload.stock && !done.has("stock")) {
    const res = await send("/api/stock/adjust", "POST", {
      product_id: payload.product_id,
      variant_id: payload.stock.variant_id,
      qty_change: payload.stock.qty_change,
      note: payload.stock.note,
    });
    if (!res.ok) throw new Error(await responseError(res));
    await mark("stock");
  }

  return {};
}

async function runSimpleOp(op: OfflineOp): Promise<void> {
  const path = op.type === "create_product" ? "/api/products" : "/api/cash-register/close";
  const res = await send(path, "POST", op.payload);
  if (!res.ok) throw new Error(await responseError(res));
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
      if (op.type === "update_product") {
        await runUpdateProduct(db, op);
      } else {
        await runSimpleOp(op);
      }
      await db.delete(STORE, op.id);
      onSuccess?.(op);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const isNetwork = error instanceof TypeError; // fetch sin red
      if (isNetwork) {
        onError?.(op, "Error de conexión. La operación permanece pendiente.");
        continue;
      }
      const message = raw || "No se pudo sincronizar la operación.";
      const current = ((await db.get(STORE, op.id)) as OfflineOp | undefined) ?? op;
      await db.put(STORE, { ...current, lastError: message });
      onError?.(op, message);
    }
  }
}
