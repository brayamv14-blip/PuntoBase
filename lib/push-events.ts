import { supabase } from "@/lib/supabase/server";
import { claimEvent, sendPush } from "@/lib/push";
import {
  detectStockAlerts,
  detectStockRecoveries,
  stockAlertsMessage,
  stockRecoveryMessage,
  type StockChange,
} from "@/lib/stock-alerts";
import { formatCurrency } from "@/lib/utils";

export interface VariantChange {
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

/** Ventana (ms) en la que un mismo producto no vuelve a generar el mismo aviso de semaforo. */
const STOCK_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Avisos de inventario para cambios de existencias (venta, ajuste manual, rechazo de transferencia):
 *  - cruza a amarillo (pocas piezas) o rojo (agotado),
 *  - vuelve a verde tras una reposicion.
 * Solo avisa cuando el semaforo CAMBIA y, ademas, un mismo producto/estado no se repite en 30 min.
 */
export async function notifyStockChanges(
  changes: VariantChange[],
  actorDeviceId?: string,
  now: number = Date.now()
): Promise<void> {
  try {
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
        id: change.variantId,
        name: `${product?.name ?? "Producto"}${label}`,
        oldQty: change.oldQty,
        newQty: change.newQty,
        threshold: Number(row.low_stock_threshold ?? 0),
      });
    }

    const bucket = Math.floor(now / STOCK_COOLDOWN_MS);

    const alerts = [];
    for (const alert of detectStockAlerts(stockChanges)) {
      if (await claimEvent(`stock:${alert.id}:${alert.status}:${bucket}`, "stock")) alerts.push(alert);
    }
    if (alerts.length > 0) {
      const { title, body } = stockAlertsMessage(alerts);
      await sendPush(
        { title, body, url: "/dashboard", tag: "stock-alert" },
        { category: "stock" }
      );
    }

    const recoveries = [];
    for (const rec of detectStockRecoveries(stockChanges)) {
      if (await claimEvent(`stock:${rec.id}:green:${bucket}`, "stock")) recoveries.push(rec);
    }
    if (recoveries.length > 0) {
      const { title, body } = stockRecoveryMessage(recoveries);
      await sendPush(
        { title, body, url: "/products", tag: "stock-recovery" },
        { category: "stock", excludeDeviceId: actorDeviceId }
      );
    }
  } catch (error) {
    console.error("[push] No se pudo avisar el cambio de inventario:", error instanceof Error ? error.message : error);
  }
}

/**
 * Notificaciones disparadas por una venta nueva (nunca por un reintento duplicado):
 *  - transferencia pendiente de confirmar,
 *  - venta sincronizada que requiere atencion (faltante de inventario),
 *  - venta completada (opcional: categoria "sales", desactivada por defecto),
 *  - semaforo de inventario.
 * No incluye nombres de clientes ni datos bancarios.
 */
export async function notifySaleEvents(
  saleId: string,
  changes: VariantChange[],
  actorDeviceId?: string,
  attentionNote?: string | null
): Promise<void> {
  try {
    const { data: sale } = await supabase
      .from("sales")
      .select("total, payment_status, payment_method, sale_number")
      .eq("id", saleId)
      .maybeSingle();

    if (sale && sale.payment_status === "pending") {
      await sendPush(
        {
          title: "Transferencia pendiente",
          body: `${formatCurrency(Number(sale.total))} por confirmar en tu banco`,
          url: "/transfers",
          tag: `transfer-${saleId}`,
        },
        { category: "transfers", dedupeKey: `transfer-pending:${saleId}` }
      );
    }

    if (sale && attentionNote) {
      await sendPush(
        {
          title: "Venta sincronizada requiere revisión",
          body: `${sale.sale_number}: ${attentionNote}`,
          url: "/reports",
          tag: `attention-${saleId}`,
        },
        { category: "sync", dedupeKey: `sale-attention:${saleId}` }
      );
    }

    if (sale) {
      await sendPush(
        {
          title: "Venta registrada",
          body: `${sale.sale_number} · ${formatCurrency(Number(sale.total))} (${
            sale.payment_method === "cash" ? "efectivo" : "transferencia"
          })`,
          url: "/reports",
          tag: `sale-${saleId}`,
        },
        { category: "sales", dedupeKey: `sale-completed:${saleId}`, excludeDeviceId: actorDeviceId }
      );
    }

    await notifyStockChanges(changes, actorDeviceId);
  } catch (error) {
    console.error("[push] No se pudo enviar la notificación de venta:", error instanceof Error ? error.message : error);
  }
}

/** Aviso al resolver una transferencia (confirmada o rechazada) a los demas dispositivos. */
export async function notifyTransferResolved(
  saleId: string,
  total: number,
  outcome: "confirmed" | "rejected",
  actorDeviceId?: string
): Promise<void> {
  await sendPush(
    {
      title: outcome === "confirmed" ? "Transferencia confirmada" : "Transferencia rechazada",
      body:
        outcome === "confirmed"
          ? `${formatCurrency(total)} confirmado en banco`
          : `${formatCurrency(total)} rechazado; el inventario se restituyó`,
      url: "/transfers",
      tag: `transfer-${saleId}`,
    },
    { category: "transfers", dedupeKey: `transfer-${outcome}:${saleId}`, excludeDeviceId: actorDeviceId }
  );
}

/** Aviso cuando el corte de caja cierra con faltante o sobrante. */
export async function notifyCashDiscrepancy(
  discrepancy: number,
  closeKey: string
): Promise<void> {
  if (!discrepancy) return;
  await sendPush(
    {
      title: discrepancy < 0 ? "Corte con faltante" : "Corte con sobrante",
      body: `Diferencia en caja: ${formatCurrency(Math.abs(discrepancy))}`,
      url: "/eod",
      tag: "cash-discrepancy",
    },
    { category: "cash", dedupeKey: `cash-close:${closeKey}` }
  );
}
