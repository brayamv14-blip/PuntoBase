import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { layawayBalance } from "@/lib/layaways";
import { LAYAWAY_SELECT, decorateLayaway, type LayawayRow } from "@/lib/layaway-query";
import { todayDateString } from "@/lib/utils";

// POST /api/layaways/deliver { layaway_id, final_method?, client_op_id? }
// Cobra el saldo restante (efectivo) y entrega. El inventario ya estaba apartado.
// Con transferencia el saldo queda pendiente y la entrega se bloquea hasta confirmarla.
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { layaway_id, final_method, client_op_id } = body ?? {};
    if (typeof layaway_id !== "string" || !layaway_id) return NextResponse.json({ error: "layaway_id requerido" }, { status: 400 });
    if (final_method !== undefined && final_method !== "cash" && final_method !== "bank_transfer") {
      return NextResponse.json({ error: "Método de pago inválido." }, { status: 400 });
    }
    const today = todayDateString();

    const { data: lay, error } = await supabase.from("layaways").select("id, folio, status, total").eq("id", layaway_id).maybeSingle();
    if (error) throw error;
    if (!lay) return NextResponse.json({ error: "Apartado no encontrado." }, { status: 404 });
    if (lay.status === "delivered") {
      const { data: full } = await supabase.from("layaways").select(LAYAWAY_SELECT).eq("id", layaway_id).single();
      return NextResponse.json({ ...decorateLayaway(full as LayawayRow, today), duplicate: true });
    }
    if (lay.status !== "active") return NextResponse.json({ error: "El apartado está cancelado." }, { status: 409 });

    const { data: pays, error: pErr } = await supabase.from("layaway_payments").select("kind, amount, payment_status").eq("layaway_id", layaway_id);
    if (pErr) throw pErr;
    const bal = layawayBalance(Number(lay.total), pays ?? []);

    if (bal.pending > 0 && bal.dueNow > 0) {
      return NextResponse.json({ error: "Hay una transferencia pendiente de confirmar. Confírmala antes de entregar." }, { status: 409 });
    }

    if (bal.dueNow > 0) {
      if (!final_method) {
        return NextResponse.json({ error: `Falta cobrar ${bal.dueNow.toFixed(2)}. Indica el método de pago.`, remaining: bal.dueNow }, { status: 409 });
      }
      const { error: insErr } = await supabase.from("layaway_payments").insert({
        layaway_id,
        kind: "payment",
        method: final_method,
        amount: bal.dueNow,
        payment_status: final_method === "cash" ? "paid" : "pending",
        device_id: device.id,
        client_op_id: client_op_id ?? null,
        paid_at: final_method === "cash" ? new Date().toISOString() : null,
      });
      if (insErr && insErr.code !== "23505") throw insErr;
      if (final_method === "bank_transfer") {
        return NextResponse.json({ error: "Saldo registrado como transferencia pendiente. Confírmala para poder entregar.", pending: true }, { status: 409 });
      }
    }

    // Reclamar la transicion active -> delivered (solo una peticion gana).
    const { data: claimed, error: cErr } = await supabase
      .from("layaways")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", layaway_id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (cErr) throw cErr;
    if (!claimed) return NextResponse.json({ error: "El apartado cambió. Actualiza e intenta de nuevo." }, { status: 409 });

    after(() => audit(device, "layaway.deliver", "layaway", layaway_id, { folio: lay.folio, total: Number(lay.total), collected_at_delivery: bal.dueNow }));
    const { data: full } = await supabase.from("layaways").select(LAYAWAY_SELECT).eq("id", layaway_id).single();
    return NextResponse.json(decorateLayaway(full as LayawayRow, today));
  } catch (e) {
    console.error("[layaways deliver]", e);
    return NextResponse.json({ error: "No se pudo entregar el apartado." }, { status: 500 });
  }
}
