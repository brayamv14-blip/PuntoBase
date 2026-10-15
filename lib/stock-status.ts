export type StockStatus = "green" | "yellow" | "red";

/** Semaforo de inventario: rojo = agotado, amarillo = igual o menor al minimo, verde = saludable. */
export function getStockStatus(stock: number, threshold: number): StockStatus {
  if (stock <= 0) return "red";
  if (threshold > 0 && stock <= threshold) return "yellow";
  return "green";
}

export const STOCK_STATUS_STYLE: Record<StockStatus, { dot: string; text: string; label: string }> = {
  green: { dot: "bg-green-500", text: "text-green-600", label: "Disponible" },
  yellow: { dot: "bg-yellow-400", text: "text-yellow-600", label: "Pocas piezas" },
  red: { dot: "bg-red-500", text: "text-red-500", label: "Agotado" },
};
