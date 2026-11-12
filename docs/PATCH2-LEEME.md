# PuntoBase — Patch 2 (cierre al 100 %)

## Cómo aplicarlo
1. Respaldo de Supabase (o descarga desde la app). 2. Copia los archivos del patch sobre el proyecto (mismas rutas). 3. `npm install` (sin dependencias nuevas). 4. Ejecuta `supabase/puntobase-migration-6.sql` en Supabase. 5. `npm run typecheck && npm test && npm run build`. 6. Despliega.
No incluye `.env`, claves, `node_modules` ni `.next`. No ejecuta nada sobre producción.

## Qué agrega
| Punto del asesor | Dónde |
|---|---|
| Apartados | `/layaways`, `/api/layaways{,/pay,/confirm,/deliver,/cancel}`, `lib/layaways.ts` |
| Devoluciones/cancelaciones | `/api/returns`, `lib/returns.ts`, pantalla Reportes, caja y reportes netos |
| Análisis, ganancia, exportación | `/analytics`, `/api/reports/{analytics,export}`, `lib/analytics*.ts`, costo en el formulario de producto |
| Roles, permisos, bitácora | `proxy.ts`, `lib/permissions.ts`, `/settings`, `/audit`, `/api/{devices,audit,auth/logout}` |
| Respaldo/recuperación | `/api/backup`, `scripts/backup-to-sql.mjs`, `docs/MANUAL-TECNICO.md` §6 |
| Acabado | estados de carga/error/vacío, confirmaciones, ARIA, `/ayuda`, etiqueta MXN, error en español |
| Técnico | prueba de dos dispositivos, validación de precios en servidor, manual técnico |

## Decisiones que debes conocer
- Los dispositivos **existentes quedan admin**; los nuevos entran como **empleado**.
- Un empleado no puede cambiar precios, cerrar caja ni devolver ventas de días pasados.
- El único administrador no puede cerrar sesión (evita quedarse sin admin).
- `POST /api/sales/:id/refund` queda desactivada (410).
- Migración 6 importa devoluciones previas (`refunded_qty`) una sola vez.
