import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { getYesterdayOpeningBalance } from "@/lib/cash-register";
import { notifyCashDiscrepancy } from "@/lib/push-events";
import { dayEndISO, dayStartISO, isDateOnly, todayDateString } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { actual_cash, notes, date } = await req.json();
  if (actual_cash == null) return NextResponse.json({ error: "actual_cash required" }, { status: 400 });

  // Un corte hecho sin conexion llega despues: usa la fecha en que se capturo.
  const mxToday = todayDateString();
  const today = isDateOnly(date) && date <= mxToday ? date : mxToday;

  // Find today's register (open or closed)
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

  const dateStr = register!.date as string;
  const dateStart = dayStartISO(dateStr);
  const dateEnd = dayEndISO(dateStr);

  const [{ data: salesData }, { data: expensesData }] = await Promise.all([
    supabase.from("sales").select("total").eq("payment_method", "cash").gte("created_at", dateStart).lte("created_at", dateEnd),
    supabase.from("expenses").select("amount").gte("created_at", dateStart).lte("created_at", dateEnd),
  ]);

  const cashSales = (salesData as { total: number }[] | null)?.reduce((s, r) => s + Number(r.total), 0) ?? 0;
  const expenses = (expensesData as { amount: number }[] | null)?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;
  const openingBalance = register?.opening_balance ?? 0;
  const expectedCash = openingBalance + cashSales - expenses;
  const discrepancy = actual_cash - expectedCash;

  const { data, error } = await supabase
    .from("cash_register")
    .update({
      expected_cash: expectedCash,
      actual_cash,
      discrepancy,
      notes: notes?.trim() || null,
      closed_by_device_id: device.id,
      closed_at: new Date().toISOString(),
    })
    .eq("date", dateStr)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notificacion push si el corte cerro con faltante o sobrante.
  after(() => notifyCashDiscrepancy(Number(discrepancy)));

  return NextResponse.json(data);
}
