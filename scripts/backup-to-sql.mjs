// Convierte un respaldo JSON de PuntoBase (Ajustes -> Respaldo) en un script SQL de RESTAURACION.
//
//   node scripts/backup-to-sql.mjs respaldo.json > restaurar.sql
//
// El SQL es NO destructivo: solo inserta (ON CONFLICT (id) DO NOTHING). Nunca borra ni sobreescribe filas.
// Se ejecuta en el editor SQL de Supabase sobre una base con las migraciones ya aplicadas.
// Los dispositivos se restauran INACTIVOS con un token inutilizable: hay que registrarlos de nuevo.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const ORDER = [
  "categories", "products", "product_variants", "customers", "devices",
  "sales", "sale_items", "expenses", "stock_adjustments", "cash_register",
  "sale_returns", "sale_return_items", "layaways", "layaway_items", "layaway_payments", "audit_log",
];

export function backupToSql(backup) {
  if (!backup || backup.app !== "PuntoBase" || backup.format !== 1 || typeof backup.tables !== "object") {
    throw new Error("El archivo no es un respaldo de PuntoBase (formato 1).");
  }
  const out = [
    "-- Restauracion de PuntoBase generada desde un respaldo del " + backup.exported_at,
    "-- NO destructiva: solo inserta filas que no existen (ON CONFLICT (id) DO NOTHING).",
    "BEGIN;",
  ];
  for (const table of ORDER) {
    let rows = backup.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    if (!/^[a-z_]+$/.test(table)) throw new Error("Nombre de tabla invalido");
    if (table === "devices") {
      rows = rows.map((r) => ({ ...r, is_active: false, device_token: `RESTAURADO-${randomBytes(16).toString("hex")}` }));
    }
    // Etiqueta de dolar unica: el JSON no puede cerrarla por accidente.
    let tag = "pb" + randomBytes(6).toString("hex");
    const json = JSON.stringify(rows);
    while (json.includes(`$${tag}$`)) tag = "pb" + randomBytes(6).toString("hex");
    out.push(
      `INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(null::public.${table}, $${tag}$${json}$${tag}$::jsonb) ON CONFLICT (id) DO NOTHING;`
    );
  }
  out.push("COMMIT;");
  return out.join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error("Uso: node scripts/backup-to-sql.mjs respaldo.json > restaurar.sql");
    process.exit(1);
  }
  process.stdout.write(backupToSql(JSON.parse(readFileSync(file, "utf8"))));
}
