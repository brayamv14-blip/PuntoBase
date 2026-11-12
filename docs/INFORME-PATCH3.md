# Informe — Patch 3

## Qué se agregó
| Cambio | Estado |
|---|---|
| Aviso diario de apartados vencidos / por vencer (`/api/cron/layaways` + `vercel.json`); solo avisa, **no libera** inventario | Implementado · probado (4 pruebas) · **no ejecutado en Vercel real** |
| Pantalla sin conexión para rutas nunca abiertas (`fallbacks.document`) | Implementado · **probado en Chromium real** |
| Pruebas en navegador real (Playwright): manifest, iconos, SW sin caché HTTP, rutas protegidas, modo sin conexión | Implementado · ejecutado: 4/4 (5 corridas seguidas) |
| Lighthouse 12 (móvil) en 14 pantallas | **Ejecutado** → `docs/evidencias/LIGHTHOUSE.md` |
| Accesibilidad: 2 controles sin etiqueta en Reportes, letra < 12 px, enlace «Más» → «Ajustes», contraste en Gastos | Corregido · Gastos sin re-medir |
| 2 errores de lint previos (`cash-register/today`, `PwaSetup`) | Corregidos · 0 errores |
| Aviso «Hay una nueva versión» con botón Actualizar (ciclo de actualización de la PWA, tema del 3.er parcial) | Implementado · **probado en Chromium real** (0 avisos antes de publicar una versión nueva, 1 después); no está como prueba automática |
| Panel «Almacenamiento y sincronización» en Ajustes (espacio, pendientes, errores, sincronizar ahora, descargar pendientes para respaldo si se pierde el teléfono, limpiar caché sin borrar ventas) | Implementado · 2 pruebas unitarias + 1 e2e en Chromium |
| Mapa del temario → proyecto (`docs/MAPA-CURRICULAR.md`) | Documento |
| Guion de demo y lista de entrega (`docs/DEMO-Y-ENTREGA.md`) | Documento |

## Resultados reales
- `tsc` limpio · lint 0 errores · **124/124** pruebas · build de producción OK · e2e 4/4.
- Lighthouse (stub vacío): accesibilidad 100 en 13/14 pantallas; buenas prácticas 100 en 13/14; SEO 100. Rendimiento 75–99 (varía por corrida).

## Hallazgo del e2e
Una corrida falló porque se fue a modo sin conexión antes de que el service worker guardara la pantalla de ayuda.
Es una condición real (primera apertura). La prueba ahora espera ese guardado. Tras el cambio: 5/5 corridas seguidas.

## Sigue pendiente (honesto)
- **Multi-negocio (`tenant_id`)**: no implementado. La ficha §3.2.10 limita el alcance del curso al núcleo offline-first de un negocio. Hacerlo toca todas las consultas y RLS; no lo recomiendo meter a última hora.
- Pruebas con teléfonos reales (cámara, push, Background Sync) y con Supabase/Cloudinary reales.
- Devoluciones, apartados y análisis requieren internet (no hay cola offline para ellos).
- Excel = CSV con BOM; PDF = impresión del navegador.
- Rutas con corchetes sin revisar (llegaron vacías).
- Límite de peticiones en memoria (por instancia).
- Operaciones de ventas/stock no son transacciones SQL atómicas (reversión manual en código).
- Demo en video: no producida.
