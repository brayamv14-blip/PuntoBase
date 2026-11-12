# Patch 3 — cómo aplicarlo

Va encima de los patches 1 y 2. Copia los archivos del ZIP respetando las rutas (o `git apply patch3.diff`).

```bash
npm install            # agrega @playwright/test (solo desarrollo)
npm run typecheck && npm test
npm run build && npm run test:e2e     # navegador real; no necesita Supabase
```

## Variables nuevas
- `CRON_SECRET` (≥ 16 caracteres). En Vercel, `vercel.json` ya programa `/api/cron/layaways` a las 14:00 UTC (08:00 CDMX).
  Sin la variable, la ruta responde 503 (no queda abierta).

## Sin migraciones SQL nuevas
No toca la base de datos.

## Rutas con corchetes
Tu ZIP trajo vacías `products/[id]`, `variants/[vid]`, `categories/[id]`, `sales/[id]/*` y `pos/receipt/[saleId]`.
Este patch **no las toca** (no las vi, no las puedo revisar). Si quieres que se revisen, envíalas.
