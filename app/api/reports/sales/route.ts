import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
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

    const { data: sales, error } = await supabase
      .from("sales")
      .select("id, sale_number, total, payment_method, payment_status, created_at")
      .neq("payment_status", "rejected")
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .order("created_at", { ascending: false });

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

    return NextResponse.json({
      from,
      to,
      total_revenue: totalRevenue,
      cash_revenue: cashRevenue,
      transfer_revenue: transferRevenue,
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
