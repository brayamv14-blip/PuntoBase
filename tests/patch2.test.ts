import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb, type UniqueRule } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-supabase").FakeDb,
  device: null as null | { id: string; name: string; role?: string },
  afterQueue: [] as (() => unknown)[],
}));

vi.mock("@/lib/supabase/server", () => ({ supabase: { from: (t: string) => h.db.from(t) } }));
vi.mock("@/lib/auth", () => ({
  getDeviceFromCookies: async () => h.device,
  deviceCookieOptions: () => ({ name: "pos_device_token", httpOnly: true, secure: false, sameSite: "lax", maxAge: 1, path: "/" }),
  COOKIE_NAME: "pos_device_token",
}));
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void h.afterQueue.push(fn) };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

import { todayDateString } from "@/lib/utils";
import { normalizeRole, requiresAdmin, canReturn, isLegacyRefund } from "@/lib/permissions";
import { computeReturn } from "@/lib/returns";
import { layawayBalance, layawayView, validateDueDate } from "@/lib/layaways";
import { computeCashCut } from "@/lib/cash-math";

const UNIQUE: UniqueRule[] = [
  { table: "sales", columns: ["sale_number"] },
  { table: "sales", columns: ["client_sale_id"], partial: true },
  { table: "sale_returns", columns: ["client_op_id"], partial: true },
  { table: "layaways", columns: ["folio"] },
  { table: "layaways", columns: ["client_op_id"], partial: true },
  { table: "layaway_payments", columns: ["client_op_id"], partial: true },
  { table: "cash_register", columns: ["date"] },
  { table: "push_events", columns: ["event_key"] },
];

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const runAfter = async () => { for (const fn of h.afterQueue.splice(0)) await fn(); };
const stock = () => Number(h.db.rows("product_variants")[0].stock_qty);

function seedCatalog(qty = 10) {
  h.db.seed("products", [{ id: "p1", name: "Playera", track_stock: true, is_active: true }]);
  h.db.seed("product_variants", [{ id: "v1", product_id: "p1", size_label: "", price: 100, cost: 40, stock_qty: qty, low_stock_threshold: 1 }]);
}
function seedSale(over: Record<string, unknown> = {}) {
  h.db.seed("sales", [{ id: "s1", sale_number: "S-1", total: 300, subtotal: 300, payment_method: "cash", payment_status: "paid", created_at: new Date().toISOString(), ...over }]);
  h.db.seed("sale_items", [{ id: "i1", sale_id: "s1", product_id: "p1", variant_id: "v1", description: "Playera", unit_price: 100, qty: 3, refunded_qty: 0 }]);
}

beforeEach(() => {
  h.db = new FakeDb(UNIQUE);
  h.db.defaults = { layaways: { status: "active" }, sales: { needs_attention: false } };
  h.device = { id: "dev1", name: "Caja 1", role: "admin" };
  h.afterQueue = [];
});

// ── Permisos (puros) ─────────────────────────────────────────────────────────
describe("Permisos por rol", () => {
  it("el rol desconocido o ausente es admin (compatibilidad) y solo 'employee' restringe", () => {
    expect(normalizeRole(undefined)).toBe("admin");
    expect(normalizeRole("employee")).toBe("employee");
  });
  it("rutas sensibles exigen administrador; las de operacion diaria no", () => {
    expect(requiresAdmin("POST", "/api/cash-register/close")).toBe(true);
    expect(requiresAdmin("GET", "/api/backup")).toBe(true);
    expect(requiresAdmin("POST", "/api/layaways/cancel")).toBe(true);
    expect(requiresAdmin("PATCH", "/api/devices")).toBe(true);
    expect(requiresAdmin("PUT", "/api/store-config")).toBe(true);
    expect(requiresAdmin("POST", "/api/sales")).toBe(false);
    expect(requiresAdmin("POST", "/api/returns")).toBe(false);
    expect(requiresAdmin("POST", "/api/layaways/pay")).toBe(false);
  });
  it("un empleado solo devuelve ventas del mismo dia; el admin, cualquiera", () => {
    expect(canReturn("employee", "2026-10-01", "2026-10-02")).toBe(false);
    expect(canReturn("employee", "2026-10-02", "2026-10-02")).toBe(true);
    expect(canReturn("admin", "2026-10-01", "2026-10-02")).toBe(true);
  });
  it("la ruta antigua de reembolso esta identificada para bloquearla", () => {
    expect(isLegacyRefund("/api/sales/abc/refund")).toBe(true);
  });
});

