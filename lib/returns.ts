import { round2 } from "@/lib/cash-math";

export interface ReturnableItem {
  id: string;
  unit_price: number;
  qty: number;
  /** Cantidad ya devuelta en devoluciones anteriores. */
  returned_qty: number;
}

export interface ReturnRequestItem {
  sale_item_id: string;
  qty: number;
}

export interface ReturnLine {
  sale_item_id: string;
  qty: number;
  amount: number;
}

export type ReturnCalc =
  | { ok: true; lines: ReturnLine[]; total: number; completesSale: boolean }
  | { ok: false; error: string };

const q3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Calcula el reembolso de una devolucion (funcion pura):
 *  - no permite devolver mas de lo vendido ni repetir una misma partida,
 *  - reparte el descuento de la venta proporcionalmente,
 *  - al devolver lo ultimo que queda, el total devuelto nunca supera lo cobrado (ajuste de centavos).
 */
export function computeReturn(
  sale: { total: number; subtotal: number },
  items: ReturnableItem[],
  request: ReturnRequestItem[],
  priorRefundedTotal: number
): ReturnCalc {
  if (!Array.isArray(request) || request.length === 0) {
    return { ok: false, error: "Selecciona al menos un artículo." };
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const ratio = sale.subtotal > 0 ? sale.total / sale.subtotal : 1;
  const lines: ReturnLine[] = [];

  for (const r of request) {
    const item = byId.get(r.sale_item_id);
    if (!item) return { ok: false, error: "Un artículo no pertenece a esta venta." };
    if (seen.has(r.sale_item_id)) return { ok: false, error: "Un artículo está repetido en la devolución." };
    seen.add(r.sale_item_id);

    const qty = q3(Number(r.qty));
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "La cantidad a devolver debe ser mayor a cero." };

    const available = q3(item.qty - item.returned_qty);
    if (qty > available) {
      return {
        ok: false,
        error: available <= 0
          ? "Ese artículo ya fue devuelto por completo."
          : `Solo quedan ${available} por devolver de ese artículo.`,
      };
    }
    lines.push({ sale_item_id: item.id, qty, amount: round2(item.unit_price * qty * ratio) });
  }

  const remaining = new Map(items.map((i) => [i.id, q3(i.qty - i.returned_qty)]));
  for (const l of lines) remaining.set(l.sale_item_id, q3((remaining.get(l.sale_item_id) ?? 0) - l.qty));
  const completesSale = [...remaining.values()].every((v) => v <= 0);

  let total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const maxRefundable = round2(sale.total - priorRefundedTotal);

  if (completesSale) {
    // Lo ultimo que se devuelve cierra exactamente lo cobrado (sin perder ni inventar centavos).
    const diff = round2(maxRefundable - total);
    if (diff !== 0) {
      lines[lines.length - 1].amount = round2(lines[lines.length - 1].amount + diff);
      total = maxRefundable;
    }
  }

  if (total > maxRefundable + 0.001) {
    return { ok: false, error: "El importe supera lo cobrado en la venta." };
  }
  return { ok: true, lines, total, completesSale };
}
