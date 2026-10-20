import { describe, expect, it, beforeEach } from "vitest";
import { computeCashCut, parseActualCash, sumAmounts, round2 } from "@/lib/cash-math";
import {
  detectStockAlerts,
  detectStockRecoveries,
  stockAlertsMessage,
  stockRecoveryMessage,
} from "@/lib/stock-alerts";
import { resolveSaleDate } from "@/lib/sale-date";
import { reduceStock } from "@/lib/offline-stock";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { localSalesForDay, localTotals } from "@/lib/local-sales-view";
import { backoffMs, isPermanentSaleError } from "@/lib/offline-queue";
import { todayDateString, dayStartISO, dayEndISO } from "@/lib/utils";
import type { LocalSale } from "@/lib/local-sales";
import type { ProductWithVariants } from "@/types";

describe("Corte de caja", () => {
  it("efectivo esperado = fondo + ventas en efectivo - retiros", () => {
    const cut = computeCashCut({ openingBalance: 500, cashSales: 1250.5, expenses: 200, actualCash: 1550.5 });
    expect(cut.expectedCash).toBe(1550.5);
    expect(cut.discrepancy).toBe(0);
  });
  it("detecta faltante (negativo) y sobrante (positivo)", () => {
    expect(computeCashCut({ openingBalance: 100, cashSales: 100, expenses: 0, actualCash: 150 }).discrepancy).toBe(-50);
    expect(computeCashCut({ openingBalance: 100, cashSales: 100, expenses: 0, actualCash: 230.25 }).discrepancy).toBe(30.25);
  });
  it("no acumula errores de punto flotante", () => {
    const rows = [{ total: 0.1 }, { total: 0.2 }, { total: 0.3 }];
    expect(sumAmounts(rows, "total")).toBe(0.6);
    expect(round2(1.005 + 0)).toBeCloseTo(1.01, 2);
  });
  it("valida el efectivo contado", () => {
    expect(parseActualCash("120.50")).toBe(120.5);
    expect(parseActualCash(0)).toBe(0);
    for (const bad of [-1, NaN, Infinity, "", "abc", null, undefined, 1e12]) {
      expect(parseActualCash(bad)).toBeNull();
    }
  });
});

describe("Semaforo y alertas de inventario", () => {
  it("avisa solo cuando el semaforo CAMBIA", () => {
    const alerts = detectStockAlerts([
      { id: "a", name: "A", oldQty: 10, newQty: 3, threshold: 3 }, // verde -> amarillo
      { id: "b", name: "B", oldQty: 3, newQty: 2, threshold: 3 }, // amarillo -> amarillo: no avisa
      { id: "c", name: "C", oldQty: 2, newQty: 0, threshold: 3 }, // amarillo -> rojo
      { id: "d", name: "D", oldQty: 0, newQty: 0, threshold: 3 }, // rojo -> rojo: no avisa
      { id: "e", name: "E", oldQty: 10, newQty: 9, threshold: 3 }, // verde -> verde
    ]);
    expect(alerts.map((a) => [a.id, a.status])).toEqual([["a", "yellow"], ["c", "red"]]);
    const msg = stockAlertsMessage(alerts);
    expect(msg.title).toBe("Producto agotado");
    expect(msg.body).toContain("C: agotado");
  });
  it("detecta recuperacion de existencias", () => {
    const rec = detectStockRecoveries([
      { id: "a", name: "A", oldQty: 0, newQty: 20, threshold: 5 },
      { id: "b", name: "B", oldQty: 2, newQty: 3, threshold: 5 },
      { id: "c", name: "C", oldQty: 20, newQty: 30, threshold: 5 },
    ]);
    expect(rec.map((r) => r.id)).toEqual(["a"]);
    expect(stockRecoveryMessage(rec).title).toBe("Inventario repuesto");
  });
  it("limita el cuerpo a 4 lineas", () => {
    const alerts = Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: `P${i}`, qty: 0, status: "red" as const }));
    expect(stockAlertsMessage(alerts).body).toContain("y 2 más");
  });
});

