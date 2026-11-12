import { supabase } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/paginate";

/** Tablas respaldadas, en orden de dependencias (se pueden restaurar tal cual). */
export const BACKUP_TABLES = [
  "categories", "products", "product_variants", "customers", "devices",
  "sales", "sale_items", "expenses", "stock_adjustments", "cash_register",
  "sale_returns", "sale_return_items", "layaways", "layaway_items", "layaway_payments",
  "audit_log",
];

/** Columnas que NUNCA salen en un respaldo (secretos). El codigo de acceso, las suscripciones push y los tokens no se exportan. */
export const BACKUP_EXCLUDED_COLUMNS: Record<string, string[]> = { devices: ["device_token"] };

export interface BackupFile {
  app: "PuntoBase";
  format: 1;
  exported_at: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
  /** Tablas que no existian todavia (migracion pendiente) y se omitieron. */
  skipped: string[];
}

/** Lee todas las tablas (paginando) y arma el respaldo. No incluye secretos. */
export async function buildBackup(now: Date = new Date()): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  const counts: Record<string, number> = {};
  const skipped: string[] = [];
  for (const t of BACKUP_TABLES) {
    try {
      const rows = await fetchAll<Record<string, unknown>>((a, b) =>
        supabase.from(t).select("*").order("id", { ascending: true }).range(a, b)
      );
      const drop = BACKUP_EXCLUDED_COLUMNS[t] ?? [];
      tables[t] = drop.length ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k)))) : rows;
      counts[t] = rows.length;
    } catch (e) {
      // Tabla inexistente (migracion pendiente): se informa, pero el respaldo continua.
      const msg = e instanceof Error ? e.message : String(e);
      if (/does not exist|relation|schema cache|Could not find/i.test(msg)) skipped.push(t);
      else throw e;
    }
  }
  return { app: "PuntoBase", format: 1, exported_at: now.toISOString(), counts, tables, skipped };
}