describe("Calculo de devolucion", () => {
  const sale = { total: 270, subtotal: 300 };
  const items = [{ id: "i1", unit_price: 100, qty: 3, returned_qty: 0 }];
  it("prorratea el descuento de la venta", () => {
    const r = computeReturn(sale, items, [{ sale_item_id: "i1", qty: 3 }], 0);
    expect(r.ok && r.total).toBe(270);
  });
  it("rechaza devolver mas de lo vendido, partidas repetidas y cantidades invalidas", () => {
    expect(computeReturn(sale, items, [{ sale_item_id: "i1", qty: 4 }], 0).ok).toBe(false);
    expect(computeReturn(sale, items, [{ sale_item_id: "i1", qty: 1 }, { sale_item_id: "i1", qty: 1 }], 0).ok).toBe(false);
    expect(computeReturn(sale, items, [{ sale_item_id: "i1", qty: 0 }], 0).ok).toBe(false);
    expect(computeReturn(sale, items, [{ sale_item_id: "x", qty: 1 }], 0).ok).toBe(false);
    expect(computeReturn(sale, [{ ...items[0], returned_qty: 3 }], [{ sale_item_id: "i1", qty: 1 }], 270).ok).toBe(false);
  });
  it("la suma de devoluciones parciales nunca excede el total cobrado", () => {
    const a = computeReturn(sale, items, [{ sale_item_id: "i1", qty: 1 }], 0);
    const b = computeReturn(sale, [{ ...items[0], returned_qty: 1 }], [{ sale_item_id: "i1", qty: 2 }], a.ok ? a.total : 0);
    expect((a.ok ? a.total : 0) + (b.ok ? b.total : 0)).toBeCloseTo(270, 2);
  });
});

// ── Devoluciones (API) ───────────────────────────────────────────────────────
describe("POST /api/returns", () => {
  it("devuelve parte, reintegra inventario, conserva la venta y es idempotente", async () => {
    seedCatalog(7); seedSale();
    const { POST } = await import("@/app/api/returns/route");
    const body = { sale_id: "s1", reason: "Talla incorrecta", client_op_id: "r-1", items: [{ sale_item_id: "i1", qty: 1 }] };
    const res = await POST(req("/api/returns", "POST", body));
    expect(res.status).toBe(201);
    expect(stock()).toBe(8);
    expect(h.db.rows("sales")).toHaveLength(1);
    expect(h.db.rows("sale_returns")).toHaveLength(1);
    const again = await POST(req("/api/returns", "POST", body));
    expect(again.status).toBe(200);
    expect(stock()).toBe(8);
    expect(h.db.rows("sale_returns")).toHaveLength(1);
    await runAfter();
    expect(h.db.rows("audit_log").some((r) => r.action === "return.create")).toBe(true);
  });

  it("no permite devolver mas de lo vendido en devoluciones sucesivas", async () => {
    seedCatalog(7); seedSale();
    const { POST } = await import("@/app/api/returns/route");
    const ok = await POST(req("/api/returns", "POST", { sale_id: "s1", reason: "Defecto", items: [{ sale_item_id: "i1", qty: 2 }] }));
    expect(ok.status).toBe(201);
    const bad = await POST(req("/api/returns", "POST", { sale_id: "s1", reason: "Defecto", items: [{ sale_item_id: "i1", qty: 2 }] }));
    expect(bad.status).toBe(422);
    expect(stock()).toBe(9);
  });

  it("exige motivo y rechaza ventas no cobradas", async () => {
    seedCatalog(); seedSale({ payment_status: "pending" });
    const { POST } = await import("@/app/api/returns/route");
    expect((await POST(req("/api/returns", "POST", { sale_id: "s1", items: [{ sale_item_id: "i1", qty: 1 }] }))).status).toBe(400);
    expect((await POST(req("/api/returns", "POST", { sale_id: "s1", reason: "Defecto", items: [{ sale_item_id: "i1", qty: 1 }] }))).status).toBe(409);
  });

  it("un empleado no puede devolver una venta de dias anteriores", async () => {
    seedCatalog(); seedSale({ created_at: new Date(Date.now() - 3 * 86400000).toISOString() });
    h.device = { id: "d2", name: "Empleado", role: "employee" };
    const { POST } = await import("@/app/api/returns/route");
    const res = await POST(req("/api/returns", "POST", { sale_id: "s1", reason: "Defecto", items: [{ sale_item_id: "i1", qty: 1 }] }));
    expect(res.status).toBe(403);
    expect(h.db.rows("sale_returns")).toHaveLength(0);
  });
});

