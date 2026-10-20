-- PuntoBase: migracion 5 (ejecutar despues de puntobase-migration-4.sql)
-- Incremental y repetible (IF NOT EXISTS / comprobaciones). NO borra tablas, columnas ni datos.
--
-- Contenido:
--   1. Push: preferencias por dispositivo, diagnostico de entrega y tabla de deduplicacion de eventos.
--   2. Ventas: estado 'rejected' (transferencia rechazada), banderas de atencion.
--   3. Idempotencia de ajustes de inventario y de cortes de caja hechos sin conexion.
--   4. Seguridad: RLS activado en todas las tablas (sin politicas = anon/authenticated sin acceso).
--
-- COMPROBACION PREVIA (opcional): ver al final del archivo.

-- 1. Push ---------------------------------------------------------------------
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL
    DEFAULT '{"stock":true,"transfers":true,"sales":false,"sync":true,"cash":true}'::jsonb;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_error_at timestamptz;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_error_status integer;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;

-- Una fila por evento ya notificado: evita avisos repetidos ante reintentos/sincronizaciones.
CREATE TABLE IF NOT EXISTS push_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key   text NOT NULL UNIQUE,
  category    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_events_created_at ON push_events (created_at);

-- 2. Ventas -------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'sales'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
  LOOP
    EXECUTE format('ALTER TABLE sales DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE sales ADD CONSTRAINT sales_payment_status_check
  CHECK (payment_status IN ('paid', 'pending', 'rejected'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS needs_attention boolean NOT NULL DEFAULT false;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS attention_note text;

-- 3. Idempotencia -------------------------------------------------------------
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS client_op_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_adjustments_client_op
  ON stock_adjustments (client_op_id) WHERE client_op_id IS NOT NULL;

ALTER TABLE cash_register ADD COLUMN IF NOT EXISTS client_close_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_register_client_close
  ON cash_register (client_close_id) WHERE client_close_id IS NOT NULL;

-- 4. RLS ----------------------------------------------------------------------
-- La app solo usa la llave service_role desde el servidor (omite RLS). Con RLS activo y SIN
-- politicas, la llave anon (publica en el navegador) no puede leer ni escribir nada.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'store_config','devices','categories','products','product_variants','customers',
    'sales','sale_items','expenses','stock_adjustments','cash_register',
    'push_subscriptions','push_events'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- COMPROBACION POSTERIOR (ejecutar manualmente):
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1;   -- todas true
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sales_payment_status_check';
