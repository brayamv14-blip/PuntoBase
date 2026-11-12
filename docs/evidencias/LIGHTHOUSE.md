# Evidencia Lighthouse (real)

Medido con Lighthouse 12 sobre Chrome 153 (headless), emulación móvil, build de producción (`next start`),
contra un servidor Supabase **falso y vacío** (`e2e/stub-supabase.mjs`). Por eso las pantallas se ven en estado vacío.
El rendimiento varía entre corridas (±10 puntos); acceso, buenas prácticas y SEO fueron estables.

| Pantalla | Rendimiento | Accesibilidad | Buenas prácticas | SEO |
|---|---|---|---|---|
| /analytics | 84 | 100 | 100 | 100 |
| /audit | 86 | 100 | 100 | 100 |
| /ayuda | 93 | 100 | 100 | 100 |
| /catalogo | 99 | 100 | 100 | 100 |
| /dashboard | 84 | 100 | 100 | 100 |
| /eod | 84 | 100 | 96 | 100 |
| /expenses | 95 | 96 | 100 | 100 |
| /layaways | 96 | 100 | 100 | 100 |
| /pos | 94 | 100 | 100 | 100 |
| /products | 78 | 100 | 100 | 100 |
| /reports | 75 | 100 | 100 | 100 |
| /settings | 87 | 100 | 100 | 100 |
| /setup | 89 | 100 | 100 | 100 |
| /transfers | 97 | 100 | 100 | 100 |

Notas:
- `/eod` marca 96 en buenas prácticas por un error 500 en consola: el servidor falso no devuelve la fila recién creada de `cash_register`. No ocurre con una base real (probado en `tests/`).
- `/expenses` marcó 96 en accesibilidad por contraste del rojo; se corrigió (`text-red-700`) después de esta medición y **no se volvió a medir**.
- No se midió Lighthouse sobre un despliegue real (HTTPS, Supabase real, red real): hazlo antes de la entrega con tus datos.
- La categoría PWA ya no existe en Lighthouse 12; la instalabilidad y el modo sin conexión se verifican con `npm run test:e2e`.
