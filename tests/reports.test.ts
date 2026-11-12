import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FakeDb } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-supabase").FakeDb }));
vi.mock("@/lib/supabase/server", () => ({ supabase: { from: (t: string) => h.db.from(t) } }));

import { computeAnalytics, pctChange, previousPeriod, restockSuggestions } from "@/lib/analytics";
import { toCsv } from "@/lib/csv";
import { buildBackup, BACKUP_TABLES } from "@/lib/backup";
import { backupToSql } from "../scripts/backup-to-sql.mjs";

const noon = (d: string) => `${d}T18:00:00.000Z`; // 12:00 en CDMX

describe("Analisis: ventas netas, ganancia estimada y separacion de cobrado/pendiente", () => {
  const input = {
    sales: [
      { id: "s1", total: 180, subtotal: 200, payment_method: "cash", payment_status: "paid", created_at: noon("2026-10-19") },
      { id: "s2", total: 300, subtotal: 300, payment_method: "bank_transfer", payment_status: "paid", created_at: noon("2026-10-20") },
      { id: "s3", total: 500, subtotal: 500, payment_method: "bank_transfer", payment_status: "pending", created_at: noon("2026-10-20") },
      { id: "s4", total: 70, subtotal: 70, payment_method: "bank_transfer", payment_status: "rejected", created_at: noon("2026-10-20") },
    ],
    items: [
      { sale_id: "s1", id: "i1", variant_id: "v1", description: "Playera", unit_price: 100, unit_cost: 40, qty: 2, line_total: 200 },
      { sale_id: "s2", id: "i2", variant_id: "v2", description: "Gorra", unit_price: 150, unit_cost: null, qty: 2, line_total: 300 },
      { sale_id: "s3", id: "i3", variant_id: "v2", description: "Gorra", unit_price: 250, unit_cost: null, qty: 2, line_total: 500 },
    ],
    returns: [{ id: "r1", sale_id: "s1", total_refund: 90, refund_method: "cash", created_at: noon("2026-10-20") }],
    returnItems: [{ return_id: "r1", sale_item_id: "i1", qty: 1, amount: 90 }],
    expenses: [{ amount: 50, created_at: noon("2026-10-20") }],
    layawayPayments: [
      { kind: "payment" as const, method: "cash", amount: 100, payment_status: "paid", created_at: noon("2026-10-20") },
      { kind: "payment" as const, method: "bank_transfer", amount: 40, payment_status: "pending", created_at: noon("2026-10-20") },
      { kind: "refund" as const, method: "cash", amount: 10, payment_status: "paid", created_at: noon("2026-10-20") },
    ],
  };
  const a = computeAnalytics(input);

  it("separa lo cobrado de lo pendiente/rechazado", () => {
    expect(a.grossSales).toBe(480);
    expect(a.pendingTransfers).toBe(500);
    expect(a.pendingTransfersCount).toBe(1);
    expect(a.rejectedCount).toBe(1);
    expect(a.transactionCount).toBe(2);
  });
  it("las devoluciones se restan y el desglose efectivo/transferencia cuadra", () => {
    expect(a.returnsTotal).toBe(90);
    expect(a.netSales).toBe(390);
    expect(a.cashSales).toBe(90); // 180 - 90
    expect(a.transferSales).toBe(300);
    expect(a.cashSales + a.transferSales).toBe(a.netSales);
  });
  it("calcula ganancia estimada solo con costos conocidos e informa la cobertura", () => {
    // Playera: 1 pieza neta -> ingreso 180*0.5 ... (100*0.9)=90 - 40 = 50 ; Gorra sin costo
    expect(a.estimatedProfit).toBe(50);
    expect(a.estimatedCost).toBe(40);
    expect(a.costCoverage).toBe(33); // 1 de 3 piezas netas cobradas tiene costo (la venta pendiente no cuenta)
  });
  it("incluye apartados cobrados netos y gastos en el flujo, sin contar lo pendiente", () => {
    expect(a.layawayCollected).toBe(90);
    expect(a.layawayPending).toBe(40);
    expect(a.expenses).toBe(50);
    expect(a.netCashFlow).toBe(390 + 90 - 50);
  });
  it("agrupa por dia (netas) y por hora y entrega el top de productos", () => {
    expect(a.byDay).toEqual([{ day: "2026-10-19", total: 180 }, { day: "2026-10-20", total: 210 }]);
    expect(a.byHour[0].hour).toBe(12);
    expect(a.topProducts[0].name).toBe("Gorra");
    expect(a.topProducts.find((p) => p.name === "Gorra")?.profit).toBeNull();
  });
});

