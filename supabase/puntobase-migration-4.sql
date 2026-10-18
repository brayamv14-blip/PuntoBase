-- PuntoBase: migracion 4 (ejecutar despues de puntobase-migration-3.sql)

-- Notificaciones push (Web Push): una fila por navegador/dispositivo suscrito
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   uuid REFERENCES devices(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON push_subscriptions (device_id);

-- Imagen del producto (URL de Cloudinary)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
