# Mapa del temario (2.º y 3.er parcial) → PuntoBase

Estado: ✅ está en el código y se probó · 🟡 está, pero no probado en dispositivo real · 📝 es parte del documento escrito del proyecto (no es código)

## 2.º parcial
| Tema | Dónde está en PuntoBase | Estado |
|---|---|---|
| Requisitos de instalación (HTTPS, manifest, SW, íconos) | `public/manifest.json`, íconos 192/512/maskable, `PwaSetup.tsx` (botón Instalar; guía en iOS) | ✅ `npm run test:e2e` |
| Navegadores compatibles | Tabla de la ficha §4.2; Background Sync solo Chromium (la app lo avisa y reintenta al abrir) | 📝 + ✅ |
| Herramientas de desarrollo | Workbox/next-pwa, DevTools, Lighthouse (`docs/evidencias/LIGHTHOUSE.md`), Vitest, Playwright | ✅ |
| Manifiesto | `public/manifest.json` (standalone, tema, shortcuts, maskable) | ✅ |
| App Shell | Layout `(app)` con navegación inferior y banner de conexión; el shell se precachea y abre sin red | ✅ e2e |
| Service worker | next-pwa + Workbox + `worker/index.ts` (sync, push, avisos) | ✅ |
| Notificaciones | `lib/push*.ts`, `PushToggle.tsx`, aviso diario de apartados | 🟡 Android/iOS reales |
| Contenido (caché de datos e imágenes) | StaleWhileRevalidate para `/api/products` y categorías; CacheFirst para fotos | ✅ |
| CSR | Pantallas de la app (`"use client"`, datos desde Dexie/API) | ✅ |
| SSR | `/catalogo` (público, renderizado en servidor) y layouts | ✅ |

## 3.er parcial
| Tema | Dónde está | Estado |
|---|---|---|
| Almacenamiento local / remoto / sincronización | Dexie (IndexedDB) + cola con reintentos + Supabase; idempotencia por `client_*_id` | ✅ pruebas |
| Funcionamiento offline | Ventas, stock y corte sin red; pantalla de ayuda para rutas no abiertas | ✅ |
| Service workers (función) | Caché, Background Sync, push | ✅ |
| Push | VAPID, preferencias por categoría, dedupe | 🟡 |
| Características del dispositivo | Cámara (html5-qrcode / BarcodeDetector), Web Share, almacenamiento persistente, instalación | 🟡 cámara real |
| Tipos y herramientas de pruebas | Unitarias, API, migraciones en PostgreSQL real (PGlite), e2e en Chromium, Lighthouse | ✅ |
| Servicios de publicación | Vercel (HTTPS) + Supabase; `vercel.json`; guía en `MANUAL-TECNICO.md` | 📝 + 🟡 no desplegado desde aquí |
| Instalación y **actualización** | Botón Instalar + **aviso «Hay una nueva versión» con botón Actualizar** (nuevo en patch 3) | ✅ probado en Chromium real |

## Estructura del documento del proyecto (📝)
Portada, índice, introducción, ficha técnica, planteamiento, actividades del 2.º y 3.er parcial, codificación, metodología basada en proyectos, conclusión y referencias **son texto del reporte**: no son código y no los he escrito. Ya tienes ficha y planteamiento; la sección «Codificación» puede apoyarse en `MANUAL-TECNICO.md`, esta tabla y los informes de resultados. Si quieres, te armo esas secciones.

## Checklist: POS y almacenamiento
| Pieza | Estado |
|---|---|
| Catálogo + variantes + categorías + fotos (Cloudinary) | ✅ |
| Escaneo QR/barras y etiquetas QR propias | ✅ 🟡 cámara real |
| Venta: carrito, descuento, efectivo/transferencia, ticket | ✅ |
| Semáforo y bloqueo de agotados | ✅ |
| Transferencias pendientes/confirmar/rechazar | ✅ |
| Apartados, devoluciones, gastos, corte de caja | ✅ (apartados/devoluciones requieren internet) |
| Dashboard, análisis, ganancias, exportar CSV/PDF | ✅ |
| Roles, bitácora, respaldo/restauración | ✅ |
| IndexedDB (Dexie) + cola con reintentos + idempotencia | ✅ |
| Panel «Almacenamiento y sincronización» (Ajustes): espacio usado, almacenamiento protegido, pendientes, errores, sincronizar ahora, **descargar pendientes**, limpiar caché sin tocar ventas | ✅ **nuevo** |
