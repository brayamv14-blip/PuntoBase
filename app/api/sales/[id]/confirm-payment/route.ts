import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";

// POST /api/sales/:id/confirm-payment  marca una transferencia pendiente como cobrada
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await supabase
    .from("sales")
    .update({ payment_status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id)
    .eq("payment_status", "pending")
    .select("id, payment_status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Venta no encontrada o ya confirmada" }, { status: 404 });
  return NextResponse.json(data);
}
