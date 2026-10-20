import { beforeEach, describe, expect, it, vi } from "vitest";
import { createECDH } from "node:crypto";
import { NextRequest } from "next/server";
import { FakeDb, type UniqueRule } from "./helpers/fake-supabase";

// ── Dobles de prueba ─────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-supabase").FakeDb,
  device: null as null | { id: string; name: string },
  afterQueue: [] as (() => unknown)[],
}));

vi.mock("@/lib/supabase/server", () => ({
  supabase: { from: (table: string) => h.db.from(table) },
}));
vi.mock("@/lib/auth", () => ({
  getDeviceFromCookies: async () => h.device,
  deviceCookieOptions: () => ({ name: "pos_device_token", httpOnly: true, secure: false, sameSite: "lax", maxAge: 1, path: "/" }),
  COOKIE_NAME: "pos_device_token",
}));
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void h.afterQueue.push(fn) };
});
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

import webpush from "web-push";
import { todayDateString } from "@/lib/utils";
import { resetRateLimits } from "@/lib/rate-limit";

const sendMock = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;

const UNIQUE: UniqueRule[] = [
  { table: "sales", columns: ["sale_number"] },
  { table: "sales", columns: ["client_sale_id"], partial: true },
  { table: "stock_adjustments", columns: ["client_op_id"], partial: true },
  { table: "cash_register", columns: ["date"] },
  { table: "cash_register", columns: ["client_close_id"], partial: true },
  { table: "push_events", columns: ["event_key"] },
  { table: "push_subscriptions", columns: ["endpoint"] },
];

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function vapidPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function runAfter() {
  const queue = h.afterQueue.splice(0);
  for (const fn of queue) await fn();
}

function seedCatalog(stock = 5, threshold = 3) {
  h.db.seed("products", [{ id: "p1", name: "Playera", track_stock: true }]);
  h.db.seed("product_variants", [
    { id: "v1", product_id: "p1", size_label: "", price: 100, stock_qty: stock, low_stock_threshold: threshold },
  ]);
}
const variantStock = () => Number(h.db.rows("product_variants")[0].stock_qty);
const saleBody = (over: Record<string, unknown> = {}) => ({
  items: [{ item_type: "product", product_id: "p1", variant_id: "v1", description: "Playera", unit_price: 100, qty: 2 }],
  payment_method: "cash",
  ...over,
});

beforeEach(() => {
  h.db = new FakeDb(UNIQUE);
  h.device = { id: "dev1", name: "Caja 1" };
  h.afterQueue = [];
  resetRateLimits();
  sendMock.mockReset();
  sendMock.mockResolvedValue({ statusCode: 201 });
  const keys = vapidPair();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
});

