import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Ejecuta schema.sql + migraciones 1-5 en un PostgreSQL real (PGlite/WASM) y valida el resultado. */
const sql = (f: string) =>
  readFileSync(path.join(__dirname, "..", "supabase", f), "utf8").replace(/\r\n/g, "\n");

const ORDER = [
  "schema.sql",
  "puntobase-migration.sql",
  "puntobase-migration-2.sql",
  "puntobase-migration-3.sql",
  "puntobase-migration-4.sql",
  "puntobase-migration-5.sql",
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
    expect((await db.query(`SELECT * FROM sales`)).rows).toHaveLength(1);
    expect((await db.query(`SELECT * FROM devices`)).rows).toHaveLength(1);
    expect((await db.query<{ payment_status: string }>(`SELECT payment_status FROM sales`)).rows[0].payment_status).toBe("paid");
  });

  it("el script de reversion se ejecuta sin errores", async () => {
    const db = await fresh();
    await db.exec(sql("puntobase-migration-5-rollback.sql"));
  });
});
