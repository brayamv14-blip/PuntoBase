import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { ReceiptDocument } from "@/components/receipt/ReceiptDocument";
import type { ReactElement } from "react";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [{ data: sale }, { data: config }] = await Promise.all([
    supabase
      .from("sales")
      .select("*, customer:customers(*), device:devices(id,name), items:sale_items(*)")
      .eq("id", id)
      .single(),
    supabase.from("store_config").select("store_name").eq("id", 1).single(),
  ]);

  if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

  const element = createElement(ReceiptDocument, {
    sale: sale as Parameters<typeof ReceiptDocument>[0]["sale"],
    storeName: config?.store_name ?? "PuntoBase",
  }) as ReactElement<DocumentProps>;

  const pdfBuffer = await renderToBuffer(element);
  const uint8 = new Uint8Array(pdfBuffer);

  return new NextResponse(uint8, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${sale.sale_number}.pdf"`,
    },
  });
}
