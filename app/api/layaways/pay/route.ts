import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { layawayBalance } from "@/lib/layaways";
import { LAYAWAY_SELECT, decorateLayaway, type LayawayRow } from "@/lib/layaway-query";
import { round2 } from "@/lib/cash-math";
import { todayDateString } from "@/lib/utils";

// POST /api/layaways/pay { layaway_id, amount, method, client_op_id? }  (abono)
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { layaway_id, method, client_op_id } = body ?? {};
    const amount = round2(Number(body?.amount));
    if (typeof layaway_id !== "string" || !layaway_id) return NextResponse.json({ error: "layaway_id requerido" }, { status: 400 });
    if (method !== "cash" && method !== "bank_transfer") return NextResponse.json({ error: "Método de pago inválido." }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El abono debe ser mayor a 0." }, { status: 400 });
    if (client_op_id !== undefined && (typeof client_op_id !== "string" || !client_op_id || client_op_id.length > 200)) {
      return NextResponse.json({ error: "client_op_id inválido" }, { status: 400 });
    }
    const today = todayDateString();

    if (client_op_id) {
      const { data: dup } = await supabase.from("layaway_payments").select("id").eq("client_op_id", client_op_id).maybeSingle();
      if (dup) {
        const { data: full } = await supabase.from("layaways").select(LAYAWAY_SELECT).eq("id", layaway_id).single();
        return NextResponse.json({ ...decorateLayaway(full as LayawayRow, today), duplicate: true });
      }
    }

    const { data: lay, error } = await supabase.from("layaways").select("id, folio, status, total").eq("id", layaway_id).maybeSingle();
    if (error) throw error;
    if (!lay) return NextResponse.json({ error: "Apartado no encontrado." }, { status: 404 });
    if (lay.status !== "active") return NextResponse.json({ error: "El apartado ya no está activo." }, { status: 409 });

    const { data: pays, error: pErr } = await supabase.from("layaway_payments").select("kind, amount, payment_status").eq("layaway_id", layaway_id);
    if (pErr) throw pErr;
    const bal = layawayBalance(Number(lay.total), pays ?? []);
    if (amount > bal.balance) {
      return NextResponse.json({ error: `El abono excede el saldo pendiente (${bal.balance.toFixed(2)}).` }, { status: 409 });
    }

    const { error: insErr } = await supabase.from("layaway_payments").insert({
      layaway_id,
      kind: "payment",
      method,
      amount,
      payment_status: method === "cash" ? "paid" : "pending",
      device_id: device.id,
      client_op_id: client_op_id ?? null,
      paid_at: method === "cash" ? new Date().toISOString() : null,
    });
    if (insErr) {
      if (insErr.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
      throw insErr;
    }

    after(() => audit(device, "layaway.payment", "layaway", layaway_id, { folio: lay.folio, amount, method }));
    const { data: full } = await supabase.from("layaways").select(LAYAWAY_SELECT).eq("id", layaway_id).single();
    return NextResponse.json(decorateLayaway(full as LayawayRow, today), { status: 201 });
  } catch (e) {
    console.error("[layaways pay]", e);
    return NextResponse.json({ error: "No se pudo registrar el abono." }, { status: 500 });
  }
}
