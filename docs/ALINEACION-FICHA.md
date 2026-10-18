# Alineación entre la Ficha Técnica y el código

Diferencias que quedan entre el documento y lo construido. Conviene **ajustar el texto del
documento** (las líneas marcadas) antes de entregarlo; el resto ya coincide.

## Ya implementado (coincide con la Ficha)

| Ficha | Dónde está |
|---|---|
| PWA instalable, manifest, modo standalone | `public/manifest.json`, `components/layout/PwaSetup.tsx` |
| Service Worker con Workbox (next-pwa) | `next.config.ts` |
| Cache-First para estáticos, StaleWhileRevalidate para catálogo | `next.config.ts` (valores por defecto + `api-cache`) |
| Datos locales en IndexedDB (productos, ventas, cola) | `lib/catalog-cache.ts`, `lib/local-sales.ts`, `lib/offline-queue.ts`, `lib/offline-ops.ts` |
| Background Sync API + cola de eventos | `worker/index.ts`, `lib/background-sync.ts` |
| Escaneo QR/barras con la cámara (`html5-qrcode`) en alta, inventario y POS | `components/scanner/Scanner.tsx` |
| Semáforo (verde/amarillo/rojo) y bloqueo de agotados | `lib/stock-status.ts` |
| Cobro en efectivo y transferencia pendiente + "Confirmar pago" | `app/api/sales/**` |
| Corte de caja (fondo + efectivo − gastos, diferencia, desglose de transferencias) | `app/(app)/eod`, `app/api/cash-register/**` |
| Dashboard: ventas por día/hora, Top 10, alertas y lista de compras | `app/(app)/dashboard`, `components/dashboard/**` |
| Catálogo web para clientes | `app/catalogo` |
| Limitante 3: Last Write Wins con aviso al usuario | `lib/offline-ops.ts` (`update_product`, `takeNotices`) |
| Limitantes 4 y 5: almacenamiento acotado / iOS | `PwaSetup.tsx` (almacenamiento persistente y aviso de poco espacio), botón de sincronizar como respaldo |

## Diferencias que debes corregir en el texto

| El documento dice | El código hace | Qué hacer |
|---|---|---|
| IndexedDB con **Dexie.js** | IndexedDB con la librería **`idb`** | Cambiar el texto a `idb` (envoltorio ligero de IndexedDB). |
| Backend **Node.js + Express** | Route handlers de Next.js (`app/api`) sobre Node.js | Cambiar el texto: "API REST con Next.js Route Handlers". |
| PostgreSQL **multi-tenant con `tenant_id`** | Un negocio por instalación, PostgreSQL en Supabase | Mover multi-tenant a "trabajo futuro". |
| **Cloudinary** para imágenes | No se suben imágenes de producto | Quitarlo del stack o marcarlo como futuro. |
| `BarcodeDetector` como respaldo del escáner | Solo `html5-qrcode` | Quitar la mención o marcarla como futura. |
| Hosting con Firebase/Netlify/Vercel | Next.js desplegable en Vercel | Indicar la opción realmente usada. |