// ── Autenticacion ────────────────────────────────────────────────────────────
describe("Autenticacion en rutas", () => {
  it("responde 401 sin dispositivo registrado", async () => {
    h.device = null;
    const [devices, history, inventory, adjustments, repExpenses, repSales, pushStatus, pushTest, transfers, close, adjust] =
      await Promise.all([
        import("@/app/api/devices/route").then((m) => m.GET()),
        import("@/app/api/cash-register/history/route").then((m) => m.GET(req("/x", "GET"))),
        import("@/app/api/reports/inventory/route").then((m) => m.GET()),
        import("@/app/api/stock/adjustments/route").then((m) => m.GET(req("/x", "GET"))),
        import("@/app/api/reports/expenses/route").then((m) => m.GET(req("/x", "GET"))),
        import("@/app/api/reports/sales/route").then((m) => m.GET(req("/x", "GET"))),
        import("@/app/api/push/status/route").then((m) => m.POST(req("/x", "POST", {}))),
        import("@/app/api/push/test/route").then((m) => m.POST(req("/x", "POST", {}))),
        import("@/app/api/transfers/route").then((m) => m.POST(req("/x", "POST", { id: "a" }))),
        import("@/app/api/cash-register/close/route").then((m) => m.POST(req("/x", "POST", { actual_cash: 1 }))),
        import("@/app/api/stock/adjust/route").then((m) => m.POST(req("/x", "POST", {}))),
      ]);
    for (const r of [devices, history, inventory, adjustments, repExpenses, repSales, pushStatus, pushTest, transfers, close, adjust]) {
      expect(r.status).toBe(401);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("el registro de dispositivos limita los intentos de codigo", async () => {
    const { POST } = await import("@/app/api/setup/route");
    h.db.seed("store_config", [{ id: 1, setup_complete: true, access_code: "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva" }]);
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await POST(req("/api/setup", "POST", { access_code: "mal-codigo", name: "Tel" }))).status;
    expect(last).toBe(429);
  });
});

// ── Ventas ───────────────────────────────────────────────────────────────────
describe("POST /api/sales", () => {
  it("descuenta inventario y registra el ajuste", async () => {
    seedCatalog();
    const { POST } = await import("@/app/api/sales/route");
    const res = await POST(req("/api/sales", "POST", saleBody({ client_sale_id: "LOCAL-1" })));
    expect(res.status).toBe(201);
    expect(variantStock()).toBe(3);
    expect(h.db.rows("stock_adjustments")).toHaveLength(1);
    expect(h.db.rows("sales")[0].payment_status).toBe("paid");
  });

  it("reintentar la misma venta no la duplica ni descuenta dos veces", async () => {
    seedCatalog();
    const { POST } = await import("@/app/api/sales/route");
    const first = await (await POST(req("/api/sales", "POST", saleBody({ client_sale_id: "LOCAL-1" })))).json();
    const second = await POST(req("/api/sales", "POST", saleBody({ client_sale_id: "LOCAL-1" })));
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody).toEqual({ id: first.id, duplicate: true });
    expect(h.db.rows("sales")).toHaveLength(1);
    expect(variantStock()).toBe(3);
  });

  it("una venta en linea sin existencias se rechaza", async () => {
    seedCatalog(1);
    const { POST } = await import("@/app/api/sales/route");
    const res = await POST(req("/api/sales", "POST", saleBody()));
    expect(res.status).toBe(409);
    expect(h.db.rows("sales")).toHaveLength(0);
    expect(variantStock()).toBe(1);
  });

  it("una venta offline sincronizada con faltante se acepta, deja stock en 0 y se marca para revision", async () => {
    seedCatalog(1);
    const { POST } = await import("@/app/api/sales/route");
    const createdAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    const res = await POST(req("/api/sales", "POST", saleBody({ client_sale_id: "LOCAL-OFF", created_at: createdAt })));
    expect(res.status).toBe(201);
    expect(variantStock()).toBe(0);
    const sale = h.db.rows("sales")[0];
    expect(sale.needs_attention).toBe(true);
    // conserva la fecha en que ocurrio y el folio usa el dia de CDMX
    expect(sale.created_at).toBe(createdAt);
    expect(sale.sale_number).toBe(`S-${todayDateString(new Date(createdAt)).replace(/-/g, "")}-0001`);
    const adj = h.db.rows("stock_adjustments")[0];
    expect(Number(adj.qty_after)).toBe(0);
    expect(Number(adj.qty_change)).toBe(-1);
  });

  it("ignora una fecha futura enviada por el dispositivo", async () => {
    seedCatalog();
    const { POST } = await import("@/app/api/sales/route");
    const future = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();
    await POST(req("/api/sales", "POST", saleBody({ client_sale_id: "LOCAL-F", created_at: future })));
    expect(String(h.db.rows("sales")[0].created_at) < future).toBe(true);
  });

  it("transferencia: queda pendiente y avisa una sola vez; stock bajo se notifica sin repetirse", async () => {
    seedCatalog(5, 3);
    h.db.seed("push_subscriptions", [
      { id: "s1", device_id: "dev2", endpoint: "https://push.example.com/abc", p256dh: "p".repeat(20), auth: "a".repeat(12), prefs: null },
    ]);
    const { POST } = await import("@/app/api/sales/route");

    await POST(req("/api/sales", "POST", saleBody({ payment_method: "bank_transfer", client_sale_id: "T-1" })));
    await runAfter();
    expect(h.db.rows("sales")[0].payment_status).toBe("pending");
    const titles = sendMock.mock.calls.map((c) => JSON.parse(c[1] as string).title);
    expect(titles).toContain("Transferencia pendiente");
    expect(titles).toContain("Inventario bajo"); // 5 -> 3 cruza a amarillo

    // reintento duplicado: no vuelve a notificar
    sendMock.mockClear();
    await POST(req("/api/sales", "POST", saleBody({ payment_method: "bank_transfer", client_sale_id: "T-1" })));
    await runAfter();
    expect(sendMock).not.toHaveBeenCalled();

    // otra venta mientras sigue en amarillo: sin aviso de inventario
    sendMock.mockClear();
    await POST(req("/api/sales", "POST", saleBody({ client_sale_id: "T-2" })));
    await runAfter();
    const again = sendMock.mock.calls.map((c) => JSON.parse(c[1] as string).title);
    expect(again).not.toContain("Inventario bajo");
  });
});

// ── Transferencias ───────────────────────────────────────────────────────────
async function pendingTransfer() {
  seedCatalog(5, 1);
  const { POST } = await import("@/app/api/sales/route");
  const res = await POST(req("/api/sales", "POST", saleBody({ payment_method: "bank_transfer", client_sale_id: "T" })));
  await runAfter();
  return (await res.json()).id as string;
}

describe("/api/transfers", () => {
  it("confirmar consolida el pago una sola vez", async () => {
    const id = await pendingTransfer();
    const { POST } = await import("@/app/api/transfers/route");
    expect((await POST(req("/api/transfers", "POST", { id }))).status).toBe(200);
    expect(h.db.rows("sales")[0].payment_status).toBe("paid");
    expect((await POST(req("/api/transfers", "POST", { id }))).status).toBe(404);
  });

  it("rechazar cancela la venta, restituye inventario y deja trazabilidad", async () => {
    const id = await pendingTransfer();
    expect(variantStock()).toBe(3);
    const { POST } = await import("@/app/api/transfers/route");
    const res = await POST(req("/api/transfers", "POST", { id, action: "reject", reason: "No llegó el SPEI" }));
    expect(res.status).toBe(200);
    expect(variantStock()).toBe(5);
    const sale = h.db.rows("sales")[0];
    expect(sale.payment_status).toBe("rejected");
    expect(sale.reject_reason).toBe("No llegó el SPEI");
    expect(h.db.rows("stock_adjustments").some((a) => a.adjustment_type === "refund")).toBe(true);

    // no se puede rechazar dos veces ni confirmar despues
    expect((await POST(req("/api/transfers", "POST", { id, action: "reject" }))).status).toBe(404);
    expect((await POST(req("/api/transfers", "POST", { id }))).status).toBe(404);
    expect(variantStock()).toBe(5);
  });

  it("si falla la restitucion, la transferencia sigue pendiente y el inventario no cambia", async () => {
    const id = await pendingTransfer();
    h.db.failOn = (table, op) => (table === "stock_adjustments" && op === "insert" ? { message: "boom" } : null);
    const { POST } = await import("@/app/api/transfers/route");
    const res = await POST(req("/api/transfers", "POST", { id, action: "reject" }));
    h.db.failOn = null;
    expect(res.status).toBe(500);
    expect(h.db.rows("sales")[0].payment_status).toBe("pending");
    expect(variantStock()).toBe(3);
  });

  it("una venta en efectivo no se puede rechazar como transferencia", async () => {
    seedCatalog();
    const { POST: sale } = await import("@/app/api/sales/route");
    const created = await (await sale(req("/api/sales", "POST", saleBody()))).json();
    const { POST } = await import("@/app/api/transfers/route");
    expect((await POST(req("/api/transfers", "POST", { id: created.id, action: "reject" }))).status).toBe(404);
  });
});

// ── Ajuste de inventario ─────────────────────────────────────────────────────
describe("POST /api/stock/adjust", () => {
  it("es idempotente con client_op_id", async () => {
    seedCatalog(5);
    const { POST } = await import("@/app/api/stock/adjust/route");
    const body = { product_id: "p1", variant_id: "v1", qty_change: 4, client_op_id: "OP-1:stock" };
    const a = await POST(req("/api/stock/adjust", "POST", body));
    const b = await POST(req("/api/stock/adjust", "POST", body));
    expect((await a.json()).stock_qty).toBe(9);
    expect(await b.json()).toEqual({ stock_qty: 9, duplicate: true });
    expect(variantStock()).toBe(9);
    expect(h.db.rows("stock_adjustments")).toHaveLength(1);
  });

  it("no deja existencias negativas y registra el cambio real", async () => {
    seedCatalog(2);
    const { POST } = await import("@/app/api/stock/adjust/route");
    await POST(req("/api/stock/adjust", "POST", { product_id: "p1", variant_id: "v1", qty_change: -10 }));
    expect(variantStock()).toBe(0);
    expect(Number(h.db.rows("stock_adjustments")[0].qty_change)).toBe(-2);
  });

  it("rechaza cantidades invalidas", async () => {
    seedCatalog(2);
    const { POST } = await import("@/app/api/stock/adjust/route");
    for (const qty_change of [0, "abc", 1e9]) {
      expect((await POST(req("/api/stock/adjust", "POST", { product_id: "p1", variant_id: "v1", qty_change }))).status).toBe(400);
    }
  });

  it("avisa agotado y repuesto", async () => {
    seedCatalog(2, 3);
    h.db.seed("push_subscriptions", [
      { id: "s1", device_id: "dev2", endpoint: "https://push.example.com/abc", p256dh: "p".repeat(20), auth: "a".repeat(12), prefs: null },
    ]);
    const { POST } = await import("@/app/api/stock/adjust/route");
    await POST(req("/api/stock/adjust", "POST", { product_id: "p1", variant_id: "v1", qty_change: -2 }));
    await runAfter();
    expect(JSON.parse(sendMock.mock.calls[0][1] as string).title).toBe("Producto agotado");
    sendMock.mockClear();
    await POST(req("/api/stock/adjust", "POST", { product_id: "p1", variant_id: "v1", qty_change: 20 }));
    await runAfter();
    expect(JSON.parse(sendMock.mock.calls[0][1] as string).title).toBe("Inventario repuesto");
  });
});

// ── Corte de caja ────────────────────────────────────────────────────────────
describe("POST /api/cash-register/close", () => {
  async function sell(clientId: string, method = "cash") {
    const { POST } = await import("@/app/api/sales/route");
    await POST(req("/api/sales", "POST", saleBody({ client_sale_id: clientId, payment_method: method })));
  }

  it("calcula efectivo esperado y diferencia (las transferencias no entran)", async () => {
    seedCatalog(50);
    await sell("C1");
    await sell("C2");
    await sell("T1", "bank_transfer");
    h.db.seed("expenses", [{ description: "Bolsas", amount: 30, created_at: new Date().toISOString() }]);
    // el sistema abre la caja con el saldo de ayer (0); se fija un fondo inicial
    h.db.rows("cash_register")[0].opening_balance = 500;

    const { POST } = await import("@/app/api/cash-register/close/route");
    const res = await POST(req("/x", "POST", { actual_cash: 860, client_close_id: "OP-1" }));
    const json = await res.json();
    expect(json.expected_cash).toBe(870); // 500 + 400 efectivo - 30 gasto
    expect(json.discrepancy).toBe(-10);
  });

  it("un reintento o doble cierre no modifica el corte", async () => {
    seedCatalog(50);
    await sell("C1");
    const { POST } = await import("@/app/api/cash-register/close/route");
    const first = await (await POST(req("/x", "POST", { actual_cash: 200, client_close_id: "OP-1" }))).json();
    const retry = await (await POST(req("/x", "POST", { actual_cash: 999, client_close_id: "OP-1" }))).json();
    expect(retry.duplicate).toBe(true);
    expect(retry.actual_cash).toBe(first.actual_cash);
    const other = await (await POST(req("/x", "POST", { actual_cash: 1, client_close_id: "OP-2" }))).json();
    expect(other.duplicate).toBe(true);
    expect(Number(other.actual_cash)).toBe(200);
  });

  it("valida el efectivo contado", async () => {
    const { POST } = await import("@/app/api/cash-register/close/route");
    for (const actual_cash of [-5, "x", null, undefined]) {
      expect((await POST(req("/x", "POST", { actual_cash }))).status).toBe(400);
    }
  });

  it("avisa faltante solo una vez", async () => {
    seedCatalog(50);
    await sell("C1");
    h.db.seed("push_subscriptions", [
      { id: "s1", device_id: "dev2", endpoint: "https://push.example.com/abc", p256dh: "p".repeat(20), auth: "a".repeat(12), prefs: null },
    ]);
    const { POST } = await import("@/app/api/cash-register/close/route");
    await POST(req("/x", "POST", { actual_cash: 0, client_close_id: "OP-9" }));
    await POST(req("/x", "POST", { actual_cash: 0, client_close_id: "OP-9" }));
    await runAfter();
    const titles = sendMock.mock.calls.map((c) => JSON.parse(c[1] as string).title);
    expect(titles.filter((t) => t === "Corte con faltante")).toHaveLength(1);
  });
});

// ── Push ─────────────────────────────────────────────────────────────────────
const subRow = (over: Record<string, unknown> = {}) => ({
  device_id: "dev1",
  endpoint: "https://push.example.com/" + Math.random().toString(36).slice(2),
  p256dh: "p".repeat(20),
  auth: "a".repeat(12),
  prefs: null,
  failure_count: 0,
  ...over,
});

describe("Notificaciones push", () => {
  it("la ruta de prueba envia solo a este dispositivo, informa resultados y se limita", async () => {
    h.db.seed("push_subscriptions", [subRow(), subRow({ device_id: "otro" })]);
    const { POST } = await import("@/app/api/push/test/route");
    const res = await POST(req("/api/push/test", "POST", {}));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ scope: "device", attempted: 1, accepted: 1, expired: 0, failed: 0 });
    expect(json.vapid.keysMatch).toBe(true);
    expect(JSON.stringify(json)).not.toContain(process.env.VAPID_PRIVATE_KEY);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const second = await POST(req("/api/push/test", "POST", {}));
    expect(second.status).toBe(429);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("detecta llaves VAPID que no corresponden", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapidPair().publicKey;
    const { POST } = await import("@/app/api/push/test/route");
    const res = await POST(req("/api/push/test", "POST", {}));
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sin llaves responde 501", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const { POST } = await import("@/app/api/push/test/route");
    expect((await POST(req("/api/push/test", "POST", {}))).status).toBe(501);
  });

  it("distingue aceptada, caducada (se elimina) y fallida (sin exponer el endpoint)", async () => {
    h.db.seed("push_subscriptions", [
      subRow({ id: "ok", endpoint: "https://ok.example.com/1" }),
      subRow({ id: "gone", endpoint: "https://gone.example.com/2" }),
      subRow({ id: "bad", endpoint: "https://bad.example.com/secret-token" }),
    ]);
    sendMock.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.includes("bad")) throw Object.assign(new Error("fail"), { statusCode: 500 });
      return { statusCode: 201 };
    });
    const { sendPush } = await import("@/lib/push");
    const result = await sendPush({ title: "t", body: "b" }, { category: "stock" });
    expect(result).toMatchObject({ attempted: 3, accepted: 1, expired: 1, failed: 1 });
    expect(result.errors[0]).toEqual({ host: "bad.example.com", status: 500, message: "El servicio push respondió HTTP 500" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(h.db.rows("push_subscriptions").some((r) => r.id === "gone")).toBe(false);
    const bad = h.db.rows("push_subscriptions").find((r) => r.id === "bad")!;
    expect(bad.failure_count).toBe(1);
    expect(bad.last_error_status).toBe(500);
  });

  it("respeta preferencias, dispositivo excluido y deduplicacion", async () => {
    h.db.seed("push_subscriptions", [
      subRow({ device_id: "a", prefs: { stock: false } }),
      subRow({ device_id: "b", prefs: { transfers: true, sales: true } }),
      subRow({ device_id: "c", prefs: null }),
    ]);
    const { sendPush } = await import("@/lib/push");

    const stock = await sendPush({ title: "t", body: "b" }, { category: "stock" });
    expect(stock.attempted).toBe(2); // a desactivo stock

    sendMock.mockClear();
    const sales = await sendPush({ title: "t", body: "b" }, { category: "sales" });
    expect(sales.attempted).toBe(1); // "sales" esta apagado por defecto salvo en b

    const excl = await sendPush({ title: "t", body: "b" }, { category: "transfers", excludeDeviceId: "b" });
    expect(excl.attempted).toBe(2);

    sendMock.mockClear();
    const first = await sendPush({ title: "t", body: "b" }, { category: "cash", dedupeKey: "k1" });
    const dup = await sendPush({ title: "t", body: "b" }, { category: "cash", dedupeKey: "k1" });
    expect(first.attempted).toBe(3);
    expect(dup).toMatchObject({ skippedDuplicate: true, attempted: 0 });
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it("suscribir es idempotente, valida y conserva preferencias; borrar solo elimina las propias", async () => {
    const sub = await import("@/app/api/push/subscribe/route");
    const body = { endpoint: "https://push.example.com/xyz", keys: { p256dh: "p".repeat(20), auth: "a".repeat(12) } };
    expect((await sub.POST(req("/s", "POST", body))).status).toBe(201);
    expect((await sub.POST(req("/s", "POST", body))).status).toBe(201);
    expect(h.db.rows("push_subscriptions")).toHaveLength(1);

    expect((await sub.POST(req("/s", "POST", { ...body, endpoint: "http://inseguro.example.com" }))).status).toBe(400);
    expect((await sub.POST(req("/s", "POST", { endpoint: body.endpoint, keys: {} }))).status).toBe(400);

    await sub.PATCH(req("/s", "PATCH", { endpoint: body.endpoint, prefs: { sales: true, desconocida: true } }));
    expect(h.db.rows("push_subscriptions")[0].prefs).toEqual({ sales: true });

    h.device = { id: "intruso", name: "X" };
    await sub.DELETE(req("/s", "DELETE", { endpoint: body.endpoint }));
    expect(h.db.rows("push_subscriptions")).toHaveLength(1);
    h.device = { id: "dev1", name: "Caja 1" };
    await sub.DELETE(req("/s", "DELETE", { endpoint: body.endpoint }));
    expect(h.db.rows("push_subscriptions")).toHaveLength(0);
  });
});

// ── Reportes ─────────────────────────────────────────────────────────────────
describe("Reporte de ventas", () => {
  it("cuenta solo lo cobrado; separa pendientes y excluye rechazadas", async () => {
    const now = new Date().toISOString();
    h.db.seed("sales", [
      { sale_number: "1", total: 100, payment_method: "cash", payment_status: "paid", created_at: now },
      { sale_number: "2", total: 200, payment_method: "bank_transfer", payment_status: "paid", created_at: now },
      { sale_number: "3", total: 300, payment_method: "bank_transfer", payment_status: "pending", created_at: now },
      { sale_number: "4", total: 400, payment_method: "bank_transfer", payment_status: "rejected", created_at: now },
    ]);
    const { GET } = await import("@/app/api/reports/sales/route");
    const json = await (await GET(req("/x", "GET"))).json();
    expect(json).toMatchObject({
      total_revenue: 300,
      cash_revenue: 100,
      transfer_revenue: 200,
      pending_transfer_revenue: 300,
      pending_transfer_count: 1,
      transaction_count: 3,
    });
  });
});
