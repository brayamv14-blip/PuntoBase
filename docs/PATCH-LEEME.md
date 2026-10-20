# Patch PuntoBase — cómo aplicarlo y probarlo

## 1. Antes de empezar
- El ZIP que se auditó traía **vacías** las carpetas con corchetes (`products/[id]`, `products/[id]/variants/[vid]`, `categories/[id]`, `sales/[id]` con `confirm-payment`, `pdf`, `refund`, y `pos/receipt/[saleId]`). Este patch **no las toca**; conserva las tuyas. Al comprimir, usa `git archive` o 7-Zip (Compress-Archive de PowerShell pierde archivos en rutas con `[ ]`).
- Haz una rama: `git checkout -b mejoras-auditoria`.

## 2. Aplicar
Opción A (patch):
```bash
git apply --whitespace=nowarn puntobase-auditoria.patch
```
Opción B (ZIP): descomprime `puntobase-archivos-modificados.zip` en la raíz del repo y acepta reemplazar. Rutas originales conservadas.

```bash
npm install
npm run typecheck
npm test
npm run build
```
Los archivos generados por next-pwa (`public/sw.js`, `workbox-*`, `worker-*`, `swe-worker-*`) ya están en `.gitignore`. Si estaban versionados: `git rm --cached public/sw.js public/workbox-*.js public/worker-*.js public/swe-worker-*.js`.

## 3. Base de datos (Supabase → SQL Editor)
Orden: `schema.sql` → `puntobase-migration.sql` → `-2` → `-3` → `-4` → **`puntobase-migration-5.sql`** (nueva).
- Solo la 5 es nueva para ti. No borra datos; se puede ejecutar más de una vez.
- Haz un respaldo antes (Supabase → Database → Backups).
- **Previa:** `SELECT payment_status, count(*) FROM sales GROUP BY 1;`
- **Posterior:** `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';` → todas `true`.
- Reversión: `puntobase-migration-5-rollback.sql` (no desactiva RLS).
- Importante: la migración 5 activa **RLS sin políticas**. La app usa solo la llave `service_role` en el servidor (omite RLS), por lo que sigue funcionando; la llave `anon` pública deja de dar acceso a tus tablas.

## 4. Variables de entorno (local `.env.local` y Vercel)
Ver `.env.example`. Obligatorias: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Push: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Imágenes: `CLOUDINARY_*`.

**Claves VAPID:** `npx web-push generate-vapid-keys` (una sola vez). Pública → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; privada → `VAPID_PRIVATE_KEY`. Si cambias el par, vuelve a desplegar y reactiva las notificaciones en cada dispositivo. La app **comprueba que correspondan** (panel push y `/api/push/test` responden 409 si no).

## 5. Publicar en Vercel
```bash
git add -A && git commit -m "Auditoría: push, offline, transferencias, caja, seguridad"
git push origin mejoras-auditoria   # prueba el Preview; luego merge a main
```
Tras el deploy: abre la app, recarga una vez para que se instale el nuevo Service Worker.

## 6. Probar notificaciones
**Android (Chrome):** instala la PWA → Dashboard → «Notificaciones push» → Activar → Probar. Abre «Ver estado y preferencias»: debe decir llaves ✓, suscripción registrada ✓ y «1 aceptada». Cierra la app y vuelve a probar.
**Escritorio (Chrome/Edge):** igual; permiso en el candado de la barra.
**Eventos reales:** vende hasta que un producto llegue al mínimo (aviso «Inventario bajo»), a 0 («agotado»); vende por transferencia desde otro dispositivo (aviso «Transferencia pendiente»); confirma/rechaza en Transferencias; cierra caja con diferencia.
**«Aceptada» ≠ entregada:** significa que el servicio push del navegador recibió el mensaje.
**iOS:** solo iOS/iPadOS 16.4+ y **con la PWA instalada en la pantalla de inicio**; Safari no tiene Background Sync (se usa el respaldo: evento `online` + «Sincronizar ahora») y WebKit limita la cuota de IndexedDB.

## 7. Guía de pruebas offline (Chrome DevTools)
1. Con internet, abre Inventario y POS (carga el catálogo). 2. DevTools → Application → Service Workers → **Offline**. 3. Vende algo: se muestra comprobante «pendiente de sincronizar» y el inventario baja. 4. Reportes: aparece la venta en «Ventas de este dispositivo»; ábrela para ver el comprobante. 5. Cierra y abre la pestaña/app: sigue ahí. 6. Quita Offline: la barra sincroniza; la venta aparece una sola vez y con su hora original. 7. Repite con el servidor fallando (apaga la red de Vercel/usa una URL inválida): la venta espera con reintentos y no se pierde.
Dashboard y Catálogo son páginas del servidor: sin conexión solo abren si ya se visitaron.

## 8. Cambios principales
Ver `docs/INFORME-RESULTADOS.md`.