// ── Caja ─────────────────────────────────────────────────────────────────────
describe("Corte de caja con devoluciones y apartados", () => {
  it("efectivo esperado descuenta devoluciones/reembolsos y suma abonos", () => {
    const cut = computeCashCut({ openingBalance: 500, cashSales: 1000, cashRefunds: 100, layawayCashIn: 200, layawayCashOut: 50, expenses: 150, actualCash: 1400 });
    expect(cut.expectedCash).toBe(1400);
    expect(cut.discrepancy).toBe(0);
  });
  it("sin los campos nuevos el calculo anterior no cambia", () => {
    expect(computeCashCut({ openingBalance: 100, cashSales: 50, expenses: 20, actualCash: 130 }).expectedCash).toBe(130);
  });
});

// ── Precios en servidor ──────────────────────────────────────────────────────
describe("Validacion de precios en POST /api/sales", () => {
  const body = (price: number, extra: Record<string, unknown> = {}) => ({
    items: [{ item_type: "product", product_id: "p1", variant_id: "v1", description: "Playera", unit_price: price, qty: 1 }],
    payment_method: "cash",
    ...extra,
  });
  it("un administrador puede cambiar el precio en linea y queda en la bitacora", async () => {
    seedCatalog();
    const { POST } = await import("@/app/api/sales/route");
    expect((await POST(req("/api/sales", "POST", body(80)))).status).toBe(201);
    await runAfter();
    expect(h.db.rows("audit_log").some((r) => r.action === "sale.price_override")).toBe(true);
    expect(Number(h.db.rows("sales")[0].total)).toBe(80);
  });
  it("rechaza a un empleado en linea con precio distinto al catalogo y no toca inventario", async () => {
    seedCatalog();
    h.device = { id: "d2", name: "Empleado", role: "employee" };
    const { POST } = await import("@/app/api/sales/route");
    const res = await POST(req("/api/sales", "POST", body(1)));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("PRICE_MISMATCH");
    expect(stock()).toBe(10);
    expect(h.db.rows("sales")).toHaveLength(0);
  });
  it("una venta sincronizada con precio distinto se registra pero queda marcada para revision", async () => {
    seedCatalog();
    const { POST } = await import("@/app/api/sales/route");
    const res = await POST(req("/api/sales", "POST", body(80, { client_sale_id: "LOCAL-9" })));
    expect(res.status).toBe(201);
    const sale = h.db.rows("sales")[0];
    expect(sale.needs_attention).toBe(true);
    expect(String(sale.attention_note)).toContain("Precio");
  });
  it("guarda el costo vigente en la partida y rechaza descuento mayor al subtotal", async () => {
    seedCatalog();
    const { POST } = await import("@/app/api/sales/route");
    expect((await POST(req("/api/sales", "POST", body(100)))).status).toBe(201);
    expect(Number(h.db.rows("sale_items")[0].unit_cost)).toBe(40);
    const bad = await POST(req("/api/sales", "POST", body(100, { discount_type: "flat", discount_value: 500 })));
    expect(bad.status).toBe(400);
  });
});

