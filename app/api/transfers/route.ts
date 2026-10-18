import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";

// GET /api/transfers  bandeja de verificacion: transferencias pendientes de confirmar
export async function GET() {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("sales")
      .select("id, sale_number, total, created_at, notes, customer:customers(name)")
      .neq("payment_method", "cash")
      .eq("payment_status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/transfers  { id }  confirma el deposito y consolida la venta en el corte de caja
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await req.json();
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sales")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .eq("id", id)
      .eq("payment_status", "pending")
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) {
      return NextResponse.json({ error: "Venta no encontrada o ya confirmada" }, { status: 404 });
    }
    return NextResponse.json({ id: data.id, payment_status: "paid" });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
