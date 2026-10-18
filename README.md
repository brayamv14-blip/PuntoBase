# PuntoBase — Plataforma PWA para la Gestión de Pequeños Negocios

Proyecto de la materia *Aplicaciones Web Progresivas* (DGS 1002, UTFV, profesora Sandra Alfaro Linares).
PWA offline-first para controlar inventario con códigos QR/barras, ventas en mostrador (efectivo y
transferencia), corte de caja, estadísticas, catálogo web y notificaciones push, pensada para
pequeños negocios con internet inestable.

> Base de código: [ardiChuan/POS-StockManagement](https://github.com/ardiChuan/POS-StockManagement)
> (el repositorio original no declara licencia; se usa como punto de partida con conocimiento de la
> profesora). Los cambios del equipo están descritos al final.

## Funcionalidades

| Módulo | Qué hace |
|---|---|
| Escáner QR/barras | `html5-qrcode` con la cámara trasera (usa `BarcodeDetector` nativo si existe). Sirve para dar de alta, buscar en inventario y **agregar al carrito en el POS**. |
| QR propios | Genera un código `PB-XXXXXXXX` para productos sin código de fábrica e imprime la etiqueta. |
| Semáforo de inventario | Verde, amarillo (igual o menor al mínimo) y rojo (agotado: bloquea la venta). |
| Ventas | Efectivo (cobrada al instante) y transferencia (**pendiente** hasta "Confirmar pago" en la bandeja **Transferencias**). Ambas funcionan sin conexión. |
| Corte de caja | Efectivo esperado = fondo inicial + ventas en efectivo − retiros; diferencia contra lo contado; desglose de transferencias confirmadas y pendientes. También sin conexión. |
| Dashboard | Ventas por día y por hora, Top 10 más vendidos, alertas de inventario y lista de compras con un clic. |
| Catálogo web | Página pública `/catalogo` (nombre, foto, precio y disponibilidad). |
| Notificaciones push | Avisos de producto agotado/bajo, transferencias por confirmar y cortes con diferencia. Se activan desde el dashboard. |
| Fotos | Imágenes de producto en Cloudinary (subida firmada, entrega optimizada, caché offline). |
| Offline-first | Todo se guarda primero en IndexedDB (Dexie) y se sincroniza al reconectar. |
| Sincronización | **Background Sync API** (`worker/index.ts`) + respaldo con evento `online` y botón "Sincronizar ahora". Ventas idempotentes con `client_sale_id`. |

## Arquitectura

- Next.js (App Router) + `@ducanh2912/next-pwa` (Service Worker, Workbox, manifest).
- API REST con *route handlers* de Next.js y PostgreSQL en Supabase.
- IndexedDB con **Dexie.js**: `lib/db.ts` (tablas `products`, `categories`, `local_sales`, `pending_sales`, `pending_ops`). Importa una sola vez los datos de la versión anterior.
- Notificaciones con Web Push (`web-push`, llaves VAPID).
- Conflictos: última escritura gana, con aviso al usuario; las ventas son idempotentes.

## Configuración

1. Copia `.env.example` a `.env.local` y llena los valores.
2. Llaves de notificaciones: `npx web-push generate-vapid-keys` (pública en `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, privada en `VAPID_PRIVATE_KEY`).
3. Cloudinary: cuenta gratuita en cloudinary.com; copia `cloud name`, `API key` y `API secret`.
4. En Supabase ejecuta, en orden: `supabase/schema.sql`, `puntobase-migration.sql`, `puntobase-migration-2.sql`, `puntobase-migration-3.sql` y `puntobase-migration-4.sql`.

## Desarrollo y pruebas

```bash
npm install
npm run dev                  # el Service Worker se desactiva en desarrollo
npm run build && npm start   # para probar la PWA, Background Sync y push
```

- Offline: Chrome → DevTools → Application → Service Workers → Offline.
- Background Sync: marca Offline, vende, desmarca y revisa la sección Sync.
- Auditoría: DevTools → Lighthouse → categoría PWA.
- Push requiere HTTPS (o `localhost`). En iPhone/iPad: instalar la app en la pantalla de inicio (iOS 16.4+).

## Limitantes del MVP

- Solo efectivo y transferencia manual; sin tarjeta ni pasarelas de pago.
- Edición offline de productos con variantes y subida de fotos requieren conexión.
- Safari/iOS no soporta Background Sync: se usa el evento `online` y el botón de sincronizar.
- Un solo negocio por instalación (sin `tenant_id` multi-negocio).
- El backend usa route handlers de Next.js en lugar de Express.

## Cambios del equipo sobre la base

Marca PuntoBase, eliminación del módulo de peces y del logo original, escáner con cámara y QR propios,
semáforo, transferencia pendiente con bandeja, catálogo en caché, cola offline sobre Dexie, Background
Sync, notificaciones push, estadísticas, catálogo público, fotos con Cloudinary y corte de caja con
desglose de transferencias.
