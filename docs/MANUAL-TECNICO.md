# PuntoBase — Manual técnico (patch 2)

## 1. Instalación local
```bash
npm install
cp .env.example .env.local      # llena tus valores (NUNCA subas .env.local)
npm run dev                     # http://localhost:3000
```
Requisitos: Node 20+, un proyecto de Supabase (PostgreSQL), cuenta de Cloudinary (imágenes) y un par VAPID para push.

## 2. Configuración
Variables en `.env.example` (Supabase, VAPID, Cloudinary). La llave `SUPABASE_SERVICE_ROLE_KEY` y `VAPID_PRIVATE_KEY` son solo de servidor.
Par VAPID: `npx web-push generate-vapid-keys` (una sola vez; pública y privada deben ser del mismo par).

## 3. Base de datos
Ejecuta en el editor SQL de Supabase, **en orden y una sola vez por base** (todas son repetibles y no borran datos):
`schema.sql` → `puntobase-migration.sql` → `-2` → `-3` → `-4` → `-5` → **`-6`**.
Antes de la 6 en producción: descarga un respaldo (Ajustes → Respaldo) o usa el de Supabase. Reversión: `puntobase-migration-6-rollback.sql` (comentada a propósito).

### Tablas nuevas / cambios de la migración 6
| Objeto | Para qué |
|---|---|
| `devices.role` (`admin`/`employee`) | Roles. Los dispositivos existentes quedan **admin**. |
| `audit_log` | Bitácora: quién, qué, cuándo, detalle. |
| `product_variants.cost`, `sale_items.unit_cost` | Costo para ganancia estimada (el costo de cada venta se congela al vender). |
| `sale_returns`, `sale_return_items` | Devoluciones sin borrar la venta. Las hechas con `refunded_qty` se importan una vez (`legacy = true`). |
| `layaways`, `layaway_items`, `layaway_payments` | Apartados, partidas y abonos/reembolsos. |
| CHECK de `stock_adjustments.adjustment_type` | Añade `layaway` y `layaway_release`. |
| RLS | Activado en todas las tablas nuevas (sin políticas: la llave anon no ve nada). |

## 4. Arquitectura de permisos
- `proxy.ts` protege **todas** las rutas `/api` por rol (incluidas rutas con corchetes que no se tocaron). Lista en `lib/permissions.ts` (`requiresAdmin`). Si falla la base responde 503 (nunca concede).
- Las rutas nuevas además validan el rol por sí mismas (`lib/guard.ts`).
- Solo administrador: cerrar caja, cancelar apartados, costos, análisis/exportación, respaldo, bitácora, dispositivos/roles, configuración, editar/borrar productos, variantes y categorías. Empleado: vender, cobrar, abonos, devoluciones **del mismo día**, ajustar inventario, transferencias.
- Precios: el servidor compara cada partida con el catálogo. Empleado con precio distinto → 409. Administrador → se permite y queda en bitácora (`sale.price_override`). Venta sincronizada sin conexión con precio distinto → se registra y se marca «requiere revisión».
- La ruta anterior `POST /api/sales/:id/refund` responde 410; todo pasa por `POST /api/returns`.

## 5. Reglas contables
- Devolución: se descuenta en **la fecha de la devolución**; efectivo reduce el efectivo esperado; la venta original no cambia.
- Apartados: abonos son un flujo aparte (no generan fila en `sales`); el inventario se descuenta al apartar y se restituye al cancelar. Transferencias pendientes/rechazadas no cuentan como cobradas.
- Efectivo esperado = fondo + ventas efectivo + abonos efectivo − devoluciones efectivo − reembolsos de apartado − gastos.
- Ganancia estimada = ingreso neto (descuento prorrateado, menos devoluciones) − costo, **solo** de partidas con costo; se muestra la cobertura.

## 6. Respaldo y recuperación (probado)
1. **Respaldar** (admin): Ajustes → Respaldo → JSON. Sin tokens, códigos de acceso ni suscripciones push.
2. **Restaurar**:
   ```bash
   node scripts/backup-to-sql.mjs puntobase-respaldo-AAAA-MM-DD.json > restaurar.sql
   ```
   Corre `restaurar.sql` en Supabase (base con las migraciones aplicadas). Usa `INSERT … ON CONFLICT (id) DO NOTHING`: **no borra ni sobrescribe**. Sirve para base vacía o para recuperar filas borradas.
3. Los dispositivos se restauran **inactivos** con token inutilizable; regístralos de nuevo con el código de acceso (el primero de una base nueva es admin).
4. La configuración de la tienda (`store_config`, código de acceso) no viaja en el respaldo: en una base nueva se vuelve a crear en el registro inicial.
5. Teléfono perdido: desactívalo en Ajustes → Dispositivos. Datos del navegador borrados con ventas sin sincronizar: esas ventas **no son recuperables** desde la app.
Prueba automatizada: `tests/reports.test.ts` exporta una base real (PGlite), restaura en una vacía y compara tablas; también restaurar dos veces y recuperar filas borradas.

## 7. Pruebas
```bash
npm run typecheck && npm test      # 118 pruebas
```
| Archivo | Qué cubre |
|---|---|
| `tests/unit.test.ts`, `api.test.ts`, `offline.test.ts` | Patch 1 (caja, push, idempotencia, cola offline). |
| `tests/patch2.test.ts` | Permisos, proxy, devoluciones, caja, precios, apartados, dispositivos, cierre de sesión. |
| `tests/reports.test.ts` | Análisis, comparación, resurtido, CSV, respaldo y restauración. |
| `tests/conflicts.test.ts` | Conflicto de **dos dispositivos** editando sin conexión (simulado). |
| `tests/migration.test.ts` | Migraciones 1–6 en PostgreSQL real (PGlite), backfill, rollback. |
Las pruebas usan un Supabase simulado en memoria y PGlite; no sustituyen una prueba contra tu proyecto real.

## 8. Despliegue (Vercel)
1. Repositorio en GitHub → importar en Vercel. 2. Variables de entorno de `.env.example`. 3. Build: `npm run build` (webpack, ya configurado). 4. Aplicar la migración 6 en Supabase **antes** de publicar. 5. Probar en el teléfono: instalar la PWA, registrar dispositivos y revisar roles.
Nota: el build baja Google Fonts; sin internet en el servidor de build fallaría (en este entorno se probó con fuentes simuladas).

## 9. Límites conocidos
- Apartados, análisis, respaldo y bitácora requieren internet (por diseño).
- Un solo negocio (sin `tenant_id`).
- «Excel» = CSV con BOM (abre directo en Excel); PDF = imprimir/guardar como PDF del navegador.
- Rutas de carpetas con corchetes vacías en el ZIP original no se auditaron; quedan cubiertas por el proxy.

## Patch 3: tarea diaria, e2e y Lighthouse
- **Aviso de apartados**: `GET /api/cron/layaways` con `Authorization: Bearer $CRON_SECRET` (Vercel Cron lo manda solo). Una notificación por día; no cancela apartados.
- **E2E**: `npm run build && npm run test:e2e` (Chromium, servidor Supabase falso en `e2e/stub-supabase.mjs`).
- **Lighthouse**: resultados y límites en `docs/evidencias/LIGHTHOUSE.md`.
- Entrega y demo: `docs/DEMO-Y-ENTREGA.md`.
