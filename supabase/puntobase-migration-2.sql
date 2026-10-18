-- PuntoBase: migracion 2 (ejecutar despues de schema.sql y puntobase-migration.sql)
-- Idempotencia de ventas creadas sin conexion (la usa POST /api/sales)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_sale_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id
  ON sales (client_sale_id) WHERE client_sale_id IS NOT NULL;
