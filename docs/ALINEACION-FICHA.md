# Alineación entre la Ficha Técnica y el código

Estado de cada punto del documento (Ficha Técnica, secciones 3 y 4).

## Funcionalidades (sección 3.2.5 y 3.2.10)

| Requisito | Dónde está |
|---|---|
| Offline-first, cola y sincronización | `lib/db.ts` (Dexie), `lib/offline-queue.ts`, `lib/offline-ops.ts`, `worker/index.ts` |
| Alta de producto, venta y corte de caja sin conexión | `ProductForm`, POS, EOD (todas usan la cola local) |
| Background Sync API | `worker/index.ts` + `lib/background-sync.ts` (respaldo: evento `online` y botón "Sincronizar ahora") |
| Escaneo QR/barras con cámara | `components/scanner/Scanner.tsx` (`html5-qrcode` con `BarcodeDetector` nativo cuando existe) |
| QR propios generados por la PWA | `components/products/QrLabelButton.tsx` (genera `PB-XXXXXXXX`, imprime etiqueta) |
| Semáforo de inventario | `lib/stock-status.ts`, inventario y POS (rojo bloquea la venta) |
| Transferencia pendiente + Confirmar pago | POS, `app/(app)/transfers` (bandeja) |
| Corte de caja con diferencias y desglose de transferencias | `app/(app)/eod`, `app/api/cash-register` |
| Dashboard: ventas por día y hora, Top 10, alertas y lista de compras | `components/dashboard/*` |
| Catálogo web para clientes | `app/catalogo` |
| Notificaciones push | `lib/push.ts`, `lib/push-events.ts`, `app/api/push/*`, `components/push/PushToggle.tsx`, `worker/index.ts` |
| Imágenes de producto (Cloudinary) | `lib/cloudinary.ts`, `app/api/uploads/sign`, `ProductImageField` |
| Last Write Wins con aviso al usuario | `lib/offline-ops.ts` (avisos) |

## Pila tecnológica (sección 4)

| Documento | Código |
|---|---|
| Next.js + React + next-pwa | Igual (`@ducanh2912/next-pwa`) |
| Workbox: Cache-First y StaleWhileRevalidate | Igual (`next.config.ts`; también cache de fotos de Cloudinary) |
| IndexedDB con Dexie.js | Igual (`lib/db.ts`: tablas `products`, `categories`, `local_sales`, `pending_sales`, `pending_ops`) |
| html5-qrcode + BarcodeDetector | Igual |
| Background Sync + cola de eventos | Igual |
| Cloudinary | Igual (subida firmada desde el servidor) |
| PostgreSQL | Supabase (PostgreSQL administrado) |
| Backend Node.js con Express | **Route handlers de Next.js** (corren sobre Node.js, mismas rutas REST) |
| Multi-tenant con `tenant_id` | **No implementado:** una instalación = un negocio |
| Figma, Trello, Git/GitHub | Herramientas de gestión: no aplican al código |

## Pendientes reales

- **Express**: el backend usa los route handlers de Next.js. Mantener Express obligaría a un servidor propio y dejaría de funcionar en Vercel/Netlify (hosting que la propia Ficha propone). Conviene redactar: "API REST con Next.js Route Handlers sobre Node.js".
- **`tenant_id` multi-negocio**: requiere agregar la columna a todas las tablas, filtrar cada consulta por negocio y rehacer el alta de dispositivos. Conviene documentarlo como "siguiente fase" o implementarlo como trabajo aparte.
