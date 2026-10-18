import { getStockStatus, type StockStatus } from "@/lib/stock-status";

export interface StockChange {
  name: string;
  oldQty: number;
  newQty: number;
  threshold: number;
}

export interface StockAlert {
  name: string;
  qty: number;
  status: Exclude<StockStatus, "green">;
}

/**
 * Devuelve solo los productos que CAMBIARON de semaforo hacia amarillo o rojo,
 * para avisar una vez por cruce y no en cada venta.
 */
export function detectStockAlerts(changes: StockChange[]): StockAlert[] {
  const alerts: StockAlert[] = [];
  for (const c of changes) {
    const before = getStockStatus(c.oldQty, c.threshold);
    const after = getStockStatus(c.newQty, c.threshold);
    if (after !== before && after !== "green") {
      alerts.push({ name: c.name, qty: c.newQty, status: after });
    }
  }
  return alerts;
}

export function stockAlertsMessage(alerts: StockAlert[]): { title: string; body: string } {
  const out = alerts.filter((a) => a.status === "red");
  const low = alerts.filter((a) => a.status === "yellow");
  const lines = [
    ...out.map((a) => `${a.name}: agotado`),
    ...low.map((a) => `${a.name}: quedan ${a.qty}`),
  ];
  return {
    title: out.length > 0 ? "Producto agotado" : "Inventario bajo",
    body: lines.slice(0, 4).join("\n") + (lines.length > 4 ? `\n y ${lines.length - 4} más` : ""),
  };
}
