import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Ejecuta schema.sql + migraciones 1-6 en un PostgreSQL real (PGlite/WASM) y valida el resultado. */
const sql = (f: string) =>
  readFileSync(path.join(__dirname, "..", "supabase", f), "utf8").replace(/\r\n/g, "\n");

const ORDER = [
  "schema.sql",
  "puntobase-migration.sql",
  "puntobase-migration-2.sql",
  "puntobase-migration-3.sql",
  "puntobase-migration-4.sql",
  "puntobase-migration-5.sql",
  "puntobase-migration-6.sql",
];

async function fresh() {
  const db = new PGlite();
  for (const f of ORDER) await db.exec(sql(f));
  return db;
}

describe("Migraciones SQL (PostgreSQL real)", () => {
  it("se aplican en orden sobre el esquema base", async () => {
    const db = await fresh();
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sales'`
    );
    const names = cols.rows.map((r) => r.column_name);
    for (const c of ["client_sale_id", "payment_status", "rejected_at", "reject_reason", "needs_attention", "attention_note"]) {
      expect(names).toContain(c);
    }
  });

  it("son repetibles (ejecutar dos veces no falla)", async () => {
    const db = await fresh();
    await db.exec(sql("puntobase-migration-5.sql"));
    await db.exec(sql("puntobase-migration-5.sql"));
    await db.exec(sql("puntobase-migration-6.sql"));
    await db.exec(sql("puntobase-migration-6.sql"));
  });

  it("activa RLS en todas las tablas de la app", async () => {
    const db = await fresh();
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`
    );
    expect(res.rows.length).toBeGreaterThan(10);
    expect(res.rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("RLS sin politicas bloquea a un rol sin privilegios (equivalente a la llave anon)", async () => {
    const db = await fresh();
    await db.exec(`CREATE ROLE anon_test NOLOGIN; GRANT USAGE ON SCHEMA public TO anon_test;
                   GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO anon_test;`);
    await db.exec(`INSERT INTO devices (name, device_token) VALUES ('Caja', 'secreto')`);
    await db.exec(`SET ROLE anon_test`);
    const rows = await db.query(`SELECT * FROM devices`);
    expect(rows.rows).toHaveLength(0);
    await expect(db.exec(`INSERT INTO devices (name, device_token) VALUES ('x', 'y')`)).rejects.toThrow();
    await db.exec(`RESET ROLE`);
    expect((await db.query(`SELECT * FROM devices`)).rows).toHaveLength(1);
  });

  it("acepta el estado 'rejected' y sigue rechazando estados invalidos", async () => {
    const db = await fresh();
    const ins = (status: string, n: string) =>
      db.exec(`INSERT INTO sales (sale_number, subtotal, total, payment_method, payment_status)
               VALUES ('${n}', 10, 10, 'bank_transfer', '${status}')`);
    await ins("rejected", "A");
    await ins("pending", "B");
    await ins("paid", "C");
    await expect(ins("cancelada", "D")).rejects.toThrow();
  });

  it("garantiza idempotencia por client_op_id y client_close_id y deduplicacion de eventos push", async () => {
    const db = await fresh();
    await db.exec(`INSERT INTO products (name) VALUES ('P')`);
    const prod = (await db.query<{ id: string }>(`SELECT id FROM products LIMIT 1`)).rows[0].id;
    const adj = `INSERT INTO stock_adjustments (product_id, adjustment_type, qty_before, qty_change, qty_after, client_op_id)
                 VALUES ('${prod}', 'manual', 1, 1, 2, 'OP-1')`;
    await db.exec(adj);
    await expect(db.exec(adj)).rejects.toThrow(/duplicate key/);

    await db.exec(`INSERT INTO cash_register (date, client_close_id) VALUES ('2026-10-19', 'C-1')`);
    await expect(db.exec(`INSERT INTO cash_register (date, client_close_id) VALUES ('2026-10-20', 'C-1')`)).rejects.toThrow(/duplicate key/);
    // varias filas sin identificador son validas (indice parcial)
    await db.exec(`INSERT INTO cash_register (date) VALUES ('2026-10-21'), ('2026-10-22')`);

    await db.exec(`INSERT INTO push_events (event_key, category) VALUES ('k', 'stock')`);
    await expect(db.exec(`INSERT INTO push_events (event_key, category) VALUES ('k', 'stock')`)).rejects.toThrow(/duplicate key/);
  });

  it("las suscripciones push nuevas reciben preferencias por defecto", async () => {
    const db = await fresh();
    await db.exec(`INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('https://x', 'p', 'a')`);
    const row = (await db.query<{ prefs: Record<string, boolean> }>(`SELECT prefs FROM push_subscriptions`)).rows[0];
    expect(row.prefs).toEqual({ stock: true, transfers: true, sales: false, sync: true, cash: true });
  });

  it("no destruye datos existentes al migrar", async () => {
    const db = new PGlite();
    for (const f of ORDER.slice(0, 5)) await db.exec(sql(f));
    await db.exec(`INSERT INTO sales (sale_number, subtotal, total, payment_method) VALUES ('S-1', 50, 50, 'cash')`);
    await db.exec(`INSERT INTO devices (name, device_token) VALUES ('Caja', 't')`);
    await db.exec(sql("puntobase-migration-5.sql"));
    await db.exec(sql("puntobase-migration-6.sql"));
    expect((await db.query(`SELECT * FROM sales`)).rows).toHaveLength(1);
    expect((await db.query(`SELECT * FROM devices`)).rows).toHaveLength(1);
    expect((await db.query<{ payment_status: string }>(`SELECT payment_status FROM sales`)).rows[0].payment_status).toBe("paid");
  });

  it("el script de reversion se ejecuta sin errores", async () => {
    const db = await fresh();
    await db.exec(sql("puntobase-migration-5-rollback.sql"));
  });

  it("migracion 6: los dispositivos existentes quedan como administrador y los nuevos aceptan solo roles validos", async () => {
    const db = new PGlite();
    for (const f of ORDER.slice(0, 6)) await db.exec(sql(f));
    await db.exec(`INSERT INTO devices (name, device_token) VALUES ('Caja', 't1')`);
    await db.exec(sql("puntobase-migration-6.sql"));
    expect((await db.query<{ role: string }>(`SELECT role FROM devices`)).rows[0].role).toBe("admin");
    await db.exec(`INSERT INTO devices (name, device_token, role) VALUES ('Tel', 't2', 'employee')`);
    await expect(db.exec(`INSERT INTO devices (name, device_token, role) VALUES ('X', 't3', 'dueño')`)).rejects.toThrow();
  });

  it("migracion 6: importa una sola vez las devoluciones del flujo anterior (refunded_qty) sin duplicar", async () => {
    const db = new PGlite();
    for (const f of ORDER.slice(0, 6)) await db.exec(sql(f));
    // En la base real la columna ya existia (la usaba la pantalla anterior); aqui se simula.
    await db.exec(`ALTER TABLE sale_items ADD COLUMN refunded_qty numeric(12, 3) NOT NULL DEFAULT 0`);
    await db.exec(`INSERT INTO sales (sale_number, subtotal, total, payment_method) VALUES ('S-1', 200, 180, 'cash')`);
    const saleId = (await db.query<{ id: string }>(`SELECT id FROM sales`)).rows[0].id;
    await db.exec(`INSERT INTO sale_items (sale_id, item_type, description, unit_price, qty, line_total, refunded_qty)
                   VALUES ('${saleId}', 'product', 'Playera', 100, 2, 200, 1)`);
    await db.exec(sql("puntobase-migration-6.sql"));
    await db.exec(sql("puntobase-migration-6.sql"));
    const r = await db.query<{ total_refund: string; legacy: boolean }>(`SELECT total_refund, legacy FROM sale_returns`);
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].total_refund)).toBe(90); // 100 x 0.9 (descuento prorrateado)
    expect(r.rows[0].legacy).toBe(true);
    expect((await db.query(`SELECT * FROM sales`)).rows).toHaveLength(1); // la venta original sigue ahi
  });

  it("migracion 6: apartados validan estados, montos y aceptan los tipos de ajuste nuevos", async () => {
    const db = await fresh();
    await expect(db.exec(`INSERT INTO layaways (folio, customer_name, total, due_date, status) VALUES ('A', 'Ana', 10, '2026-12-01', 'otro')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO layaways (folio, customer_name, total, due_date) VALUES ('A', 'Ana', -1, '2026-12-01')`)).rejects.toThrow();
    await db.exec(`INSERT INTO layaways (folio, customer_name, total, due_date) VALUES ('A', 'Ana', 10, '2026-12-01')`);
    await expect(db.exec(`INSERT INTO layaways (folio, customer_name, total, due_date) VALUES ('A', 'Luis', 10, '2026-12-01')`)).rejects.toThrow(/duplicate key/);
    const id = (await db.query<{ id: string }>(`SELECT id FROM layaways`)).rows[0].id;
    await expect(db.exec(`INSERT INTO layaway_payments (layaway_id, kind, method, amount) VALUES ('${id}', 'payment', 'cash', 0)`)).rejects.toThrow();
    await db.exec(`INSERT INTO layaway_payments (layaway_id, kind, method, amount) VALUES ('${id}', 'payment', 'cash', 5)`);
    await db.exec(`INSERT INTO products (name) VALUES ('P')`);
    const prod = (await db.query<{ id: string }>(`SELECT id FROM products`)).rows[0].id;
    for (const t of ["layaway", "layaway_release"]) {
      await db.exec(`INSERT INTO stock_adjustments (product_id, adjustment_type, qty_before, qty_change, qty_after) VALUES ('${prod}', '${t}', 1, -1, 0)`);
    }
    await expect(db.exec(`INSERT INTO stock_adjustments (product_id, adjustment_type, qty_before, qty_change, qty_after) VALUES ('${prod}', 'robo', 1, -1, 0)`)).rejects.toThrow();
  });

  it("migracion 6: no permite devolver dos veces con el mismo client_op_id", async () => {
    const db = await fresh();
    await db.exec(`INSERT INTO sales (sale_number, subtotal, total, payment_method) VALUES ('S-1', 10, 10, 'cash')`);
    const saleId = (await db.query<{ id: string }>(`SELECT id FROM sales`)).rows[0].id;
    const ins = `INSERT INTO sale_returns (return_number, sale_id, reason, total_refund, refund_method, client_op_id) VALUES ('D-1', '${saleId}', 'x', 10, 'cash', 'op-1')`;
    await db.exec(ins);
    await expect(db.exec(ins.replace("'D-1'", "'D-2'"))).rejects.toThrow(/duplicate key/);
  });

  it("el script de reversion de la migracion 6 se ejecuta sin errores y no borra datos", async () => {
    const db = await fresh();
    await db.exec(`INSERT INTO layaways (folio, customer_name, total, due_date) VALUES ('A', 'Ana', 10, '2026-12-01')`);
    await db.exec(sql("puntobase-migration-6-rollback.sql"));
    expect((await db.query(`SELECT * FROM layaways`)).rows).toHaveLength(1);
  });
});
