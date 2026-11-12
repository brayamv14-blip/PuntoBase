import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { getYesterdayOpeningBalance } from "@/lib/cash-register";
import { computeCashCut } from "@/lib/cash-math";
import { getCashFlows } from "@/lib/cash-flows";
import { dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";

export async function GET() {
  try {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = todayDateString();

  // Try to find today's register first (open or closed)
  const { data: existing, error: fetchError } = await supabase
    .from("cash_register")
    .select("*")
    .eq("date", today)
    .maybeSingle();

  if (fetchError) {
    console.error("cash-register fetch error:", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  let register = existing;

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

  const flows = await getCashFlows(dateStart, dateEnd);
  const cashSalesTotal = flows.cashSales;
  const expensesTotal = flows.expenses;
  const openingBalance = Number(register?.opening_balance ?? 0);
  const { expectedCash } = computeCashCut({
    openingBalance,
    cashSales: flows.cashSales,
    cashRefunds: flows.cashRefunds,
    layawayCashIn: flows.layawayCashIn,
    layawayCashOut: flows.layawayCashOut,
    expenses: flows.expenses,
    actualCash: 0,
  });

  return NextResponse.json({
    date: dateStr,
    opening_balance: openingBalance,
    cash_sales_total: cashSalesTotal,
    cash_refunds_total: flows.cashRefunds,
    layaway_cash_in_total: flows.layawayCashIn,
    layaway_cash_out_total: flows.layawayCashOut,
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
