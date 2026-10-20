import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSaleRequest, ProductWithVariants } from "@/types";

/**
 * Simula la secuencia real de la guia (5.4) sobre IndexedDB (fake-indexeddb) y un servidor falso
 * con idempotencia por client_sale_id. NO prueba el navegador real ni el Service Worker.
 */
type ServerMode = "ok" | "down" | "http500" | "http400" | "lost-response";

const server = {
  mode: "ok" as ServerMode,
  sales: new Map<string, { id: string; body: Record<string, unknown> }>(),
  closes: new Map<string, Record<string, unknown>>(),
  requests: 0,
};

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      server.requests++;
      if (server.mode === "down") throw new TypeError("Failed to fetch");
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

      if (server.mode === "http500") return json({ error: "No se pudo procesar la venta." }, 500);
      if (server.mode === "http400") return json({ error: "No se encontró el producto." }, 404);

      if (path === "/api/sales") {
        const existing = server.sales.get(body.client_sale_id);
        if (existing) return json({ id: existing.id, duplicate: true });
        const id = `srv-${server.sales.size + 1}`;
        server.sales.set(body.client_sale_id, { id, body });
        if (server.mode === "lost-response") throw new TypeError("network lost after server processed");
        return json({ id }, 201);
      }
      if (path === "/api/cash-register/close") {
        server.closes.set(body.client_close_id, body);
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    })
  );
}

function setOnline(value: boolean) {
  vi.stubGlobal("navigator", { onLine: value });
}

const product = (): ProductWithVariants =>
  ({
    id: "p1",
    name: "Playera",
    track_stock: true,
    barcode: null,
    variants: [{ id: "v1", product_id: "p1", size_label: "", price: 100, stock_qty: 10, low_stock_threshold: 3 }],
  }) as unknown as ProductWithVariants;

const payload = (): CreateSaleRequest => ({
  items: [{ item_type: "product", product_id: "p1", variant_id: "v1", description: "Playera", unit_price: 100, qty: 2 }],
  payment_method: "cash",
});

/** "Cierra y vuelve a abrir la app": descarta los modulos y la conexion de Dexie; IndexedDB persiste. */
async function reopenApp() {
  const db = await (await import("@/lib/db")).openDb();
  db.close();
  vi.resetModules();
  return {
    db: await import("@/lib/db"),
    queue: await import("@/lib/offline-queue"),
    local: await import("@/lib/local-sales"),
    ops: await import("@/lib/offline-ops"),
    catalog: await import("@/lib/catalog-cache"),
    stock: await import("@/lib/offline-stock"),
  };
}

async function sellOffline(app: Awaited<ReturnType<typeof reopenApp>>, localId: string) {
  const createdAt = new Date().toISOString();
  const stamped = { ...payload(), created_at: createdAt };
  await app.local.createLocalSaleSnapshot(localId, stamped, 200, 200, createdAt);
  await app.queue.enqueueSale(stamped, localId);
  await app.stock.decrementCachedStock(stamped.items);
}

