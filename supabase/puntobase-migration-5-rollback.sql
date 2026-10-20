-- Reversion de la migracion 5 (solo si es necesario). Ejecutar en una ventana de mantenimiento.
-- No borra datos de negocio; los estados 'rejected' deben convertirse antes de restaurar el CHECK.

-- UPDATE sales SET payment_status = 'pending' WHERE payment_status = 'rejected';  -- decidir antes de revertir
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_status_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_status_check CHECK (payment_status IN ('paid', 'pending'));

DROP INDEX IF EXISTS idx_stock_adjustments_client_op;
DROP INDEX IF EXISTS idx_cash_register_client_close;
-- Las columnas nuevas son inocuas; se conservan. Para quitarlas:
-- ALTER TABLE sales DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS reject_reason,
--   DROP COLUMN IF EXISTS needs_attention, DROP COLUMN IF EXISTS attention_note;
-- ALTER TABLE stock_adjustments DROP COLUMN IF EXISTS client_op_id;
-- ALTER TABLE cash_register DROP COLUMN IF EXISTS client_close_id;
-- DROP TABLE IF EXISTS push_events;

-- RLS: desactivarlo vuelve a exponer las tablas a la llave anon. NO recomendado.
-- ALTER TABLE public.<tabla> DISABLE ROW LEVEL SECURITY;
