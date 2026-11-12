import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-supabase").FakeDb,
  device: null as null | { id: string; name: string; role?: string },
  afterQueue: [] as (() => unknown)[],
}));

vi.mock("@/lib/supabase/server", () => ({ supabase: { from: (t: string) => h.db.from(t) } }));
vi.mock("@/lib/auth", () => ({
  getDeviceFromCookies: async () => h.device,
  COOKIE_NAME: "pos_device_token",
}));
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void h.afterQueue.push(fn) };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

import { PUT as putProduct, DELETE as delProduct } from "@/app/api/products/[id]/route";
import { PUT as putVariant } from "@/app/api/products/[id]/variants/[vid]/route";
import { POST as postVariant } from "@/app/api/products/[id]/variants/route";
import { DELETE as delCategory } from "@/app/api/categories/[id]/route";
import { POST as legacyRefund } from "@/app/api/sales/[id]/refund/route";
import { POST as confirmPayment } from "@/app/api/sales/[id]/confirm-payment/route";

const R = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = <T extends object>(o: T) => ({ params: Promise.resolve(o) });
const runAfter = async () => { for (const fn of h.afterQueue.splice(0)) await fn(); };

beforeEach(() => {
  h.db = new FakeDb();
  h.device = { id: "d1", name: "Caja", role: "admin" };
  h.afterQueue = [];
  h.db.seed("products", [{ id: "p1", name: "Playera", track_stock: true, is_active: true, category_id: "c1" }]);
  h.db.seed("categories", [{ id: "c1", name: "Ropa" }]);
  h.db.seed("product_variants", [{ id: "v1", product_id: "p1", size_label: "", price: 100, stock_qty: 10, low_stock_threshold: 1 }]);
});

describe("Rutas de catalogo con corchetes: validacion, historial y bitacora", () => {
  it("sin sesion responden 401 (incluidas las que antes no lo comprobaban)", async () => {
    h.device = null;
    expect((await delProduct(R("DELETE"), P({ id: "p1" }))).status).toBe(401);
    expect((await postVariant(R("POST", { size_label: "M", price: 1 }), P({ id: "p1" }))).status).toBe(401);
    expect((await (await import("@/app/api/products/[id]/variants/[vid]/route")).DELETE(R("DELETE"), P({ id: "p1", vid: "v1" }))).status).toBe(401);
  });

  it("rechaza precios negativos, NaN-like y existencias fraccionarias o negativas", async () => {
    expect((await putVariant(R("PUT", { price: -5 }), P({ id: "p1", vid: "v1" }))).status).toBe(400);
    expect((await putVariant(R("PUT", { stock_qty: 1.5 }), P({ id: "p1", vid: "v1" }))).status).toBe(400);
    expect((await putVariant(R("PUT", { stock_qty: -1 }), P({ id: "p1", vid: "v1" }))).status).toBe(400);
    expect((await putProduct(R("PUT", { name: "  " }), P({ id: "p1" }))).status).toBe(400);
    expect((await putProduct(R("PUT", { name: "X", price: "gratis" }), P({ id: "p1" }))).status).toBe(400);
    expect((await postVariant(R("POST", { size_label: "M", price: -1 }), P({ id: "p1" }))).status).toBe(400);
    expect(Number(h.db.rows("product_variants")[0].price)).toBe(100);
  });

  it("cambiar existencias desde la edicion deja historial y bitacora", async () => {
    const res = await putVariant(R("PUT", { stock_qty: 7, price: 120 }), P({ id: "p1", vid: "v1" }));
    expect(res.status).toBe(200);
    const adj = h.db.rows("stock_adjustments");
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ adjustment_type: "manual", qty_before: 10, qty_change: -3, qty_after: 7, device_id: "d1" });
    expect(h.db.rows("audit_log").map((r) => r.action)).toContain("variant.update");
  });

  it("editar el producto (variante unica) tambien deja historial", async () => {
    const res = await putProduct(R("PUT", { name: "Playera", price: 100, stock_qty: 4 }), P({ id: "p1" }));
    expect(res.status).toBe(200);
    expect(h.db.rows("stock_adjustments")[0]).toMatchObject({ qty_before: 10, qty_after: 4, qty_change: -6 });
    expect(h.db.rows("audit_log").map((r) => r.action)).toContain("product.update");
  });

  it("crear variante: si el alta falla, el producto conserva su variante por defecto", async () => {
    h.db.failOn = (table, op) => (table === "product_variants" && op === "insert" ? { message: "boom" } : null);
    const res = await postVariant(R("POST", { size_label: "M", price: 50 }), P({ id: "p1" }));
    expect(res.status).toBe(500);
    expect(h.db.rows("product_variants")).toHaveLength(1);
  });

  it("no se elimina una categoria que todavia tiene productos activos", async () => {
    const res = await delCategory(R("DELETE"), P({ id: "c1" }));
    expect(res.status).toBe(409);
    expect(h.db.rows("categories")).toHaveLength(1);
    await delProduct(R("DELETE"), P({ id: "p1" }));
    expect((await delCategory(R("DELETE"), P({ id: "c1" }))).status).toBe(200);
    expect(h.db.rows("categories")).toHaveLength(0);
    expect(h.db.rows("audit_log").map((r) => r.action)).toEqual(expect.arrayContaining(["product.delete", "category.delete"]));
  });

  it("la ruta antigua de devoluciones esta retirada (410) y no toca inventario", async () => {
    const res = await legacyRefund();
    expect(res.status).toBe(410);
    expect(Number(h.db.rows("product_variants")[0].stock_qty)).toBe(10);
  });

  it("confirm-payment: solo transferencias pendientes, deja bitacora y no confirma efectivo", async () => {
    h.db.seed("sales", [
      { id: "t1", total: 200, payment_method: "transfer", payment_status: "pending" },
      { id: "c1s", total: 50, payment_method: "cash", payment_status: "pending" },
    ]);
    expect((await confirmPayment(R("POST"), P({ id: "c1s" }))).status).toBe(404);
    const ok = await confirmPayment(R("POST"), P({ id: "t1" }));
    expect(ok.status).toBe(200);
    expect((await confirmPayment(R("POST"), P({ id: "t1" }))).status).toBe(404); // idempotente: no se confirma dos veces
    await runAfter();
    expect(h.db.rows("audit_log").filter((r) => r.action === "transfer.confirm")).toHaveLength(1);
  });
});
