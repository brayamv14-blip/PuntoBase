import { supabase } from "@/lib/supabase/server";
import { sendPushToAll } from "@/lib/push";
import { detectStockAlerts, stockAlertsMessage, type StockChange } from "@/lib/stock-alerts";
import { formatCurrency } from "@/lib/utils";

interface VariantChange {
  variantId: string;
  oldQty: number;
  newQty: number;
}

type VariantRow = {
  id: string;
  size_label: string | null;
  low_stock_threshold: number | string | null;
  product: { name: string } | { name: string }[] | null;
};

/**
 * Notificaciones push disparadas por una venta:
 *  - transferencia pendiente de confirmar,
 *  - producto que pasa a amarillo (pocas piezas) o rojo (agotado).
 */
export async function notifySaleEvents(saleId: string, changes: VariantChange[]): Promise<void> {
  try {
    const { data: sale } = await supabase
      .from("sales")
      .select("total, payment_status, sale_number")
      .eq("id", saleId)
      .maybeSingle();

    if (sale && sale.payment_status === "pending") {
      await sendPushToAll({
        title: "Transferencia pendiente",
        body: `${formatCurrency(Number(sale.total))} por confirmar en tu banco`,
        url: "/transfers",
        tag: `transfer-${saleId}`,
      });
    }

    if (changes.length === 0) return;

    const { data } = await supabase
      .from("product_variants")
      .select("id, size_label, low_stock_threshold, product:products(name)")
      .in("id", changes.map((c) => c.variantId));

    const rows = (data ?? []) as unknown as VariantRow[];
    const stockChanges: StockChange[] = [];

    for (const change of changes) {
      const row = rows.find((r) => r.id === change.variantId);
      if (!row) continue;
      const product = Array.isArray(row.product) ? row.product[0] : row.product;
      const label = row.size_label ? ` (${row.size_label})` : "";
      stockChanges.push({
        name: `${product?.name ?? "Producto"}${label}`,
        oldQty: change.oldQty,
        newQty: change.newQty,
        threshold: Number(row.low_stock_threshold ?? 0),
      });
    }

    const alerts = detectStockAlerts(stockChanges);
    if (alerts.length > 0) {
      const { title, body } = stockAlertsMessage(alerts);
      await sendPushToAll({ title, body, url: "/dashboard", tag: "stock-alert" });
    }
  } catch (error) {
    console.error("[push] No se pudo enviar la notificacion:", error);
  }
}

/** Aviso cuando el corte de caja cierra con faltante o sobrante. */
export async function notifyCashDiscrepancy(discrepancy: number): Promise<void> {
  if (!discrepancy) return;
  await sendPushToAll({
    title: discrepancy < 0 ? "Corte con faltante" : "Corte con sobrante",
    body: `Diferencia en caja: ${formatCurrency(Math.abs(discrepancy))}`,
    url: "/eod",
    tag: "cash-discrepancy",
  });
}
