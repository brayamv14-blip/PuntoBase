-- PuntoBase: cambios sobre el esquema base
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;

-- Estado de pago: las transferencias nacen 'pending' hasta confirmar el deposito
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid'
  CHECK (payment_status IN ('paid', 'pending'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales (payment_status);

-- Quitar el modulo de peces del proyecto original
ALTER TABLE sale_items DROP COLUMN IF EXISTS fish_id;
ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_item_type_check;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_item_type_check CHECK (item_type IN ('product'));
DROP TABLE IF EXISTS fish;
ALTER TABLE products DROP COLUMN IF EXISTS is_fish;
