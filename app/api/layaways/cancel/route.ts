import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { layawayBalance } from "@/lib/layaways";
import { LAYAWAY_SELECT, decorateLayaway, type LayawayRow } from "@/lib/layaway-query";
import { applyStockDelta, type StockMove } from "@/lib/stock-ops";
import { notifyStockChanges } from "@/lib/push-events";
import { todayDateString } from "@/lib/utils";

// POST /api/layaways/cancel { layaway_id, reason, refund: boolean, refund_method?, client_op_id? }  (solo administrador)
// Cancela o libera un apartado vencido: devuelve el inventario apartado y, si se indica,
// reembolsa lo cobrado. Las transferencias pendientes se rechazan.
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const body = await req.json().catch(() => ({}));
    const { layaway_id, client_op_id } = body ?? {};
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const refund = body?.refund === true;
    const refundMethod = body?.refund_method ?? "cash";
    if (typeof layaway_id !== "string" || !layaway_id) return NextResponse.json({ error: "layaway_id requerido" }, { status: 400 });
    if (reason.length < 3 || reason.length > 300) return NextResponse.json({ error: "Indica el motivo (3 a 300 caracteres)." }, { status: 400 });
    if (refundMethod !== "cash" && refundMethod !== "bank_transfer") return NextResponse.json({ error: "Método de reembolso inválido." }, { status: 400 });
    const today = todayDateString();

    const { data: lay, error } = await supabase.from("layaways").select("id, folio, status, total").eq("id", layaway_id).maybeSingle();
    if (error) throw error;
    if (!lay) return NextResponse.json({ error: "Apartado no encontrado." }, { status: 404 });
    if (lay.status === "cancelled") {
      const { data: full } = await supabase.from("layaways").select(LAYAWAY_SELECT).eq("id", layaway_id).single();
      return NextResponse.json({ ...decorateLayaway(full as LayawayRow, today), duplicate: true });
    }
    if (lay.status !== "active") return NextResponse.json({ error: "Un apartado entregado no se puede cancelar; usa una devolución." }, { status: 409 });

    // Reclamar active -> cancelled.
    const { data: claimed, error: cErr } = await supabase
      .from("layaways")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason })
      .eq("id", layaway_id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (cErr) throw cErr;
    if (!claimed) return NextResponse.json({ error: "El apartado cambió. Actualiza e intenta de nuevo." }, { status: 409 });

    const moves: StockMove[] = [];
    try {
      const { data: items, error: iErr } = await supabase
        .from("layaway_items")
        .select("product_id, variant_id, qty, reserved")
        .eq("layaway_id", layaway_id);
      if (iErr) throw iErr;

      for (const it of items ?? []) {
        if (!it.reserved || !it.variant_id) continue;
        const move = await applyStockDelta(it.variant_id, Number(it.qty), { allowNegative: true });
        if (!move) continue;
        moves.push(move);
        await supabase.from("stock_adjustments").insert({
          product_id: it.product_id,
          variant_id: it.variant_id,
          adjustment_type: "layaway_release",
          qty_before: move.oldQty,
          qty_change: move.newQty - move.oldQty,
          qty_after: move.newQty,
          note: `Apartado ${lay.folio} cancelado`,
          device_id: device.id,
        });
      }

      await supabase.from("layaway_payments").update({ payment_status: "rejected" }).eq("layaway_id", layaway_id).eq("payment_status", "pending");

      const { data: pays, error: pErr } = await supabase.from("layaway_payments").select("kind, amount, payment_status").eq("layaway_id", layaway_id);
      if (pErr) throw pErr;
      const bal = layawayBalance(Number(lay.total), pays ?? []);
      if (refund && bal.paid > 0) {
        const { error: rErr } = await supabase.from("layaway_payments").insert({
          layaway_id,
          kind: "refund",
          method: refundMethod,
          amount: bal.paid,
          payment_status: "paid",
          device_id: device.id,
          client_op_id: client_op_id ?? null,
          paid_at: new Date().toISOString(),
        });
        if (rErr) throw rErr;
      }
    } catch (inner) {
      // Mejor esfuerzo: el apartado vuelve a activo si no se pudo liberar todo.
      console.error("[layaways cancel] fallo; revirtiendo", inner);
      for (const m of [...moves].reverse()) {
        await supabase.from("product_variants").update({ stock_qty: m.oldQty }).eq("id", m.variantId).eq("stock_qty", m.newQty);
      }
      await supabase.from("stock_adjustments").delete().eq("note", `Apartado ${lay.folio} cancelado`);
      await supabase.from("layaways").update({ status: "active", cancelled_at: null, cancel_reason: null }).eq("id", layaway_id);
      return NextResponse.json({ error: "No se pudo cancelar el apartado. No se hicieron cambios." }, { status: 500 });
    }

    after(async () => {
      if (moves.length) await notifyStockChanges(moves, device.id);
      await audit(device, "layaway.cancel", "layaway", layaway_id, { folio: lay.folio, reason, refund });
    });
    const { data: full } = await supabase.from("layaways").select(LAYAWAY_SELECT).eq("id", layaway_id).single();
    return NextResponse.json(decorateLayaway(full as LayawayRow, today));
  } catch (e) {
    console.error("[layaways cancel]", e);
    return NextResponse.json({ error: "No se pudo cancelar el apartado." }, { status: 500 });
  }
}
