import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { fetchAll } from "@/lib/paginate";
import { round2, sumAmounts } from "@/lib/cash-math";
import { dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";

type ReportSale = {
  id: string;
  sale_number: string | null;
  total: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();

    if (!device) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);

    const from =
      searchParams.get("from") ??
      todayDateString();

    const to = searchParams.get("to") ?? from;

    const fromISO = dayStartISO(from);
    const toISO = dayEndISO(to);

    let sales: ReportSale[] = [];
    let returns: { total_refund: number; refund_method: string }[] = [];
    let error: { message: string } | null = null;
    try {
      sales = (await fetchAll((a, b) =>
        supabase
          .from("sales")
          .select("id, sale_number, total, payment_method, payment_status, created_at")
          .neq("payment_status", "rejected")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at", { ascending: false })
          .range(a, b)
      )) as ReportSale[];
      returns = (await fetchAll((a, b) =>
        supabase
          .from("sale_returns")
          .select("total_refund, refund_method")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at", { ascending: false })
          .range(a, b)
      )) as typeof returns;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    }

    if (error) {
      console.error(
        "Error al consultar ventas:",
        error.message
      );

      return NextResponse.json(
        { error: "No se pudieron consultar las ventas." },
        { status: 500 }
      );
    }

    const typedSales: ReportSale[] = (sales ?? []).map(
      (sale: ReportSale) => ({
        id: sale.id,
        sale_number: sale.sale_number,
        total: Number(sale.total),
        payment_method: sale.payment_method,
        payment_status: sale.payment_status,
        created_at: sale.created_at,
      })
    );

    // Los ingresos solo cuentan lo cobrado: una transferencia pendiente se informa aparte
    // y una rechazada no aparece.
    const confirmed = typedSales.filter((s: ReportSale) => s.payment_status === "paid");
    const pendingSales = typedSales.filter((s: ReportSale) => s.payment_status === "pending");

    const totalRevenue = confirmed.reduce(
      (sum: number, sale: ReportSale) => sum + sale.total,
      0
    );

    const cashRevenue = confirmed
      .filter(
        (sale: ReportSale) => sale.payment_method === "cash"
      )
      .reduce(
        (sum: number, sale: ReportSale) => sum + sale.total,
        0
      );

    const transferRevenue = confirmed
      .filter(
        (sale: ReportSale) =>
          sale.payment_method === "bank_transfer"
      )
      .reduce(
        (sum: number, sale: ReportSale) => sum + sale.total,
        0
      );

    // Devoluciones: se descuentan en la fecha en que se hicieron; la venta original no se modifica.
    const returnsTotal = sumAmounts(returns, "total_refund");
    const cashReturns = sumAmounts(returns.filter((r) => r.refund_method === "cash"), "total_refund");
    const transferReturns = round2(returnsTotal - cashReturns);

    return NextResponse.json({
      from,
      to,
      gross_revenue: round2(totalRevenue),
      returns_total: returnsTotal,
      returns_count: returns.length,
      net_revenue: round2(totalRevenue - returnsTotal),
      total_revenue: round2(totalRevenue - returnsTotal),
      cash_revenue: round2(cashRevenue - cashReturns),
      transfer_revenue: round2(transferRevenue - transferReturns),
      pending_transfer_revenue: pendingSales.reduce(
        (sum: number, sale: ReportSale) => sum + sale.total,
        0
      ),
      pending_transfer_count: pendingSales.length,
      transaction_count: typedSales.length,
      sales: typedSales,
    });
  } catch (error) {
    console.error("Error en reporte de ventas:", error);

    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}