beforeEach(async () => {
  server.mode = "ok";
  server.sales.clear();
  server.closes.clear();
  server.requests = 0;
  installFetch();
  setOnline(true);
  const app = await reopenApp();
  const db = await app.db.openDb();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("Flujo offline-first de extremo a extremo", () => {
  it("venta sin internet -> persiste al reabrir -> sincroniza una sola vez con error temporal de servidor", async () => {
    let app = await reopenApp();

    // 1-2. Cargar productos con conexion y quedarse sin internet.
    await app.catalog.saveCachedProducts([product()]);
    setOnline(false);

    // 3. Registrar la venta offline (descuenta inventario local y comprobante).
    await sellOffline(app, "LOCAL-A");

    // 4. Historial, comprobante e inventario locales.
    const sales = await app.local.getAllLocalSales();
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ local_status: "pending", total: 200, payment_status: "paid" });
    expect(sales[0].items[0].description).toBe("Playera");
    expect((await app.catalog.getCachedProducts())![0].variants[0].stock_qty).toBe(8);
    expect(await app.queue.getPendingSales()).toHaveLength(1);

    // El intento de sincronizar sin red no pierde nada.
    await app.queue.flushQueue(() => {}, () => {});
    expect(server.requests).toBe(0);

    // 5-6. Cerrar y volver a abrir la aplicacion: todo sigue ahi.
    app = await reopenApp();
    expect(await app.local.getAllLocalSales()).toHaveLength(1);
    expect(await app.queue.getPendingSales()).toHaveLength(1);
    expect((await app.catalog.getCachedProducts())![0].variants[0].stock_qty).toBe(8);

    // 7. Vuelve internet, pero el servidor responde 500 (error temporal).
    setOnline(true);
    server.mode = "http500";
    const errors: string[] = [];
    await app.queue.flushQueue(() => {}, (_id, message) => errors.push(message));
    expect(errors).toHaveLength(1);
    expect(server.sales.size).toBe(0);
    const [pending] = await app.queue.getPendingSales();
    expect(pending.attempts).toBe(1);
    expect(pending.failed).toBeFalsy();
    expect(pending.nextAttemptAt).toBeTruthy();
    expect((await app.local.getAllLocalSales())[0].local_status).toBe("pending");

    // Mientras espera el reintento controlado no se vuelve a enviar...
    const before = server.requests;
    await app.queue.flushQueue(() => {}, () => {});
    expect(server.requests).toBe(before);

    // 8-9. ...y al reintentar con el servidor sano, la venta llega una sola vez.
    server.mode = "ok";
    const synced: string[] = [];
    await app.queue.flushQueue((localId, saleId) => synced.push(`${localId}:${saleId}`), () => {}, { force: true });
    expect(synced).toEqual(["LOCAL-A:srv-1"]);
    expect(server.sales.size).toBe(1);
    expect(await app.queue.getPendingSales()).toHaveLength(0);
    const [local] = await app.local.getAllLocalSales();
    expect(local).toMatchObject({ local_status: "synced", server_sale_id: "srv-1" });

    // La venta llega con su fecha real y su identificador idempotente.
    const sent = server.sales.get("LOCAL-A")!.body;
    expect(sent.created_at).toBe(local.created_at);

    // 10. Nuevas sincronizaciones no duplican.
    await app.queue.flushQueue(() => {}, () => {}, { force: true });
    expect(server.sales.size).toBe(1);
  });

  it("si el servidor guardo la venta pero la respuesta se perdio, el reintento no la duplica", async () => {
    const app = await reopenApp();
    await app.catalog.saveCachedProducts([product()]);
    await sellOffline(app, "LOCAL-B");

    server.mode = "lost-response";
    await app.queue.flushQueue(() => {}, () => {});
    expect(server.sales.size).toBe(1);
    expect(await app.queue.getPendingSales()).toHaveLength(1); // no se borra hasta confirmar

    server.mode = "ok";
    await app.queue.flushQueue(() => {}, () => {});
    expect(server.sales.size).toBe(1);
    expect(await app.queue.getPendingSales()).toHaveLength(0);
    expect((await app.local.getAllLocalSales())[0].server_sale_id).toBe("srv-1");
  });

  it("varias ventas offline se envian en orden y cada una una sola vez", async () => {
    const app = await reopenApp();
    await app.catalog.saveCachedProducts([product()]);
    await sellOffline(app, "LOCAL-1");
    await sellOffline(app, "LOCAL-2");
    await sellOffline(app, "LOCAL-3");
    expect((await app.catalog.getCachedProducts())![0].variants[0].stock_qty).toBe(4);

    await app.queue.flushQueue(() => {}, () => {});
    await app.queue.flushQueue(() => {}, () => {});
    expect([...server.sales.keys()]).toEqual(["LOCAL-1", "LOCAL-2", "LOCAL-3"]);
  });

  it("un rechazo definitivo (4xx) no se reintenta solo, se informa y puede descartarse", async () => {
    const app = await reopenApp();
    await sellOffline(app, "LOCAL-X");
    server.mode = "http400";
    await app.queue.flushQueue(() => {}, () => {});

    const failed = await app.queue.getFailedItems();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ id: "LOCAL-X", type: "sale" });

    const before = server.requests;
    await app.queue.flushQueue(() => {}, () => {});
    expect(server.requests).toBe(before);

    // Reintentar manualmente limpia el error y vuelve a enviar.
    server.mode = "ok";
    await app.queue.clearQueueErrors();
    await app.queue.flushQueue(() => {}, () => {});
    expect(server.sales.size).toBe(1);
    expect(await app.queue.getFailedItems()).toHaveLength(0);
  });

  it("descartar una venta rechazada la conserva marcada en el historial local", async () => {
    const app = await reopenApp();
    await sellOffline(app, "LOCAL-Y");
    server.mode = "http400";
    await app.queue.flushQueue(() => {}, () => {});
    await app.queue.discardFailedSale("LOCAL-Y");
    expect(await app.queue.getPendingSales()).toHaveLength(0);
    expect((await app.local.getAllLocalSales())[0].local_status).toBe("failed");
  });

  it("el catalogo refrescado desde el servidor vuelve a restar las ventas aun pendientes", async () => {
    const app = await reopenApp();
    await sellOffline(app, "LOCAL-Z");
    const fresh = await app.stock.applyPendingSalesToCatalog([product()]); // el servidor aun tiene 10
    expect(fresh[0].variants[0].stock_qty).toBe(8);
  });

  it("restaura a la cola una venta local pendiente que se hubiera perdido de la cola", async () => {
    const app = await reopenApp();
    await sellOffline(app, "LOCAL-R");
    await app.queue.deletePendingSale("LOCAL-R");
    expect(await app.queue.restorePendingSalesFromLocalStorage()).toBe(1);
    const [entry] = await app.queue.getPendingSales();
    expect(entry.payload.created_at).toBeTruthy();
  });

  it("el corte de caja offline lleva un identificador estable y se envia despues de las ventas", async () => {
    const app = await reopenApp();
    await sellOffline(app, "LOCAL-C");
    const opId = await app.ops.enqueueOp("close_cash_register", { actual_cash: 200, date: "2026-10-19" });

    const order: string[] = [];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (path: string, init?: RequestInit) => {
      order.push(path);
      const body = JSON.parse(String(init?.body));
      if (path === "/api/sales") return new Response(JSON.stringify({ id: "srv-1" }), { status: 201 });
      server.closes.set(body.client_close_id, body);
      if (server.closes.size === 1 && order.filter((p) => p.includes("close")).length === 1) {
        throw new TypeError("respuesta perdida");
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await app.queue.flushQueue(() => {}, () => {});
    expect(order).toEqual(["/api/sales", "/api/cash-register/close"]);
    expect(await app.ops.countPendingOps()).toBe(1); // se conserva hasta confirmar

    await app.queue.flushQueue(() => {}, () => {});
    expect(await app.ops.countPendingOps()).toBe(0);
    expect([...server.closes.keys()]).toEqual([opId]); // mismo id en ambos intentos
  });

  it("un ajuste de inventario dentro de una edicion offline usa client_op_id estable", async () => {
    const app = await reopenApp();
    const opId = await app.ops.enqueueOp("update_product", {
      product_id: "p1",
      product_name: "Playera",
      base: { name: "Playera", category_id: null, barcode: null, price: 100, low_stock_threshold: 3 },
      product: { name: "Playera" },
      stock: { variant_id: "v1", qty_change: 5, note: null },
    });

    const adjustBodies: Record<string, unknown>[] = [];
    let adjustAttempts = 0;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (path === "/api/products" && method === "GET") {
        return new Response(JSON.stringify([{ id: "p1", name: "Playera", barcode: null, category_id: null, low_stock_threshold: 3, variants: [] }]));
      }
      if (path === "/api/stock/adjust") {
        adjustBodies.push(JSON.parse(String(init?.body)));
        if (++adjustAttempts === 1) throw new TypeError("respuesta perdida");
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await app.queue.flushQueue(() => {}, () => {});
    await app.queue.flushQueue(() => {}, () => {});
    expect(adjustBodies).toHaveLength(2);
    expect(adjustBodies[0].client_op_id).toBe(`${opId}:stock`);
    expect(adjustBodies[1].client_op_id).toBe(`${opId}:stock`);
    expect(await app.ops.countPendingOps()).toBe(0);
  });
});
