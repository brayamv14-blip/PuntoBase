import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prueba de conflicto entre DOS dispositivos que editan sin conexion el mismo producto.
 * Simulado: un servidor en memoria + IndexedDB falso; el "dispositivo B" es una segunda cola que se
 * sincroniza despues de que A ya cambio el servidor. NO usa dos telefonos reales.
 */
const srv = {
  product: { id: "p1", name: "Playera", barcode: null as string | null, category_id: null as string | null, low_stock_threshold: 3 },
  variant: { id: "v1", price: 100, stock: 10 },
  adjustments: new Map<string, number>(),
};

function installServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
      if (path === "/api/products" && method === "GET") {
        return json([{ ...srv.product, variants: [{ id: "v1", size_label: "", price: srv.variant.price }] }]);
      }
      if (path === "/api/products/p1" && method === "PUT") {
        Object.assign(srv.product, body);
        return json({ ok: true });
      }
      if (path === "/api/products/p1/variants/v1" && method === "PUT") {
        srv.variant.price = Number(body.price);
        return json({ ok: true });
      }
      if (path === "/api/stock/adjust") {
        if (!srv.adjustments.has(body.client_op_id)) {
          srv.adjustments.set(body.client_op_id, body.qty_change);
          srv.variant.stock += body.qty_change;
        }
        return json({ stock_qty: srv.variant.stock });
      }
      return json({ error: "not found" }, 404);
    })
  );
}

async function app() {
  const db = await (await import("@/lib/db")).openDb();
  db.close();
  vi.resetModules();
  return { queue: await import("@/lib/offline-queue"), ops: await import("@/lib/offline-ops") };
}

const base = { name: "Playera", category_id: null, barcode: null, price: 100, low_stock_threshold: 3 };

beforeEach(async () => {
  srv.product = { id: "p1", name: "Playera", barcode: null, category_id: null, low_stock_threshold: 3 };
  srv.variant = { id: "v1", price: 100, stock: 10 };
  srv.adjustments.clear();
  vi.stubGlobal("navigator", { onLine: true });
  installServer();
  const a = await app();
  const db = await (await import("@/lib/db")).openDb();
  await Promise.all(db.tables.map((t) => t.clear()));
  void a;
});

describe("Conflicto entre dos dispositivos (simulado)", () => {
  it("la ultima escritura gana, B recibe un aviso con los campos en conflicto y el inventario suma ambos ajustes", async () => {
    // Dispositivo A (sin conexion): cambia precio y suma 5 piezas.
    const a = await app();
    await a.ops.enqueueOp("update_product", {
      product_id: "p1", product_name: "Playera", base,
      product: { name: "Playera" },
      variant: { id: "v1", price: 120, low_stock_threshold: 3 },
      stock: { variant_id: "v1", qty_change: 5, note: null },
    });
    await a.queue.flushQueue(() => {}, () => {}); // A se reconecta primero
    expect(srv.variant.price).toBe(120);
    expect(srv.variant.stock).toBe(15);
    expect(await a.ops.takeNotices()).toEqual([]); // sin conflicto

    // Dispositivo B (estuvo sin conexion con la base vieja): cambia nombre y precio, resta 2 piezas.
    const b = await app();
    await b.ops.enqueueOp("update_product", {
      product_id: "p1", product_name: "Playera", base,
      product: { name: "Playera Pro" },
      variant: { id: "v1", price: 110, low_stock_threshold: 3 },
      stock: { variant_id: "v1", qty_change: -2, note: null },
    });
    await b.queue.flushQueue(() => {}, () => {});

    const notices = await b.ops.takeNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("precio");
    expect(notices[0]).toContain("última escritura gana");
    expect(srv.product.name).toBe("Playera Pro");
    expect(srv.variant.price).toBe(110); // gano B (ultima escritura)
    expect(srv.variant.stock).toBe(13); // +5 y -2: los ajustes son relativos, no se pisan
    expect(await b.ops.countPendingOps()).toBe(0);
  });

  it("sin cambios del otro dispositivo no hay aviso", async () => {
    const b = await app();
    await b.ops.enqueueOp("update_product", {
      product_id: "p1", product_name: "Playera", base,
      product: { name: "Playera 2" },
    });
    await b.queue.flushQueue(() => {}, () => {});
    expect(await b.ops.takeNotices()).toEqual([]);
  });

  it("si el producto fue eliminado por el otro dispositivo, el cambio se descarta con aviso", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response(JSON.stringify([])));
    const b = await app();
    await b.ops.enqueueOp("update_product", { product_id: "p1", product_name: "Playera", base, product: { name: "X" } });
    await b.queue.flushQueue(() => {}, () => {});
    const notices = await b.ops.takeNotices();
    expect(notices[0]).toContain("ya no existe");
    expect(await b.ops.countPendingOps()).toBe(0);
  });
});
