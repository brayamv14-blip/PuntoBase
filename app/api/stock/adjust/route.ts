import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { notifyStockChanges } from "@/lib/push-events";

// POST /api/stock/adjust  { product_id, variant_id, qty_change, note?, client_op_id? }
// Ajuste manual de inventario. Es idempotente: si llega dos veces el mismo client_op_id
// (reintento de una operacion hecha sin conexion) no se aplica el cambio otra vez.
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { product_id, variant_id, qty_change, note, client_op_id } = await req.json();
    if (!product_id || !variant_id || qty_change == null) {
      return NextResponse.json({ error: "product_id, variant_id, and qty_change required" }, { status: 400 });
    }
    const change = Number(qty_change);
    if (!Number.isFinite(change) || change === 0 || Math.abs(change) > 1_000_000) {
      return NextResponse.json({ error: "qty_change inválido" }, { status: 400 });
    }
    if (client_op_id !== undefined && (typeof client_op_id !== "string" || !client_op_id || client_op_id.length > 200)) {
      return NextResponse.json({ error: "client_op_id inválido" }, { status: 400 });
    }

    if (client_op_id) {
      const { data: existing } = await supabase
        .from("stock_adjustments")
        .select("qty_after")
        .eq("client_op_id", client_op_id)
        .maybeSingle();
      if (existing) return NextResponse.json({ stock_qty: Number(existing.qty_after), duplicate: true });
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: variant, error: varErr } = await supabase
        .from("product_variants")
        .select("stock_qty")
        .eq("id", variant_id)
        .eq("product_id", product_id)
        .maybeSingle();
      if (varErr) throw varErr;
      if (!variant) return NextResponse.json({ error: "Variant not found" }, { status: 404 });

      const oldQty = Number(variant.stock_qty);
      const newQty = Math.max(0, oldQty + change);

      // Actualizacion condicional: si otra venta cambio el stock, se reintenta con el valor nuevo.
      const { data: updated, error: updateError } = await supabase
        .from("product_variants")
        .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
        .eq("id", variant_id)
        .eq("stock_qty", variant.stock_qty)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) continue;

      const { error: adjError } = await supabase.from("stock_adjustments").insert({
        product_id,
        variant_id,
        adjustment_type: "manual",
        qty_before: oldQty,
        qty_change: newQty - oldQty,
        qty_after: newQty,
        note: typeof note === "string" && note.trim() ? note.trim().slice(0, 300) : null,
        device_id: device.id,
        ...(client_op_id ? { client_op_id } : {}),
      });

      if (adjError) {
        // Carrera entre dos reintentos del mismo client_op_id: el otro ya lo aplico; deshacer este.
        if ((adjError as { code?: string }).code === "23505" && client_op_id) {
          await supabase
            .from("product_variants")
            .update({ stock_qty: oldQty, updated_at: new Date().toISOString() })
            .eq("id", variant_id)
            .eq("stock_qty", newQty);
          return NextResponse.json({ stock_qty: oldQty, duplicate: true });
        }
        console.error("[stock adjust] Auditoría no registrada:", adjError.message);
        await supabase
          .from("product_variants")
          .update({ stock_qty: oldQty, updated_at: new Date().toISOString() })
          .eq("id", variant_id)
          .eq("stock_qty", newQty);
        return NextResponse.json({ error: "No se pudo registrar el ajuste." }, { status: 500 });
      }

      after(() => notifyStockChanges([{ variantId: variant_id, oldQty, newQty }], device.id));
      return NextResponse.json({ stock_qty: newQty });
    }

    return NextResponse.json({ error: "El inventario cambió mientras se ajustaba. Intenta de nuevo." }, { status: 409 });
  } catch (err) {
    console.error("[stock adjust]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
