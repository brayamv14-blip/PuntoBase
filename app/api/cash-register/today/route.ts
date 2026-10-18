import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { getYesterdayOpeningBalance } from "@/lib/cash-register";
import { dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";

export async function GET() {
  try {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = todayDateString();

  // Try to find today's register first (open or closed)
  let { data: register, error: fetchError } = await supabase
    .from("cash_register")
    .select("*")
    .eq("date", today)
    .maybeSingle();

  if (fetchError) {
    console.error("cash-register fetch error:", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  // No register for today — create one
  if (!register) {
    const openingBalance = await getYesterdayOpeningBalance();
    const { data: created, error: insertError } = await supabase
      .from("cash_register")
      .insert({ date: today, opening_balance: openingBalance })
      .select()
      .single();
    if (insertError) {
      console.error("cash-register insert error:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    register = created;
  }

  const dateStr = register!.date as string;
  const dateStart = dayStartISO(dateStr);
  const dateEnd = dayEndISO(dateStr);

  // Transferencias del dia: cobradas vs pendientes de confirmar.
  const { data: transferData } = await supabase
    .from("sales")
    .select("total, payment_status")
    .neq("payment_method", "cash")
    .gte("created_at", dateStart)
    .lte("created_at", dateEnd);

  const transferRows = (transferData ?? []) as { total: number; payment_status: string }[];
  const transferPaidTotal = transferRows
    .filter((r) => r.payment_status === "paid")
    .reduce((s, r) => s + Number(r.total), 0);
  const transferPending = transferRows.filter((r) => r.payment_status === "pending");
  const transferPendingTotal = transferPending.reduce((s, r) => s + Number(r.total), 0);

  const [{ data: salesData }, { data: expensesData }] = await Promise.all([
    supabase
      .from("sales")
      .select("total, payment_method")
      .eq("payment_method", "cash")
      .gte("created_at", dateStart)
      .lte("created_at", dateEnd),
    supabase
      .from("expenses")
      .select("amount")
      .gte("created_at", dateStart)
      .lte("created_at", dateEnd),
  ]);

  const cashSalesTotal = (salesData as { total: number }[] | null)?.reduce((s, r) => s + Number(r.total), 0) ?? 0;
  const expensesTotal = (expensesData as { amount: number }[] | null)?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;
  const openingBalance = register?.opening_balance ?? 0;
  const expectedCash = openingBalance + cashSalesTotal - expensesTotal;

  return NextResponse.json({
    date: dateStr,
    opening_balance: openingBalance,
    cash_sales_total: cashSalesTotal,
    transfer_paid_total: transferPaidTotal,
    transfer_pending_total: transferPendingTotal,
    transfer_pending_count: transferPending.length,
    expenses_total: expensesTotal,
    expected_cash: expectedCash,
    actual_cash: register?.actual_cash ?? null,
    discrepancy: register?.discrepancy ?? null,
    closed_at: register?.closed_at ?? null,
    is_closed: !!register?.closed_at,
  });
  } catch (err) {
    console.error("cash-register/today unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
