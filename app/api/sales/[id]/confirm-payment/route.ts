import { NextRequest, NextResponse, after } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyTransferResolved } from "@/lib/push-events";

// POST /api/sales/:id/confirm-payment  marca una transferencia pendiente como cobrada.
// Mismas reglas que /api/transfers (action=confirm): nunca aplica a efectivo, avisa a los demas
// dispositivos y queda en la bitacora.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await supabase
    .from("sales")
    .update({ payment_status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id)
    .eq("payment_status", "pending")
    .neq("payment_method", "cash")
    .select("id, total, payment_status")
    .maybeSingle();

  if (error) {
    console.error("[confirm-payment]", error.message);
    return NextResponse.json({ error: "No se pudo confirmar el pago." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Venta no encontrada o ya confirmada" }, { status: 404 });

  after(async () => {
    await notifyTransferResolved(data.id, Number(data.total), "confirmed", device.id);
    await audit(device, "transfer.confirm", "sale", data.id, { total: Number(data.total), via: "confirm-payment" });
  });
  return NextResponse.json({ id: data.id, payment_status: data.payment_status });
}
