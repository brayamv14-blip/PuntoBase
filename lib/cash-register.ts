import { supabase } from "@/lib/supabase/server";
import { addDays, dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";

/**
 * Returns the best available opening balance for today's register.
 * Priority:
 *   1. Yesterday's actual_cash (normal closed EOD)
 *   2. Yesterday's expected_cash (EOD skipped — calculated from opening + sales - expenses)
 *   3. 0 (no prior register at all)
 */
export async function getYesterdayOpeningBalance(): Promise<number> {
  const yDate = addDays(todayDateString(), -1);

  const { data: prev } = await supabase
    .from("cash_register")
    .select("actual_cash, opening_balance")
    .eq("date", yDate)
    .single();

  if (!prev) return 0;

  // EOD was done — use actual counted cash
  if (prev.actual_cash != null) return Number(prev.actual_cash);

  // EOD was skipped — calculate expected cash for yesterday
  const yStart = dayStartISO(yDate);
  const yEnd = dayEndISO(yDate);

  const [{ data: salesData }, { data: expensesData }] = await Promise.all([
    supabase.from("sales").select("total").eq("payment_method", "cash").gte("created_at", yStart).lte("created_at", yEnd),
    supabase.from("expenses").select("amount").gte("created_at", yStart).lte("created_at", yEnd),
  ]);

  const cashSales = (salesData as { total: number }[] | null)?.reduce((s, r) => s + Number(r.total), 0) ?? 0;
  const expenses = (expensesData as { amount: number }[] | null)?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;

  return Number(prev.opening_balance ?? 0) + cashSales - expenses;
}

/**
 * Ensures a cash register row exists for the current business day.
 * If the latest register is already closed, reopens it so EOD must be resubmitted.
 * Dates are Mexico City calendar days (see lib/utils.ts).
 */
export async function ensureOpenCashRegister(): Promise<void> {
  const { data: latest } = await supabase
    .from("cash_register")
    .select("id, closed_at")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (!latest) {
    const today = todayDateString();
    const openingBalance = await getYesterdayOpeningBalance();
    await supabase.from("cash_register").insert({ date: today, opening_balance: openingBalance });
    return;
  }

  if (latest.closed_at) {
    await supabase
      .from("cash_register")
      .update({ closed_at: null, actual_cash: null, expected_cash: null, discrepancy: null, closed_by_device_id: null, notes: null })
      .eq("id", latest.id);
  }
}
