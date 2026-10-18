import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";

type ReportSale = {
  id: string;
  sale_number: string | null;
  total: number;
  payment_method: string;
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
      new Date().toISOString().split("T")[0];

    const to = searchParams.get("to") ?? from;

    const fromISO = `${from}T00:00:00.000Z`;
    const toISO = `${to}T23:59:59.999Z`;

    const { data: sales, error } = await supabase
      .from("sales")
      .select("id, sale_number, total, payment_method, created_at")
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
        created_at: sale.created_at,
      })
    );

    const totalRevenue = typedSales.reduce(
      (sum: number, sale: ReportSale) => sum + sale.total,
      0
    );

    const cashRevenue = typedSales
      .filter(
        (sale: ReportSale) => sale.payment_method === "cash"
      )
      .reduce(
        (sum: number, sale: ReportSale) => sum + sale.total,
        0
      );

    const transferRevenue = typedSales
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
