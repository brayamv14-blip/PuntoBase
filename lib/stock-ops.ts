import { supabase } from "@/lib/supabase/server";

export interface StockMove {
  variantId: string;
  oldQty: number;
  newQty: number;
}

/**
 * Cambia el inventario de una variante con actualizacion condicional (reintenta si otra venta
 * cambio el valor a la vez). Devuelve null si la variante ya no existe. Con allowNegative=false
 * y existencias insuficientes lanza "INSUFFICIENT".
 */
export async function applyStockDelta(
  variantId: string,
  delta: number,
  options: { allowNegative?: boolean } = {}
): Promise<StockMove | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: variant, error } = await supabase
      .from("product_variants")
      .select("stock_qty")
      .eq("id", variantId)
      .maybeSingle();
    if (error) throw error;
    if (!variant) return null;

    const oldQty = Number(variant.stock_qty);
    const newQty = oldQty + delta;
    if (newQty < 0 && !options.allowNegative) throw new Error("INSUFFICIENT");

    const { data: updated, error: updateError } = await supabase
      .from("product_variants")
      .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
      .eq("id", variantId)
      .eq("stock_qty", variant.stock_qty)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return { variantId, oldQty, newQty };
  }
  throw new Error("CONCURRENT");
}

/** Deshace movimientos ya aplicados (mejor esfuerzo). Solo si el valor sigue siendo el que dejamos. */
export async function revertStockMoves(moves: StockMove[]): Promise<void> {
  for (const move of [...moves].reverse()) {
    await supabase
      .from("product_variants")
      .update({ stock_qty: move.oldQty, updated_at: new Date().toISOString() })
      .eq("id", move.variantId)
      .eq("stock_qty", move.newQty);
  }
}