// ── Apartados ────────────────────────────────────────────────────────────────
describe("Apartados: calculo", () => {
  it("saldo considera abonos cobrados, pendientes y reembolsos", () => {
    const b = layawayBalance(500, [
      { kind: "payment", amount: 100, payment_status: "paid" },
      { kind: "payment", amount: 150, payment_status: "pending" },
      { kind: "payment", amount: 50, payment_status: "rejected" },
    ]);
    expect(b).toMatchObject({ paid: 100, pending: 150, balance: 250, dueNow: 400 });
  });
  it("estados: activo, vencido, entregado, cancelado", () => {
    expect(layawayView("active", "2026-10-30", "2026-10-21")).toBe("active");
    expect(layawayView("active", "2026-10-20", "2026-10-21")).toBe("expired");
    expect(layawayView("delivered", "2026-01-01", "2026-10-21")).toBe("delivered");
    expect(layawayView("cancelled", "2026-01-01", "2026-10-21")).toBe("cancelled");
  });
  it("valida fecha limite", () => {
    expect(validateDueDate("2026-10-20", "2026-10-21")).toMatch(/pasado/);
    expect(validateDueDate("2026-02-31", "2026-01-01")).toMatch(/válida/);
    expect(validateDueDate("2027-12-01", "2026-10-21")).toMatch(/180/);
    expect(validateDueDate("2026-11-01", "2026-10-21")).toBeNull();
  });
});

