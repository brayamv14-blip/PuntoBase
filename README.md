# PuntoBase — Plataforma PWA para la Gestión de Pequeños Negocios

Proyecto de la materia *Aplicaciones Web Progresivas* (DGS 1002, UTFV, profesora Sandra Alfaro Linares).
PWA offline-first para controlar inventario con códigos QR/barras, ventas en mostrador (efectivo y
transferencia), corte de caja y estadísticas, pensada para pequeños negocios con internet inestable.

> Base de código: [ardiChuan/POS-StockManagement](https://github.com/ardiChuan/POS-StockManagement)
> (el repositorio original no declara licencia; se usa como punto de partida con conocimiento de la
> profesora y se documentan abajo los cambios del equipo).

## Funcionalidades

| Módulo | Qué hace |
|---|---|
| Escáner QR/barras | `html5-qrcode` con la cámara trasera. Se usa para dar de alta productos, buscar en inventario y **agregar al carrito en el POS**. |
| Semáforo de inventario | Verde (sobre el mínimo), amarillo (igual o menor al mínimo), rojo (agotado; bloquea la venta). `lib/stock-status.ts`. |
| Ventas | Efectivo (cobrada al instante) y transferencia (**pendiente** hasta "Confirmar pago" en la **bandeja Transferencias**). Ambas funcionan sin conexión. Descuenta inventario al vender. |
| Corte de caja | Efectivo esperado = fondo inicial + ventas en efectivo − gastos; diferencia contra lo contado; **desglose de transferencias confirmadas y pendientes**. |
| Dashboard | Ventas por día (7 días), ventas por hora (hoy), **Top 10 más vendidos**, alertas de inventario bajo y **lista de compras** con un clic. |
| Catálogo web | Página pública `/catalogo` (nombre, precio y disponibilidad; sin cantidades exactas). Se comparte desde el dashboard. |
| Offline-first | Catálogo, ventas, altas y **ediciones** de producto y corte de caja se guardan primero en IndexedDB. |
| Sincronización | **Background Sync API** (`worker/index.ts`) + respaldo con el evento `online` y botón "Sincronizar ahora". Ventas idempotentes con `client_sale_id`, altas con `client_id`. Operaciones rechazadas se pueden reintentar o descartar. |
| Instalación | Manifest completo (iconos 192/512 y *maskable*, accesos directos), botón "Instalar" (Chrome/Edge/Android) e instrucciones para iOS, y almacenamiento persistente (`components/layout/PwaSetup.tsx`). |
| Zona horaria y moneda | Días, cortes y reportes en hora de la Ciudad de México; montos en pesos (MXN). `lib/utils.ts`. |

## Arquitectura

- Next.js (App Router) + `@ducanh2912/next-pwa` (Service Worker, Workbox, manifest).
- API REST con *route handlers* de Next.js (`app/api/**`) y PostgreSQL en Supabase.
- IndexedDB con la librería `idb`: `lib/catalog-cache.ts`, `lib/local-sales.ts`, `lib/offline-queue.ts`, `lib/offline-ops.ts`.
- Conflictos: **Last Write Wins**. Si un producto se editó en otro dispositivo mientras este estaba sin conexión, se aplica el cambio local y se muestra un aviso con los campos sobrescritos (`lib/offline-ops.ts`). Los ajustes de inventario se envían como diferencia (+/−), así no pisan ventas hechas mientras tanto. Las ventas son idempotentes por `client_sale_id`.

## Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
```

## Base de datos

Ejecutar en Supabase, en este orden: `supabase/schema.sql`, `supabase/puntobase-migration.sql`,
`supabase/puntobase-migration-2.sql`, `supabase/puntobase-migration-3.sql`.

## Desarrollo

```bash
npm install
npm run dev      # el Service Worker se desactiva en desarrollo
npm run build && npm start   # para probar la PWA y Background Sync
```

Probar offline: Chrome → DevTools → Application → Service Workers → Offline. Probar Background
Sync: marcar "Offline", vender, desmarcar y revisar "Sync" en la misma pestaña.

## Limitantes del MVP

- Solo efectivo y transferencia manual; sin tarjeta ni pasarelas de pago.
- Altas y ediciones de producto sin conexión solo para productos sin variantes.
- Safari/iOS no soporta Background Sync: se usa el evento `online` y el botón de sincronizar.
- Un solo negocio por instalación (sin `tenant_id` multi-negocio todavía).
- El día de negocio es el de la Ciudad de México (UTC−6 fijo; México ya no usa horario de verano). Para otra zona, cambia `APP_TIMEZONE` y el desfase en `lib/utils.ts`.

## Créditos y cambios del equipo

Cambios sobre la base original: marca PuntoBase, eliminación del módulo de peces, escáner con cámara,
semáforo, transferencia pendiente con "Confirmar pago", catálogo en caché, ventas locales, cola
offline, Background Sync, estadísticas, catálogo público, desglose de transferencias en el corte, edición offline con Last Write Wins, instalación PWA, zona horaria y moneda de México. Guía de uso en `docs/GUIA-USUARIO.md`.
