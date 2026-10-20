import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { notifyStockChanges, notifyTransferResolved, type VariantChange } from "@/lib/push-events";

// GET /api/transfers  bandeja de verificacion: transferencias pendientes de confirmar
export async function GET() {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("sales")
      .select("id, sale_number, total, created_at, notes, needs_attention, attention_note, customer:customers(name)")
      .neq("payment_method", "cash")
      .eq("payment_status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      console.error("[transfers GET]", error.message);
      return NextResponse.json({ error: "No se pudo cargar la bandeja." }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/transfers  { id, action?: "confirm" | "reject", reason? }
//  - confirm (por defecto): confirma el deposito y consolida la venta en el corte de caja.
//  - reject: la transferencia nunca llego. La venta queda "rejected" (con trazabilidad) y las
//    existencias se restituyen. Solo se puede resolver una transferencia pendiente, una vez.
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { id } = body ?? {};
    const action = body?.action === "reject" ? "reject" : "confirm";
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }

    if (action === "confirm") {
      const { data, error } = await supabase
        .from("sales")
        .update({ payment_status: "paid", paid_at: new Date().toISOString() })
        .eq("id", id)
        .eq("payment_status", "pending")
        .neq("payment_method", "cash")
        .select("id, total")
        .maybeSingle();

      if (error) {
        console.error("[transfers confirm]", error.message);
        return NextResponse.json({ error: "No se pudo confirmar el pago." }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "Venta no encontrada o ya resuelta" }, { status: 404 });
      }
      after(() => notifyTransferResolved(data.id, Number(data.total), "confirmed", device.id));
      return NextResponse.json({ id: data.id, payment_status: "paid" });
    }

    // ── Rechazo ───────────────────────────────────────────────────────────────
    const reason =
      typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : null;

    // 1) Reclamar la transicion pending -> rejected (solo una peticion puede ganar).
    const { data: sale, error: claimError } = await supabase
      .from("sales")
      .update({ payment_status: "rejected", rejected_at: new Date().toISOString(), reject_reason: reason })
      .eq("id", id)
      .eq("payment_status", "pending")
      .neq("payment_method", "cash")
      .select("id, total, sale_number")
      .maybeSingle();

    if (claimError) {
      console.error("[transfers reject]", claimError.message);
      return NextResponse.json({ error: "No se pudo rechazar la transferencia." }, { status: 500 });
    }
    if (!sale) {
      return NextResponse.json({ error: "Venta no encontrada o ya resuelta" }, { status: 404 });
    }

    // 2) Restituir existencias.
    try {
      const changes = await restockSale(sale.id, sale.sale_number, device.id);
      after(async () => {
        await notifyTransferResolved(sale.id, Number(sale.total), "rejected", device.id);
        await notifyStockChanges(changes, device.id);
      });
      return NextResponse.json({ id: sale.id, payment_status: "rejected", restocked: changes.length });
    } catch (error) {
      console.error("[transfers reject] Falló la restitución; se revierte el rechazo:", error);
      await supabase
        .from("sales")
        .update({ payment_status: "pending", rejected_at: null, reject_reason: null })
        .eq("id", sale.id);
      return NextResponse.json(
        { error: "No se pudo restituir el inventario; la transferencia sigue pendiente." },
        { status: 500 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Suma de vuelta al inventario lo vendido. Devuelve los cambios para avisos de semaforo. */
async function restockSale(saleId: string, saleNumber: string, deviceId: string): Promise<VariantChange[]> {
  const { data: items, error } = await supabase
    .from("sale_items")
    .select("product_id, variant_id, qty")
    .eq("sale_id", saleId);
  if (error) throw error;

  const changes: VariantChange[] = [];
  const done: { variantId: string; oldQty: number; newQty: number }[] = [];

  try {
    for (const item of (items ?? []) as { product_id: string | null; variant_id: string | null; qty: number }[]) {
      if (!item.product_id || !item.variant_id) continue;

      const { data: product } = await supabase
        .from("products")
        .select("track_stock")
        .eq("id", item.product_id)
        .maybeSingle();
      if (!product?.track_stock) continue;

      let applied = false;
      for (let attempt = 0; attempt < 3 && !applied; attempt++) {
        const { data: variant, error: variantError } = await supabase
          .from("product_variants")
          .select("stock_qty")
          .eq("id", item.variant_id)
          .maybeSingle();
        if (variantError) throw variantError;
        if (!variant) break; // variante eliminada: nada que restituir

        const oldQty = Number(variant.stock_qty);
        const newQty = oldQty + Number(item.qty);
        const { data: updated, error: updateError } = await supabase
          .from("product_variants")
          .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
          .eq("id", item.variant_id)
          .eq("stock_qty", variant.stock_qty)
          .select("id")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) continue; // cambio concurrente: reintentar

        applied = true;
        done.push({ variantId: item.variant_id, oldQty, newQty });
        changes.push({ variantId: item.variant_id, oldQty, newQty });

        const { error: adjError } = await supabase.from("stock_adjustments").insert({
          product_id: item.product_id,
          variant_id: item.variant_id,
          adjustment_type: "refund",
          qty_before: oldQty,
          qty_change: Number(item.qty),
          qty_after: newQty,
          note: `Transferencia rechazada ${saleNumber}`,
          device_id: deviceId,
          related_sale_id: saleId,
        });
        if (adjError) throw adjError;
      }
      if (!applied) throw new Error("El inventario cambió de forma concurrente.");
    }
    return changes;
  } catch (error) {
    // Deshacer lo ya restituido para no dejar el inventario a medias.
    for (const change of [...done].reverse()) {
      await supabase
        .from("product_variants")
        .update({ stock_qty: change.oldQty, updated_at: new Date().toISOString() })
        .eq("id", change.variantId)
        .eq("stock_qty", change.newQty);
    }
    await supabase
      .from("stock_adjustments")
      .delete()
      .eq("related_sale_id", saleId)
      .eq("adjustment_type", "refund")
      .like("note", "Transferencia rechazada%");
    throw error;
  }
}