describe("Comparacion de periodos y resurtido", () => {
  it("el periodo anterior tiene la misma duracion y termina el dia previo", () => {
    expect(previousPeriod("2026-10-08", "2026-10-14")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(previousPeriod("2026-10-20", "2026-10-20")).toEqual({ from: "2026-10-19", to: "2026-10-19" });
  });
  it("variacion porcentual", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
  });
  it("sugiere resurtir lo que se agota pronto o esta bajo el minimo", () => {
    const sold = new Map([["a", 14], ["b", 1], ["c", 0]]);
    const out = restockSuggestions(
      [
        { id: "a", name: "A", stock_qty: 3, low_stock_threshold: 1 }, // 1/dia, 3 dias
        { id: "b", name: "B", stock_qty: 50, low_stock_threshold: 5 }, // sobra
        { id: "c", name: "C", stock_qty: 0, low_stock_threshold: 4 }, // agotado
      ],
      sold, 14
    );
    expect(out.map((o) => o.variant_id)).toEqual(["c", "a"]);
    expect(out.find((o) => o.variant_id === "a")?.suggested).toBe(11); // 14 dias - 3 en stock
    expect(out.find((o) => o.variant_id === "c")?.suggested).toBe(8);
  });
});

describe("CSV para Excel", () => {
  it("lleva BOM, escapa comillas/comas y neutraliza formulas", () => {
    const csv = toCsv(["a", "b"], [['hola, "mundo"', "=1+1"], [-5, null]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"hola, ""mundo"""');
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("-5,");
  });
});

// ── Respaldo y restauracion ──────────────────────────────────────────────────
const sql = (f: string) => readFileSync(path.join(__dirname, "..", "supabase", f), "utf8").replace(/\r\n/g, "\n");
const ORDER = ["schema.sql", "puntobase-migration.sql", "puntobase-migration-2.sql", "puntobase-migration-3.sql", "puntobase-migration-4.sql", "puntobase-migration-5.sql", "puntobase-migration-6.sql"];

describe("Respaldo (buildBackup)", () => {
  beforeEach(() => { h.db = new FakeDb(); });
  it("no exporta secretos y pagina por encima de 1000 filas", async () => {
    h.db.seed("devices", [{ id: "d1", name: "Caja", device_token: "SECRETO", is_active: true }]);
    h.db.seed("store_config", [{ id: 1, access_code: "HASH" }]);
    h.db.seed("push_subscriptions", [{ id: "p", endpoint: "https://x", p256dh: "k", auth: "a" }]);
    h.db.seed("expenses", Array.from({ length: 2300 }, (_, i) => ({ id: `e${String(i).padStart(5, "0")}`, amount: 1 })));
    const b = await buildBackup(new Date("2026-10-20T00:00:00Z"));
    const text = JSON.stringify(b);
    expect(text).not.toContain("SECRETO");
    expect(text).not.toContain("HASH");
    expect(text).not.toContain("https://x");
    expect(Object.keys(b.tables)).toEqual(BACKUP_TABLES);
    expect(b.counts.expenses).toBe(2300);
    expect(b.tables.devices[0]).not.toHaveProperty("device_token");
  });
});

describe("Restauracion de un respaldo en PostgreSQL real (PGlite)", () => {
  async function seeded() {
    const db = new PGlite();
    for (const f of ORDER) await db.exec(sql(f));
    await db.exec(`
      INSERT INTO devices (id, name, device_token) VALUES ('11111111-1111-4111-8111-111111111111', 'Caja', 'tok');
      INSERT INTO products (id, name) VALUES ('22222222-2222-4222-8222-222222222222', 'Playera');
      INSERT INTO product_variants (id, product_id, size_label, price, cost, stock_qty) VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', '', 100, 40, 7);
      INSERT INTO sales (id, sale_number, subtotal, total, payment_method, device_id) VALUES ('44444444-4444-4444-8444-444444444444', 'S-1', 200, 180, 'cash', '11111111-1111-4111-8111-111111111111');
      INSERT INTO sale_items (id, sale_id, product_id, variant_id, item_type, description, unit_price, unit_cost, qty, line_total) VALUES ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'product', 'Playera $pb$raro$pb$', 100, 40, 2, 200);
      INSERT INTO sale_returns (id, return_number, sale_id, reason, total_refund, refund_method) VALUES ('66666666-6666-4666-8666-666666666666', 'D-1', '44444444-4444-4444-8444-444444444444', 'Defecto "x"', 90, 'cash');
      INSERT INTO sale_return_items (return_id, sale_item_id, qty, amount) VALUES ('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', 1, 90);
      INSERT INTO layaways (id, folio, customer_name, total, due_date) VALUES ('77777777-7777-4777-8777-777777777777', 'A-1', 'Ñandú', 300, '2026-12-01');
      INSERT INTO layaway_payments (layaway_id, kind, method, amount) VALUES ('77777777-7777-4777-8777-777777777777', 'payment', 'cash', 100);
      INSERT INTO audit_log (device_name, role, action) VALUES ('Caja', 'admin', 'return.create');
    `);
    return db;
  }
  /** Equivale a GET /api/backup: lee cada tabla y quita los secretos. */
  async function exportBackup(db: PGlite) {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of BACKUP_TABLES) {
      const rows = (await db.query<{ j: Record<string, unknown> }>(`SELECT to_jsonb(x) AS j FROM public.${t} x ORDER BY id`)).rows.map((r) => r.j);
      tables[t] = t === "devices" ? rows.map(({ device_token, ...rest }) => (void device_token, rest)) : rows;
    }
    return { app: "PuntoBase", format: 1, exported_at: "2026-10-20T00:00:00Z", counts: {}, tables, skipped: [] };
  }
  const snapshot = async (db: PGlite) => {
    const out: Record<string, unknown> = {};
    for (const t of ["sales", "sale_items", "sale_returns", "sale_return_items", "layaways", "layaway_payments", "product_variants", "audit_log"]) {
      out[t] = (await db.query(`SELECT * FROM public.${t} ORDER BY id`)).rows;
    }
    return out;
  };

  it("restaura en una base vacia y los datos quedan identicos (incluye comillas, acentos y $ en el texto)", async () => {
    const source = await seeded();
    const backup = await exportBackup(source);
    const restoreSql = backupToSql(backup);

    const target = new PGlite();
    for (const f of ORDER) await target.exec(sql(f));
    await target.exec(restoreSql);

    expect(await snapshot(target)).toEqual(await snapshot(source));
    // Los dispositivos restaurados NO pueden iniciar sesion: inactivos y con token inutilizable.
    const dev = (await target.query<{ is_active: boolean; device_token: string }>(`SELECT is_active, device_token FROM devices`)).rows[0];
    expect(dev.is_active).toBe(false);
    expect(dev.device_token).toMatch(/^RESTAURADO-/);
    expect(dev.device_token).not.toBe("tok");
  });

  it("es no destructiva: restaurar sobre datos existentes no duplica ni sobreescribe", async () => {
    const source = await seeded();
    const restoreSql = backupToSql(await exportBackup(source));
    await source.exec(`UPDATE product_variants SET stock_qty = 99`); // cambio posterior al respaldo
    await source.exec(restoreSql);
    await source.exec(restoreSql);
    expect((await source.query(`SELECT * FROM sales`)).rows).toHaveLength(1);
    expect(Number((await source.query<{ stock_qty: string }>(`SELECT stock_qty FROM product_variants`)).rows[0].stock_qty)).toBe(99);
  });

  it("recupera filas borradas por error sin tocar el resto", async () => {
    const source = await seeded();
    const restoreSql = backupToSql(await exportBackup(source));
    await source.exec(`DELETE FROM sale_return_items; DELETE FROM sale_returns;`);
    await source.exec(restoreSql);
    expect((await source.query(`SELECT * FROM sale_returns`)).rows).toHaveLength(1);
    expect((await source.query(`SELECT * FROM sale_return_items`)).rows).toHaveLength(1);
  });

  it("rechaza archivos que no son respaldos", () => {
    expect(() => backupToSql({ hola: 1 })).toThrow(/respaldo/);
  });
});
