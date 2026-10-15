-- ============================================================
-- Arowana POS — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL editor
-- ============================================================

-- Store config (singleton)
CREATE TABLE IF NOT EXISTS store_config (
  id               integer PRIMARY KEY DEFAULT 1,
  store_name       text NOT NULL DEFAULT 'PuntoBase',
  access_code      text NOT NULL,
  setup_complete   boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

-- Devices
CREATE TABLE IF NOT EXISTS devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  device_token     text NOT NULL UNIQUE,
  is_active        boolean NOT NULL DEFAULT true,
  registered_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices (device_token);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Products (accessories, food, stock-based fish)
CREATE TABLE IF NOT EXISTS products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id           uuid REFERENCES categories (id) ON DELETE SET NULL,
  name                  text NOT NULL,
  is_fish               boolean NOT NULL DEFAULT false,
  price                 numeric(12, 2),
  stock_qty             numeric(12, 3),
  low_stock_threshold   numeric(12, 3) NOT NULL DEFAULT 5,
  track_stock           boolean NOT NULL DEFAULT true,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_fish ON products (is_fish);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products (stock_qty);

-- Product variants
CREATE TABLE IF NOT EXISTS product_variants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  product_name          text,
  size_label            text NOT NULL,
  price                 numeric(12, 2) NOT NULL,
  stock_qty             numeric(12, 3) NOT NULL DEFAULT 0,
  low_stock_threshold   numeric(12, 3) NOT NULL DEFAULT 5,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);

-- Individual fish (unique arowanas)
CREATE TABLE IF NOT EXISTS fish (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fish_display_id  text NOT NULL UNIQUE,
  tank_id          text NOT NULL,
  size_label       text,
  photo_url        text,
  price            numeric(12, 2) NOT NULL,
  status           text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold')),
  notes            text,
  sold_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fish_status ON fish (status);
CREATE INDEX IF NOT EXISTS idx_fish_display_id ON fish (fish_display_id);
CREATE INDEX IF NOT EXISTS idx_fish_tank ON fish (tank_id);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  phone            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number      text NOT NULL UNIQUE,
  device_id        uuid REFERENCES devices (id) ON DELETE SET NULL,
  customer_id      uuid REFERENCES customers (id) ON DELETE SET NULL,
  discount_type    text CHECK (discount_type IN ('flat', 'percent')),
  discount_value   numeric(12, 2) NOT NULL DEFAULT 0,
  subtotal         numeric(12, 2) NOT NULL,
  total            numeric(12, 2) NOT NULL,
  payment_method   text NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer')),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_device ON sales (device_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment ON sales (payment_method);
CREATE INDEX IF NOT EXISTS idx_sales_number ON sales (sale_number);

-- Sale items
CREATE TABLE IF NOT EXISTS sale_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          uuid NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  item_type        text NOT NULL CHECK (item_type IN ('fish', 'product')),
  fish_id          uuid REFERENCES fish (id) ON DELETE SET NULL,
  product_id       uuid REFERENCES products (id) ON DELETE SET NULL,
  variant_id       uuid REFERENCES product_variants (id) ON DELETE SET NULL,
  description      text NOT NULL,
  unit_price       numeric(12, 2) NOT NULL,
  qty              numeric(12, 3) NOT NULL DEFAULT 1,
  line_total       numeric(12, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_fish ON sale_items (fish_id);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description      text NOT NULL,
  amount           numeric(12, 2) NOT NULL,
  device_id        uuid REFERENCES devices (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses (created_at);

-- Stock adjustments (audit trail)
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products (id),
  variant_id       uuid REFERENCES product_variants (id) ON DELETE SET NULL,
  adjustment_type  text NOT NULL CHECK (adjustment_type IN ('manual', 'sale', 'refund')),
  qty_before       numeric(12, 3) NOT NULL,
  qty_change       numeric(12, 3) NOT NULL,
  qty_after        numeric(12, 3) NOT NULL,
  note             text,
  device_id        uuid REFERENCES devices (id) ON DELETE SET NULL,
  related_sale_id  uuid REFERENCES sales (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adjustments_product ON stock_adjustments (product_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_created_at ON stock_adjustments (created_at);

-- Cash register (daily reconciliation)
CREATE TABLE IF NOT EXISTS cash_register (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                  date NOT NULL UNIQUE,
  opening_balance       numeric(12, 2) NOT NULL DEFAULT 0,
  expected_cash         numeric(12, 2),
  actual_cash           numeric(12, 2),
  discrepancy           numeric(12, 2),
  notes                 text,
  closed_by_device_id   uuid REFERENCES devices (id) ON DELETE SET NULL,
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_register_date ON cash_register (date);
