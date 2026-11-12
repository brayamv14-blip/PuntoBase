# Informe de resultados — Patch 2

Leyenda: **A** = implementado y probado automáticamente · **S** = simulado (sin sistema real) · **P** = pendiente.

| Requisito | Estado | Evidencia / nota |
|---|---|---|
| Apartados (folio, anticipo, fecha límite, reserva, abonos, entrega, cancelar/liberar, listas activo/vencido/entregado/cancelado) | A | `patch2.test.ts` (API con Supabase simulado) + migración probada en PostgreSQL real. UI sin prueba en navegador. |
| Vencimiento automático | P | «Vencido» se calcula por fecha; la liberación de inventario es manual (admin). Sin tarea programada. |
| Devoluciones sin borrar venta, sin duplicar ni exceder, ajustan inventario/caja/reportes | A | Pruebas de API, cálculo y migración (backfill). Carrera simultánea: verificación posterior implementada, probada en secuencia, no con concurrencia real. |
| Análisis: filtros, comparación, ganancia, resurtido, cobrado/pendiente | A | `reports.test.ts` (funciones puras). Pantalla sin prueba visual. |
| Exportación | A/S | CSV probado (BOM, escape). «Excel» = CSV; PDF = imprimir del navegador (no probado en navegador). |
| Roles, permisos por ruta, bitácora, cierre de sesión | A | `patch2.test.ts` incluye proxy. Roles en la UI sin prueba en navegador. |
| Respaldo y restauración documentada | A | Exportar→restaurar en PostgreSQL real (PGlite); no se probó contra Supabase real. |
| Conflicto de dos dispositivos | S | `conflicts.test.ts`: servidor y cola simulados; no son dos teléfonos. |
| Validación de precios/cantidades/permisos/pagos en servidor | A | `patch2.test.ts`. |
| Acabado (estados, validaciones, confirmaciones, responsivo, accesibilidad, ayuda) | Parcial | Implementado; **no auditado** con herramienta de accesibilidad ni en dispositivos. |
| Lighthouse | P | Se intentó; el Chromium del entorno es más viejo de lo que exige Lighthouse. Ejecútalo en tu equipo sobre el despliegue. |
| Demo / video | P | No se genera aquí. |
| Prueba en Supabase y dispositivos reales | P | Aplica migración 6 en una copia primero. |

## Resultados ejecutados
- `tsc --noEmit`: limpio. `vitest`: **118/118** (62 anteriores + 56 nuevas). Build de producción: correcto (fuentes simuladas).
- Mutaciones: 5 de 5 regresiones introducidas a propósito (permiso de cancelar, resta de devoluciones en caja, tope de abono, restricción de precio, límite de devolución por día) fueron detectadas.
- Lint: sin errores nuevos; 2 errores previos en archivos del proyecto base (`today/route.ts`, `PwaSetup.tsx`).

## Riesgos abiertos
- Las rutas con corchetes (`products/[id]`, variantes, categorías, `sales/[id]`) llegaron vacías en el ZIP; su protección depende del proxy, no se revisó su código.
- Multi-tenant sin decidir (hoy una sola tienda).
- Los apartados no funcionan sin internet.
