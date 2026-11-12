import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { fetchAll } from "@/lib/paginate";
import { toCsv } from "@/lib/csv";
import { computeAnalytics } from "@/lib/analytics";
import { loadAnalyticsInput } from "@/lib/analytics-data";
import { dayEndISO, dayStartISO, isDateOnly, todayDateString } from "@/lib/utils";

type Row = Record<string, unknown>;

// GET /api/reports/export?type=summary|sales|returns|layaways&from=&to=   (CSV compatible con Excel; solo administrador)
export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const sp = new URL(req.url).searchParams;
    const type = sp.get("type") ?? "summary";
    const today = todayDateString();
    const from = sp.get("from") ?? today;
    const to = sp.get("to") ?? from;
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      return NextResponse.json({ error: "Rango de fechas inválido." }, { status: 400 });
    }
    const start = dayStartISO(from);
    const end = dayEndISO(to);
    const range = (q: any) => q.gte("created_at", start).lte("created_at", end).order("created_at", { ascending: true }); // eslint-disable-line @typescript-eslint/no-explicit-any

    let csv: string;
    if (type === "summary") {
      const a = computeAnalytics(await loadAnalyticsInput(from, to));
      csv = toCsv(["Concepto", "Valor"], [
        ["Periodo", `${from} a ${to}`],
        ["Ventas cobradas (brutas)", a.grossSales],
        ["Devoluciones", a.returnsTotal],
        ["Ventas netas", a.netSales],
        ["Cobrado en efectivo (neto)", a.cashSales],
        ["Cobrado por transferencia (neto)", a.transferSales],
        ["Transferencias pendientes (NO cobradas)", a.pendingTransfers],
        ["Gastos", a.expenses],
        ["Apartados cobrados (neto)", a.layawayCollected],
        ["Apartados pendientes de confirmar", a.layawayPending],
        ["Flujo neto cobrado", a.netCashFlow],
        ["Ganancia estimada", a.estimatedProfit],
        ["Cobertura de costos (%)", a.costCoverage],
        ["Ticket promedio", a.averageTicket],
      ]);
    } else if (type === "sales") {
      const rows = await fetchAll<Row>((a, b) => range(supabase.from("sales").select("sale_number, created_at, total, payment_method, payment_status, discount_type, discount_value, needs_attention")).range(a, b));
      csv = toCsv(["Folio", "Fecha", "Total", "Método", "Estado", "Tipo descuento", "Descuento", "Requiere revisión"],
        rows.map((r) => [r.sale_number as string, r.created_at as string, Number(r.total), r.payment_method as string, r.payment_status as string, (r.discount_type as string) ?? "", Number(r.discount_value ?? 0), r.needs_attention ? "Sí" : "No"]));
    } else if (type === "returns") {
      const rows = await fetchAll<Row>((a, b) => range(supabase.from("sale_returns").select("return_number, created_at, total_refund, refund_method, reason, restocked")).range(a, b));
      csv = toCsv(["Devolución", "Fecha", "Importe", "Método", "Motivo", "Reintegró inventario"],
        rows.map((r) => [r.return_number as string, r.created_at as string, Number(r.total_refund), r.refund_method as string, r.reason as string, r.restocked ? "Sí" : "No"]));
    } else if (type === "layaways") {
      const rows = await fetchAll<Row>((a, b) => range(supabase.from("layaways").select("folio, created_at, customer_name, total, due_date, status")).range(a, b));
      csv = toCsv(["Folio", "Creado", "Cliente", "Total", "Fecha límite", "Estado"],
        rows.map((r) => [r.folio as string, r.created_at as string, r.customer_name as string, Number(r.total), r.due_date as string, r.status as string]));
    } else {
      return NextResponse.json({ error: "Tipo de reporte inválido." }, { status: 400 });
    }

    after(() => audit(device, "export.report", "report", type, { from, to }));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="puntobase-${type}-${from}_${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[export]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo generar el archivo." }, { status: 500 });
  }
}