describe("Fecha de venta offline", () => {
  const now = new Date("2026-10-19T20:00:00Z");
  it("conserva la fecha capturada por el dispositivo", () => {
    expect(resolveSaleDate("2026-10-19T15:30:00Z", now).toISOString()).toBe("2026-10-19T15:30:00.000Z");
  });
  it("ignora fechas invalidas, futuras o demasiado antiguas", () => {
    expect(resolveSaleDate("no-es-fecha", now)).toBe(now);
    expect(resolveSaleDate(undefined, now)).toBe(now);
    expect(resolveSaleDate("2026-10-20T20:00:00Z", now)).toBe(now);
    expect(resolveSaleDate("2026-08-01T20:00:00Z", now)).toBe(now);
  });
  it("el dia de negocio es el de Ciudad de Mexico, no UTC", () => {
    // 2026-10-20 03:30 UTC = 2026-10-19 21:30 en CDMX
    expect(todayDateString(new Date("2026-10-20T03:30:00Z"))).toBe("2026-10-19");
    expect(dayStartISO("2026-10-19")).toBe("2026-10-19T06:00:00.000Z");
    expect(dayEndISO("2026-10-19")).toBe("2026-10-20T05:59:59.999Z");
  });
});

const product = (stock: number, track = true): ProductWithVariants =>
  ({
    id: "p1",
    name: "Producto",
    track_stock: track,
    variants: [{ id: "v1", product_id: "p1", size_label: "", price: 10, stock_qty: stock, low_stock_threshold: 2 }],
  }) as unknown as ProductWithVariants;

describe("Inventario local tras ventas offline", () => {
  it("descuenta, no baja de cero y respeta track_stock", () => {
    expect(reduceStock([product(5)], [{ variant_id: "v1", qty: 2 }])[0].variants[0].stock_qty).toBe(3);
    expect(reduceStock([product(1)], [{ variant_id: "v1", qty: 4 }])[0].variants[0].stock_qty).toBe(0);
    expect(reduceStock([product(5, false)], [{ variant_id: "v1", qty: 2 }])[0].variants[0].stock_qty).toBe(5);
  });
  it("suma varias ventas pendientes de la misma variante", () => {
    const out = reduceStock([product(10)], [
      { variant_id: "v1", qty: 2 },
      { variant_id: "v1", qty: 3 },
    ]);
    expect(out[0].variants[0].stock_qty).toBe(5);
  });
});

describe("Limitador de peticiones", () => {
  beforeEach(() => resetRateLimits());
  it("bloquea al pasar el limite y libera al terminar la ventana", () => {
    expect(rateLimit("k", 2, 1000, 0).allowed).toBe(true);
    expect(rateLimit("k", 2, 1000, 10).allowed).toBe(true);
    const blocked = rateLimit("k", 2, 1000, 20);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimit("k", 2, 1000, 1500).allowed).toBe(true);
    expect(rateLimit("otra", 2, 1000, 20).allowed).toBe(true);
  });
});

describe("Reintentos de la cola", () => {
  it("espera creciente con tope de 30 min", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(30 * 60 * 1000);
  });
  it("distingue errores definitivos de transitorios", () => {
    expect(isPermanentSaleError(400)).toBe(true);
    expect(isPermanentSaleError(404)).toBe(true);
    for (const s of [401, 403, 408, 429, 500, 502, 503]) expect(isPermanentSaleError(s)).toBe(false);
  });
});

describe("Historial y reportes locales", () => {
  const sale = (over: Partial<LocalSale>): LocalSale =>
    ({
      id: "L" + Math.random(),
      total: 100,
      payment_method: "cash",
      payment_status: "paid",
      created_at: "2026-10-19T16:00:00Z",
      local_status: "pending",
      ...over,
    }) as LocalSale;

  it("filtra por dia de CDMX y por estado", () => {
    const sales = [
      sale({ created_at: "2026-10-19T16:00:00Z" }),
      sale({ created_at: "2026-10-20T03:30:00Z" }), // 19 oct 21:30 CDMX
      sale({ created_at: "2026-10-20T10:00:00Z" }), // 20 oct
      sale({ created_at: "2026-10-19T17:00:00Z", local_status: "synced" }),
    ];
    expect(localSalesForDay(sales, "2026-10-19", false)).toHaveLength(2);
    expect(localSalesForDay(sales, "2026-10-19", true)).toHaveLength(3);
  });
  it("separa efectivo, transferencia confirmada y pendiente; ignora descartadas", () => {
    const t = localTotals([
      sale({ total: 100 }),
      sale({ total: 50, payment_method: "bank_transfer", payment_status: "pending" }),
      sale({ total: 70, payment_method: "bank_transfer", payment_status: "paid" }),
      sale({ total: 999, local_status: "failed" }),
    ]);
    expect(t).toEqual({ count: 3, cash: 100, transferPaid: 70, transferPending: 50 });
  });
});
