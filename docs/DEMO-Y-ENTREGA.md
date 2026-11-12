# Guion de demostración y lista de entrega

## Antes de la demo (10 min)
- [ ] Desplegado en HTTPS (Vercel) con las variables de `.env.example` y la migración 5 y 6 aplicadas.
- [ ] `CRON_SECRET` configurado (aviso diario de apartados).
- [ ] Chrome en Android con la PWA **instalada**, notificaciones permitidas (Ajustes → Notificaciones → Probar).
- [ ] 5–10 productos con foto, costo y un QR impreso (Inventario → producto → Etiqueta QR).
- [ ] Abrir una vez cada pantalla con internet (así quedan disponibles sin conexión).

## Guion (≈ 8 min)
1. **Escanear** un producto con la cámara → alta/venta en segundos (código de barras y QR propio).
2. **Semáforo**: mostrar verde/amarillo/rojo; el rojo no se puede vender.
3. **Modo avión** → vender 2 productos (efectivo) y 1 por **transferencia** (queda pendiente).
4. Quitar modo avión → se sincroniza solo; mostrar aviso de sincronización.
5. **Transferencias** → confirmar un pago (llega notificación push al otro teléfono).
6. **Apartado**: crear con anticipo → inventario reservado → abonar → entregar.
7. **Devolución** de una venta → ver cómo cambian caja y reportes sin borrar la venta.
8. **Corte de caja**: contar efectivo, ver diferencia y desglose por transferencia.
9. **Análisis**: ventas por día/hora, top 10, ganancia estimada, lista de compras → exportar CSV/PDF.
10. **Equipo**: un empleado no puede cambiar precios ni cerrar caja; mostrar bitácora.

## Evidencias para anexar al reporte
| Evidencia | Cómo obtenerla |
|---|---|
| Pruebas automáticas | `npm test` (122) y `npm run test:e2e` (3, Chromium real) |
| Lighthouse | DevTools → Lighthouse (móvil), por pantalla; ver `docs/evidencias/LIGHTHOUSE.md` |
| Instalable / sin conexión | DevTools → Application → Manifest / Service Workers; Network → Offline |
| Respaldo y restauración | `docs/MANUAL-TECNICO.md` §Respaldo (probado en PostgreSQL real) |
| Conflicto de 2 dispositivos | `tests/conflicts.test.ts` + prueba manual con 2 teléfonos |

## Lo que NO está probado (decláralo)
- Con teléfonos reales: cámara, push en Android/iOS, Background Sync (solo Chromium).
- Contra Supabase y Cloudinary reales.
- Varios negocios (multi-tenant): el MVP es de **un solo negocio** (ver INFORME-PATCH3).
