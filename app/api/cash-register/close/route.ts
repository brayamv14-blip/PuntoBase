import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { getYesterdayOpeningBalance } from "@/lib/cash-register";
import { computeCashCut, parseActualCash, sumAmounts } from "@/lib/cash-math";
import { notifyCashDiscrepancy } from "@/lib/push-events";
import { dayEndISO, dayStartISO, isDateOnly, todayDateString } from "@/lib/utils";

// POST /api/cash-register/close  { actual_cash, notes?, date?, client_close_id? }
// Cierra el corte del dia. Es idempotente: un reintento (mismo client_close_id) o un segundo
// cierre sin ventas nuevas no modifica el corte ya registrado.
export async function POST(req: NextRequest) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { notes, date, client_close_id } = body ?? {};
  const actualCash = parseActualCash(body?.actual_cash);
  if (actualCash === null) {
    return NextResponse.json({ error: "actual_cash debe ser un número válido (≥ 0)" }, { status: 400 });
  }
  if (client_close_id !== undefined && (typeof client_close_id !== "string" || !client_close_id || client_close_id.length > 200)) {
    return NextResponse.json({ error: "client_close_id inválido" }, { status: 400 });
  }

  if (client_close_id) {
    const { data: existing } = await supabase
      .from("cash_register")
      .select("*")
      .eq("client_close_id", client_close_id)
      .maybeSingle();
    if (existing) return NextResponse.json({ ...existing, duplicate: true });
  }

  // Un corte hecho sin conexion llega despues: usa la fecha en que se capturo.
  const mxToday = todayDateString();
  const today = isDateOnly(date) && date <= mxToday ? date : mxToday;

  let { data: register } = await supabase
    .from("cash_register")
    .select("*")
    .eq("date", today)
    .maybeSingle();

  if (!register) {
    const openingBalance = await getYesterdayOpeningBalance();
    const { data: created } = await supabase
      .from("cash_register")
      .insert({ date: today, opening_balance: openingBalance })
      .select()
      .single();
    register = created;
  }
  if (!register) return NextResponse.json({ error: "No se pudo abrir la caja del día." }, { status: 500 });

  // Ya cerrado y sin ventas posteriores (una venta nueva reabre la caja): no se sobrescribe.
  if (register.closed_at) {
    return NextResponse.json({ ...register, duplicate: true });
  }

  const dateStr = register.date as string;
  const dateStart = dayStartISO(dateStr);
  const dateEnd = dayEndISO(dateStr);

  const [{ data: salesData }, { data: expensesData }] = await Promise.all([
    supabase.from("sales").select("total").eq("payment_method", "cash").gte("created_at", dateStart).lte("created_at", dateEnd),
    supabase.from("expenses").select("amount").gte("created_at", dateStart).lte("created_at", dateEnd),
  ]);

  const { expectedCash, discrepancy } = computeCashCut({
    openingBalance: Number(register.opening_balance ?? 0),
    cashSales: sumAmounts(salesData, "total"),
    expenses: sumAmounts(expensesData, "amount"),
    actualCash,
  });

  const closedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("cash_register")
    .update({
      expected_cash: expectedCash,
      actual_cash: actualCash,
      discrepancy,
      notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 500) : null,
      closed_by_device_id: device.id,
      closed_at: closedAt,
      ...(client_close_id ? { client_close_id } : {}),
    })
    .eq("date", dateStr)
    .is("closed_at", null) // evita que dos cierres simultaneos se pisen
    .select()
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Este corte ya fue registrado." }, { status: 409 });
    }
    console.error("[cash close]", error.message);
    return NextResponse.json({ error: "No se pudo registrar el corte." }, { status: 500 });
  }
  if (!data) {
    const { data: current } = await supabase.from("cash_register").select("*").eq("date", dateStr).maybeSingle();
    return NextResponse.json({ ...(current ?? {}), duplicate: true });
  }

  after(() => notifyCashDiscrepancy(Number(discrepancy), `${dateStr}:${closedAt}`));
  return NextResponse.json(data);
}