describe("Apartados: API", () => {
  const due = () => { const d = new Date(); d.setDate(d.getDate() + 10); return todayDateString(d); };
  const create = (over: Record<string, unknown> = {}) => ({
    customer_name: "Ana", due_date: due(), deposit: 100, deposit_method: "cash", client_op_id: "a-1",
    items: [{ variant_id: "v1", qty: 3 }], ...over,
  });

  it("crea con folio, aparta inventario con precio del catalogo y es idempotente", async () => {
    seedCatalog();
    const { POST } = await import("@/app/api/layaways/route");
    const res = await POST(req("/api/layaways", "POST", create()));
    expect(res.status).toBe(201);
    const lay = h.db.rows("layaways")[0];
    expect(String(lay.folio)).toMatch(/^A-\d{8}-0001$/);
    expect(Number(lay.total)).toBe(300);
    expect(stock()).toBe(7);
    const dup = await POST(req("/api/layaways", "POST", create()));
    expect((await dup.json()).duplicate).toBe(true);
    expect(stock()).toBe(7);
    expect(h.db.rows("layaways")).toHaveLength(1);
  });

  it("rechaza anticipo mayor al total, sin existencias y fechas pasadas sin tocar inventario", async () => {
    seedCatalog(2);
    const { POST } = await import("@/app/api/layaways/route");
    expect((await POST(req("/api/layaways", "POST", create({ items: [{ variant_id: "v1", qty: 3 }] })))).status).toBe(409);
    expect((await POST(req("/api/layaways", "POST", create({ items: [{ variant_id: "v1", qty: 1 }], deposit: 500 })))).status).toBe(400);
    expect((await POST(req("/api/layaways", "POST", create({ due_date: "2020-01-01" })))).status).toBe(400);
    expect(stock()).toBe(2);
    expect(h.db.rows("layaways")).toHaveLength(0);
  });

  it("abono no puede exceder el saldo; entrega cobra el resto y no repite", async () => {
    seedCatalog();
    const { POST: createLay } = await import("@/app/api/layaways/route");
    await createLay(req("/api/layaways", "POST", create()));
    const id = String(h.db.rows("layaways")[0].id);
    const { POST: pay } = await import("@/app/api/layaways/pay/route");
    expect((await pay(req("/x", "POST", { layaway_id: id, amount: 250, method: "cash" }))).status).toBe(409);
    expect((await pay(req("/x", "POST", { layaway_id: id, amount: 100, method: "cash", client_op_id: "p-1" }))).status).toBe(201);
    expect((await pay(req("/x", "POST", { layaway_id: id, amount: 100, method: "cash", client_op_id: "p-1" }))).status).toBe(200);
    expect(h.db.rows("layaway_payments")).toHaveLength(2);
    const { POST: deliver } = await import("@/app/api/layaways/deliver/route");
    expect((await deliver(req("/x", "POST", { layaway_id: id }))).status).toBe(409); // falta cobrar 100
    expect((await deliver(req("/x", "POST", { layaway_id: id, final_method: "cash" }))).status).toBe(200);
    expect(h.db.rows("layaways")[0].status).toBe("delivered");
    const total = h.db.rows("layaway_payments").reduce((s, p) => s + Number(p.amount), 0);
    expect(total).toBe(300);
    expect(stock()).toBe(7); // sigue descontado, no se descuenta dos veces
  });

  it("la transferencia pendiente bloquea la entrega hasta confirmarla", async () => {
    seedCatalog();
    const { POST: createLay } = await import("@/app/api/layaways/route");
    await createLay(req("/api/layaways", "POST", create({ deposit: 300, deposit_method: "bank_transfer" })));
    const id = String(h.db.rows("layaways")[0].id);
    const { POST: deliver } = await import("@/app/api/layaways/deliver/route");
    expect((await deliver(req("/x", "POST", { layaway_id: id }))).status).toBe(409);
    const { POST: confirm } = await import("@/app/api/layaways/confirm/route");
    const payId = String(h.db.rows("layaway_payments")[0].id);
    expect((await confirm(req("/x", "POST", { payment_id: payId, action: "confirm" }))).status).toBe(200);
    expect((await confirm(req("/x", "POST", { payment_id: payId, action: "confirm" }))).status).toBe(409);
    expect((await deliver(req("/x", "POST", { layaway_id: id }))).status).toBe(200);
  });

  it("cancelar libera inventario, reembolsa y solo lo hace un administrador", async () => {
    seedCatalog();
    const { POST: createLay } = await import("@/app/api/layaways/route");
    await createLay(req("/api/layaways", "POST", create()));
    const id = String(h.db.rows("layaways")[0].id);
    const { POST: cancel } = await import("@/app/api/layaways/cancel/route");
    h.device = { id: "d2", name: "Empleado", role: "employee" };
    expect((await cancel(req("/x", "POST", { layaway_id: id, reason: "Vencido", refund: true }))).status).toBe(403);
    expect(stock()).toBe(7);
    h.device = { id: "dev1", name: "Caja 1", role: "admin" };
    expect((await cancel(req("/x", "POST", { layaway_id: id, reason: "Cliente no regresó", refund: true }))).status).toBe(200);
    expect(stock()).toBe(10);
    const refund = h.db.rows("layaway_payments").find((p) => p.kind === "refund");
    expect(Number(refund?.amount)).toBe(100);
    expect((await cancel(req("/x", "POST", { layaway_id: id, reason: "Otra vez", refund: true }))).status).toBe(200);
    expect(stock()).toBe(10); // no se libera dos veces
    expect(h.db.rows("layaway_payments").filter((p) => p.kind === "refund")).toHaveLength(1);
  });
});

// ── Dispositivos / roles ─────────────────────────────────────────────────────
describe("PATCH /api/devices", () => {
  it("no deja la tienda sin administrador y audita el cambio", async () => {
    h.db.seed("devices", [
      { id: "dev1", name: "Caja 1", role: "admin", is_active: true },
      { id: "d2", name: "Tel", role: "employee", is_active: true },
    ]);
    const { PATCH } = await import("@/app/api/devices/route");
    expect((await PATCH(req("/api/devices", "PATCH", { id: "dev1", role: "employee" }))).status).toBe(409);
    expect((await PATCH(req("/api/devices", "PATCH", { id: "d2", role: "admin" }))).status).toBe(200);
    expect((await PATCH(req("/api/devices", "PATCH", { id: "dev1", role: "employee" }))).status).toBe(200);
    expect(h.db.rows("audit_log").filter((r) => r.action === "device.update")).toHaveLength(2);
  });
  it("un empleado no puede cambiar roles", async () => {
    h.device = { id: "d2", name: "Tel", role: "employee" };
    const { PATCH } = await import("@/app/api/devices/route");
    expect((await PATCH(req("/api/devices", "PATCH", { id: "d2", role: "admin" }))).status).toBe(403);
  });
});

