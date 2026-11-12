import { after, NextRequest, NextResponse } from "next/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";
import { computeAnalytics, pctChange, previousPeriod } from "@/lib/analytics";
import { loadAnalyticsInput, loadRestock } from "@/lib/analytics-data";
import { isDateOnly, todayDateString } from "@/lib/utils";

const MAX_DAYS = 400;

// GET /api/reports/analytics?from=&to=&compare=1   (solo administrador: incluye costos y ganancias)
export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const sp = new URL(req.url).searchParams;
    const today = todayDateString();
    const from = sp.get("from") ?? today;
    const to = sp.get("to") ?? from;
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      return NextResponse.json({ error: "Rango de fechas inválido." }, { status: 400 });
    }
    if ((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000 > MAX_DAYS) {
      return NextResponse.json({ error: `El rango máximo es de ${MAX_DAYS} días.` }, { status: 400 });
    }

    const input = await loadAnalyticsInput(from, to);
    const current = computeAnalytics(input);
    const paidIds = new Set(input.sales.filter((s) => s.payment_status === "paid").map((s) => s.id));
    const restock = await loadRestock(from, to, input.items, paidIds);

    let previous = null;
    let comparison = null;
    if (sp.get("compare") === "1") {
      const prev = previousPeriod(from, to);
      previous = { period: prev, ...computeAnalytics(await loadAnalyticsInput(prev.from, prev.to)) };
      comparison = {
        netSales: pctChange(current.netSales, previous.netSales),
        transactionCount: pctChange(current.transactionCount, previous.transactionCount),
        estimatedProfit: pctChange(current.estimatedProfit, previous.estimatedProfit),
        expenses: pctChange(current.expenses, previous.expenses),
        averageTicket: pctChange(current.averageTicket, previous.averageTicket),
      };
    }
    return NextResponse.json({ from, to, current, previous, comparison, restock });
  } catch (e) {
    console.error("[analytics]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo calcular el análisis." }, { status: 500 });
  }
}
