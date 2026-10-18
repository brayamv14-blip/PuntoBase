-- PuntoBase: migracion 3 (ejecutar despues de puntobase-migration-2.sql)
-- Idempotencia de productos dados de alta sin conexion (la usa POST /api/products)
ALTER TABLE products ADD COLUMN IF NOT EXISTS client_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_client_id
  ON products (client_id) WHERE client_id IS NOT NULL;
