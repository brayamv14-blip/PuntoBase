import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";

// POST /api/layaways/confirm { payment_id, action: "confirm" | "reject" }
// Resuelve un abono por transferencia pendiente (la transicion pending -> paid/rejected solo la gana una peticion).
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { payment_id, action } = body ?? {};
    if (typeof payment_id !== "string" || !payment_id) return NextResponse.json({ error: "payment_id requerido" }, { status: 400 });
    if (action !== "confirm" && action !== "reject") return NextResponse.json({ error: "action inválida" }, { status: 400 });

    const patch =
      action === "confirm"
        ? { payment_status: "paid", paid_at: new Date().toISOString() }
        : { payment_status: "rejected" };

    const { data, error } = await supabase
      .from("layaway_payments")
      .update(patch)
      .eq("id", payment_id)
      .eq("payment_status", "pending")
      .eq("method", "bank_transfer")
      .eq("kind", "payment")
      .select("id, layaway_id, amount")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "El abono ya fue resuelto o no existe." }, { status: 409 });

    after(() => audit(device, "layaway.confirm_payment", "layaway", data.layaway_id, { payment_id, action, amount: Number(data.amount) }));
    return NextResponse.json({ ok: true, payment_status: patch.payment_status });
  } catch (e) {
    console.error("[layaways confirm]", e);
    return NextResponse.json({ error: "No se pudo resolver el abono." }, { status: 500 });
  }
}
