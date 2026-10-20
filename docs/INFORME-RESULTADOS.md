# Informe de resultados

**Leyenda de pruebas:** 🟢 automatizada y ejecutada · 🟡 simulada (no es dispositivo/servicio real) · 🔴 pendiente.
Pruebas ejecutadas: **62 en 4 archivos (todas pasan)**; `tsc` sin errores; `next build` OK*. Lint: sin errores nuevos (los existentes en `PwaSetup.tsx` y `cash-register/today` ya estaban).
\*El build en el sandbox necesitó simular Google Fonts por falta de red; en tu máquina/Vercel no aplica.

## Hallazgos del ZIP
- Ya existían: Dexie/IndexedDB, cola offline, Background Sync, escáner, semáforo, transferencia pendiente, corte, push base. **Dexie sí está implementado** (no `idb`); backend = Route Handlers de Next.js, no Express (se mantiene, justificado en `ALINEACION-FICHA.md`).
- Defectos reales corregidos: `/api/devices` y otras 4 rutas sin autenticación; tablas sin RLS (llave anon pública); venta offline guardaba la hora de *sincronización*; inventario local no bajaba tras venta offline; ajuste de stock no idempotente (duplicable al reintentar); ventas offline con faltante quedaban atascadas con 409; push sin diagnóstico, sin deduplicación ni preferencias, errores silenciados; sin flujo de rechazo de transferencia; folio por día en UTC.

## Tabla
| Funcionalidad | Estado inicial | Archivos | Cambio | Pruebas | Estado final | Pendiente |
|---|---|---|---|---|---|---|
| Push: suscripción | Básica | `PushToggle.tsx`, `api/push/subscribe`, `api/push/status` | Valida clave VAPID del navegador, autocuración, preferencias por categoría, borrado solo propio, sin duplicados | 🟢 API (idempotente, validación, ownership) | Completo | 🔴 Android/escritorio reales |
| Push: envío y errores | Tragaba errores | `lib/push.ts` | Resultado detallado (aceptada/caducada/fallida), borra 404/410, registra sin secretos, salud por suscripción | 🟢 | Completo | 🔴 entrega real |
| Push: eventos | Solo venta y corte | `lib/push-events.ts`, `sales`, `transfers`, `stock/adjust`, `cash close`, `worker` | Stock bajo/agotado/repuesto, transferencia pendiente/confirmada/rechazada, venta con faltante, venta (opcional), corte con diferencia, sincronización con error/recuperada (local) | 🟢 dedupe y cruces; 🟡 avisos de sync (SW no probado) | Completo | 🔴 SW en dispositivo |
| Push: prueba segura | Cualquier dispositivo registrado a todos | `api/push/test` | Solo al propio dispositivo, límite 1/20 s, 409 si llaves no coinciden, reporte sin secretos | 🟢 | Completo | — |
| Offline: ventas | Sin fecha real ni stock local | `pos/page`, `offline-stock`, `offline-queue`, `api/sales` | Conserva fecha/hora, descuenta inventario local, no se pierde, reintentos con espera, rechazo definitivo visible/descartable | 🟡 IndexedDB simulado: sin red → reabrir → 500 → éxito, 1 sola vez, respuesta perdida | Completo | 🔴 navegador/SW reales |
| Offline: historial y comprobante | No visibles offline | `reports/page`, `LocalReceipt`, `local-sales-view` | Ventas locales en Reportes (con totales por método) y comprobante | 🟢 filtros/totales | Completo | 🔴 UI manual |
| Conflicto de inventario al sincronizar | Venta atascada (409) | `api/sales` | Se acepta, stock a 0, marca «revisar» y avisa | 🟢 | Completo | — |
| Transferencias | Solo confirmar | `api/transfers`, `transfers/page` | Rechazo con motivo, restitución de stock con reversión si falla, una sola resolución, avisos | 🟢 | Completo | 🔴 `confirm-payment` del repo (no visible) |
| Corte de caja | Sin validación ni idempotencia | `cash-math`, `cash-register/close`, `offline-ops` | Validación, idempotente (`client_close_id`), sin doble cierre, cálculo compartido | 🟢 cálculos y duplicados | Completo | — |
| Reportes/Dashboard | Contaban pendientes/rechazadas | `reports/sales`, `dashboard`, `api/sales GET` | Ingresos = cobrado; pendientes aparte; rechazadas fuera | 🟢 reporte | Completo | Dashboard offline (página del servidor) |
| Seguridad | 5 rutas abiertas, sin RLS | migración 5, rutas, `setup`, `next.config` | Auth, RLS, límite de intentos de código, cabeceras | 🟢 401; 🟢 RLS en PostgreSQL real (PGlite) | Mejorado | Límite en memoria por instancia (no global) |
| Migraciones | — | `migration-5(.rollback).sql` | Incrementales y repetibles | 🟢 PGlite (aplicación, repetición, datos intactos, reversión) | Listo | Ejecutar en tu Supabase |
| PWA/SW | `customers` en caché del SW | `next.config.ts` | Se quita `/api/customers` de la caché; `sw.js` sin caché HTTP | 🟢 build | Mejorado | 🔴 Lighthouse, instalación |
| Escáner / catálogo / Cloudinary | Existen | — | No modificados | — | Sin verificar | 🔴 cámara y subida reales |

## No implementado (decisión tuya)
- **Multi-negocio (`tenant_id`)**: requiere agregar columna a todas las tablas y rehacer alta/dispositivos; es un cambio de arquitectura sobre tu base de producción. No lo ejecuté. Hoy: una instalación = un negocio (documentado en la ficha). Dime si lo quieres como fase aparte.
- **Express**: se mantiene Next.js Route Handlers (compatible con Vercel).
- **Devoluciones (`sales/[id]/refund`)**: no visible en el ZIP; no se tocó.

## Limitaciones conocidas
Ventas/stock no son transacciones SQL atómicas (hay reversión manual); precios los envía el cliente; el límite de intentos es por instancia; cachés del SW no se borran al cerrar sesión; Background Sync solo Chromium.
