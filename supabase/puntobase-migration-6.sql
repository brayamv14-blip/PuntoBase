-- PuntoBase: migracion 6 (ejecutar despues de puntobase-migration-5.sql)
-- Incremental y repetible. NO borra tablas, columnas ni datos.
--
--   1. Roles de dispositivo (admin / employee) y bitacora de auditoria.
--   2. Costos (ganancia estimada): product_variants.cost y sale_items.unit_cost.
--   3. Devoluciones: sale_returns / sale_return_items (la venta original no se borra).
--   4. Apartados: layaways / layaway_items / layaway_payments.
--   5. RLS en las tablas nuevas.

-- 1. Roles y auditoria ---------------------------------------------------------
-- Los dispositivos que ya existen quedan como 'admin' (no se bloquea a nadie).
-- Los que se registren despues entran como 'employee' (lo decide /api/setup).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_role_check') THEN
    ALTER TABLE devices ADD CONSTRAINT devices_role_check CHECK (role IN ('admin', 'employee'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    uuid REFERENCES devices (id) ON DELETE SET NULL,
  device_name  text,
  role         text,
  action       text NOT NULL,
  entity       text,
  entity_id    text,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);

-- 2. Costos ---------------------------------------------------------------------
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS cost numeric(12, 2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost numeric(12, 2);
-- Compatibilidad con el flujo anterior de devoluciones (la UI lee esta columna).
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS refunded_qty numeric(12, 3) NOT NULL DEFAULT 0;

-- 3. Devoluciones --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number  text NOT NULL UNIQUE,
  sale_id        uuid NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  reason         text NOT NULL,
  total_refund   numeric(12, 2) NOT NULL CHECK (total_refund >= 0),
  refund_method  text NOT NULL CHECK (refund_method IN ('cash', 'bank_transfer')),
  restocked      boolean NOT NULL DEFAULT true,
  device_id      uuid REFERENCES devices (id) ON DELETE SET NULL,
  client_op_id   text,
  legacy         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_returns_client_op
  ON sale_returns (client_op_id) WHERE client_op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_created_at ON sale_returns (created_at);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id     uuid NOT NULL REFERENCES sale_returns (id) ON DELETE CASCADE,
  sale_item_id  uuid NOT NULL REFERENCES sale_items (id) ON DELETE CASCADE,
  qty           numeric(12, 3) NOT NULL CHECK (qty > 0),
  amount        numeric(12, 2) NOT NULL CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_return ON sale_return_items (return_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_item ON sale_return_items (sale_item_id);

-- Devoluciones hechas con el flujo anterior (sale_items.refunded_qty): se registran una sola vez
-- con la fecha de la venta, para que reportes y caja del sistema nuevo las conozcan.
DO $$
DECLARE r record; rid uuid; n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sale_returns WHERE legacy) THEN
    FOR r IN
      SELECT s.id AS sale_id, s.payment_method, s.created_at, s.total, s.subtotal,
             COALESCE(sum(si.unit_price * si.refunded_qty), 0) AS gross
      FROM sales s JOIN sale_items si ON si.sale_id = s.id
      WHERE si.refunded_qty > 0
      GROUP BY s.id
    LOOP
      n := n + 1;
      INSERT INTO sale_returns (return_number, sale_id, reason, total_refund, refund_method, restocked, legacy, created_at)
      VALUES ('D-LEGACY-' || lpad(n::text, 4, '0'), r.sale_id, 'Devolución anterior a la migración 6',
              round((r.gross * CASE WHEN r.subtotal > 0 THEN r.total / r.subtotal ELSE 1 END)::numeric, 2),
              r.payment_method, true, true, r.created_at)
      RETURNING id INTO rid;
      INSERT INTO sale_return_items (return_id, sale_item_id, qty, amount)
      SELECT rid, si.id, si.refunded_qty,
             round((si.unit_price * si.refunded_qty * CASE WHEN r.subtotal > 0 THEN r.total / r.subtotal ELSE 1 END)::numeric, 2)
      FROM sale_items si WHERE si.sale_id = r.sale_id AND si.refunded_qty > 0;
    END LOOP;
  END IF;
END $$;

-- 4. Apartados -----------------------------------------------------------------
-- El inventario se descuenta al apartar (queda reservado) y se restituye al cancelar.
-- "Vencido" no se guarda: es un apartado activo cuya fecha limite ya paso.
CREATE TABLE IF NOT EXISTS layaways (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio                 text NOT NULL UNIQUE,
  customer_name         text NOT NULL,
  customer_phone        text,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'delivered', 'cancelled')),
  total                 numeric(12, 2) NOT NULL CHECK (total >= 0),
  due_date              date NOT NULL,
  notes                 text,
  created_by_device_id  uuid REFERENCES devices (id) ON DELETE SET NULL,
  client_op_id          text,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_layaways_client_op ON layaways (client_op_id) WHERE client_op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_layaways_status_due ON layaways (status, due_date);

CREATE TABLE IF NOT EXISTS layaway_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layaway_id   uuid NOT NULL REFERENCES layaways (id) ON DELETE CASCADE,
  product_id   uuid REFERENCES products (id) ON DELETE SET NULL,
  variant_id   uuid REFERENCES product_variants (id) ON DELETE SET NULL,
  description  text NOT NULL,
  unit_price   numeric(12, 2) NOT NULL,
  unit_cost    numeric(12, 2),
  qty          numeric(12, 3) NOT NULL CHECK (qty > 0),
  line_total   numeric(12, 2) NOT NULL,
  reserved     boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_layaway_items_layaway ON layaway_items (layaway_id);

CREATE TABLE IF NOT EXISTS layaway_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layaway_id      uuid NOT NULL REFERENCES layaways (id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('payment', 'refund')),
  method          text NOT NULL CHECK (method IN ('cash', 'bank_transfer')),
  amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_status  text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending', 'rejected')),
  device_id       uuid REFERENCES devices (id) ON DELETE SET NULL,
  client_op_id    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_layaway_payments_client_op ON layaway_payments (client_op_id) WHERE client_op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_layaway_payments_layaway ON layaway_payments (layaway_id);
CREATE INDEX IF NOT EXISTS idx_layaway_payments_created_at ON layaway_payments (created_at);

-- 4b. Tipos de ajuste de inventario para apartados (reserva y liberacion) --------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'stock_adjustments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%adjustment_type%'
  LOOP
    EXECUTE format('ALTER TABLE stock_adjustments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_adjustment_type_check
  CHECK (adjustment_type IN ('manual', 'sale', 'refund', 'layaway', 'layaway_release'));

-- 5. RLS -------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_log','sale_returns','sale_return_items','layaways','layaway_items','layaway_payments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- COMPROBACION POSTERIOR:
--   SELECT id, name, role FROM devices;                       -- los existentes: admin
--   SELECT count(*) FROM sale_returns WHERE legacy;           -- devoluciones anteriores importadas
--   SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1;