// ── proxy.ts (control de acceso para TODAS las rutas /api) ───────────────────
describe("proxy.ts", () => {
  const call = async (method: string, url: string, token?: string) => {
    const { proxy } = await import("@/proxy");
    const r = new NextRequest(`http://localhost${url}`, { method, headers: token ? { cookie: `pos_device_token=${token}` } : {} });
    return proxy(r);
  };
  beforeEach(() => {
    h.db.seed("devices", [
      { id: "a", name: "Admin", role: "admin", is_active: true, device_token: "tok-admin" },
      { id: "e", name: "Emp", role: "employee", is_active: true, device_token: "tok-emp" },
      { id: "x", name: "Baja", role: "admin", is_active: false, device_token: "tok-off" },
    ]);
  });
  it("401 sin sesion, 403 para empleado, pasa para administrador", async () => {
    expect((await call("POST", "/api/cash-register/close")).status).toBe(401);
    expect((await call("POST", "/api/cash-register/close", "tok-emp")).status).toBe(403);
    expect((await call("POST", "/api/cash-register/close", "tok-admin")).headers.get("x-middleware-next")).toBe("1");
  });
  it("un dispositivo dado de baja pierde el acceso aunque fuera administrador", async () => {
    expect((await call("GET", "/api/backup", "tok-off")).status).toBe(401);
  });
  it("protege tambien rutas con corchetes que no se pueden editar (variantes, categorias, productos)", async () => {
    expect((await call("DELETE", "/api/products/abc", "tok-emp")).status).toBe(403);
    expect((await call("PUT", "/api/products/abc/variants/v1", "tok-emp")).status).toBe(403);
    expect((await call("DELETE", "/api/categories/c1", "tok-emp")).status).toBe(403);
    expect((await call("PUT", "/api/products/abc/variants/v1", "tok-admin")).headers.get("x-middleware-next")).toBe("1");
  });
  it("las rutas de operacion diaria no consultan la base ni exigen administrador", async () => {
    expect((await call("POST", "/api/sales", "tok-emp")).headers.get("x-middleware-next")).toBe("1");
    expect((await call("GET", "/api/products", "tok-emp")).headers.get("x-middleware-next")).toBe("1");
  });
  it("la ruta antigua de reembolso responde 410 para todos", async () => {
    expect((await call("POST", "/api/sales/s1/refund", "tok-admin")).status).toBe(410);
  });
  it("si la base falla no concede acceso", async () => {
    h.db.failOn = () => ({ message: "db caida" });
    expect((await call("POST", "/api/cash-register/close", "tok-admin")).status).toBe(503);
  });
});

describe("POST /api/auth/logout", () => {
  it("el unico administrador no puede cerrar sesion; un empleado si y queda inactivo", async () => {
    h.db.seed("devices", [
      { id: "dev1", name: "Caja 1", role: "admin", is_active: true },
      { id: "d2", name: "Tel", role: "employee", is_active: true },
    ]);
    const { POST } = await import("@/app/api/auth/logout/route");
    expect((await POST()).status).toBe(409);
    expect(h.db.rows("devices")[0].is_active).toBe(true);
    h.device = { id: "d2", name: "Tel", role: "employee" };
    const res = await POST();
    expect(res.status).toBe(200);
    expect(h.db.rows("devices")[1].is_active).toBe(false);
    expect(res.headers.get("set-cookie")).toContain("pos_device_token=;");
  });
});
