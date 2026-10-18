# Alineación entre la Ficha Técnica y el código

Diferencias entre lo que dice el documento y lo que está construido. Conviene **ajustar el texto
del documento** (o implementar lo que falte) antes de entregarlo.

| El documento dice | El código hace | Qué hacer |
|---|---|---|
| IndexedDB con **Dexie.js** | IndexedDB con la librería **`idb`** | Cambiar el texto a `idb` (envoltorio ligero de IndexedDB). |
| Backend **Node.js + Express** | Route handlers de Next.js (`app/api`) sobre Node.js | Cambiar el texto: "API REST con Next.js Route Handlers". |
| PostgreSQL **multi-tenant con `tenant_id`** | Un negocio por instalación, PostgreSQL en Supabase | Mover multi-tenant a "trabajo futuro" o implementarlo. |
| **Cloudinary** para imágenes | No se suben imágenes de producto | Quitarlo del stack o marcarlo como futuro. |
| `BarcodeDetector` como respaldo del escáner | Solo `html5-qrcode` | Quitar la mención o marcarla como futura. |
| Estrategia Cache-First para estáticos y StaleWhileRevalidate para catálogo | StaleWhileRevalidate para `/api/products`, `/api/categories` y `/api/customers` + valores por defecto de next-pwa | Coincide en lo esencial. |
| Background Sync API | Implementada en `worker/index.ts` (Chrome/Edge/Android) con respaldo en Safari/Firefox | Documentar el respaldo. |
