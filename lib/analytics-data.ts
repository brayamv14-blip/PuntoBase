import { supabase } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/paginate";
import {
  restockSuggestions, type AnalyticsInput, type ASale, type AItem, type AReturn, type AReturnItem,
  type AExpense, type ALayawayPayment, type VariantStock,
} from "@/lib/analytics";
import { dayEndISO, dayStartISO } from "@/lib/utils";

const CHUNK = 150;
async function inChunks<T>(table: string, select: string, col: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await fetchAll<T>((a, b) =>
      supabase.from(table).select(select).in(col, ids.slice(i, i + CHUNK)).range(a, b)
    );
    out.push(...part);
  }
  return out;
}

/** Lee todo lo necesario para el periodo [from, to] (AAAA-MM-DD, dias de la Ciudad de Mexico). */
export async function loadAnalyticsInput(from: string, to: string): Promise<AnalyticsInput> {
  const start = dayStartISO(from);
  const end = dayEndISO(to);
  const inRange = (q: any) => q.gte("created_at", start).lte("created_at", end).order("created_at", { ascending: true }); // eslint-disable-line @typescript-eslint/no-explicit-any

  const [sales, returns, expenses, layawayPayments] = await Promise.all([
    fetchAll<ASale>((a, b) => inRange(supabase.from("sales").select("id, total, subtotal, payment_method, payment_status, created_at")).range(a, b)),
    fetchAll<AReturn>((a, b) => inRange(supabase.from("sale_returns").select("id, sale_id, total_refund, refund_method, created_at")).range(a, b)),
    fetchAll<AExpense>((a, b) => inRange(supabase.from("expenses").select("amount, created_at")).range(a, b)),
    fetchAll<ALayawayPayment>((a, b) => inRange(supabase.from("layaway_payments").select("kind, method, amount, payment_status, created_at")).range(a, b)),
  ]);

  // Las partidas de una devolucion pertenecen a ventas que pudieron hacerse antes del periodo.
  const saleIds = sales.map((s) => s.id);
  const items = await inChunks<AItem>("sale_items", "id, sale_id, variant_id, description, unit_price, unit_cost, qty, line_total", "sale_id", saleIds);
  const returnItems = await inChunks<AReturnItem>("sale_return_items", "return_id, sale_item_id, qty, amount", "return_id", returns.map((r) => r.id));
  return { sales, items, returns, returnItems, expenses, layawayPayments };
}

/** Sugerencias de resurtido con base en las ventas del periodo observado. */
export async function loadRestock(from: string, to: string, items: AItem[], paidSaleIds: Set<string>) {
  const variants = await fetchAll<{ id: string; size_label: string | null; stock_qty: number; low_stock_threshold: number; product_id: string }>(
    (a, b) => supabase.from("product_variants").select("id, product_id, size_label, stock_qty, low_stock_threshold").range(a, b)
  );
  const products = await fetchAll<{ id: string; name: string; track_stock: boolean }>(
    (a, b) => supabase.from("products").select("id, name, track_stock").range(a, b)
  );
  const pById = new Map(products.map((p) => [p.id, p]));
  const sold = new Map<string, number>();
  for (const it of items) {
    if (!it.variant_id || !paidSaleIds.has(it.sale_id)) continue;
    sold.set(it.variant_id, (sold.get(it.variant_id) ?? 0) + Number(it.qty));
  }
  const list: VariantStock[] = variants
    .filter((v) => pById.get(v.product_id)?.track_stock)
    .map((v) => ({
      id: v.id,
      name: v.size_label ? `${pById.get(v.product_id)!.name} (${v.size_label})` : pById.get(v.product_id)!.name,
      stock_qty: Number(v.stock_qty),
      low_stock_threshold: Number(v.low_stock_threshold),
    }));
  const days = Math.max(1, Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1);
  return restockSuggestions(list, sold, days);
}
