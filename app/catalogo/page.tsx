import { supabase } from "@/lib/supabase/server";
import { getStockStatus, STOCK_STATUS_STYLE, type StockStatus } from "@/lib/stock-status";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catálogo | PuntoBase" };

type VariantRow = {
  price: number | string;
  stock_qty: number | string;
  low_stock_threshold: number | string;
};
type ProductRow = {
  id: string;
  name: string;
  track_stock: boolean;
  category: { name: string } | null;
  variants: VariantRow[];
};

const RANK: Record<StockStatus, number> = { green: 2, yellow: 1, red: 0 };

function availability(product: ProductRow): StockStatus {
  if (!product.track_stock) return "green";
  let best: StockStatus = "red";
  for (const v of product.variants) {
    const status = getStockStatus(Number(v.stock_qty), Number(v.low_stock_threshold));
    if (RANK[status] > RANK[best]) best = status;
  }
  return best;
}

// Pagina publica (sin sesion): solo nombre, categoria, precio y disponibilidad.
export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();

  const [{ data: config }, { data }] = await Promise.all([
    supabase.from("store_config").select("store_name").limit(1).maybeSingle(),
    supabase
      .from("products")
      .select("id, name, track_stock, category:categories(name), variants:product_variants(price, stock_qty, low_stock_threshold)")
      .eq("is_active", true)
      .order("name")
      .limit(500),
  ]);

  const storeName = (config as { store_name?: string } | null)?.store_name ?? "PuntoBase";
  const products = ((data ?? []) as unknown as ProductRow[]).filter(
    (p) => p.variants.length > 0 && (!query || p.name.toLowerCase().includes(query))
  );

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="font-bold text-2xl tracking-tight">{storeName}</h1>
        <p className="text-sm text-muted-foreground">Catálogo de productos</p>
      </header>

      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar producto…"
          className="flex-1 h-9 rounded-md border bg-background px-3 text-sm"
        />
        <button type="submit" className="h-9 rounded-md bg-primary text-primary-foreground px-4 text-sm">
          Buscar
        </button>
      </form>

      {products.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay productos que coincidan.</p>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((p) => {
          const prices = p.variants.map((v) => Number(v.price));
          const min = Math.min(...prices);
          const hasRange = Math.max(...prices) !== min;
          const status = STOCK_STATUS_STYLE[availability(p)];

          return (
            <li key={p.id} className="rounded-xl border bg-card p-3 space-y-1">
              <p className="font-medium">{p.name}</p>
              {p.category?.name && <p className="text-xs text-muted-foreground">{p.category.name}</p>}
              <p className="text-sm font-semibold">
                {hasRange ? "Desde " : ""}
                {formatCurrency(min)}
              </p>
              <p className={`inline-flex items-center gap-1 text-xs font-medium ${status.text}`}>
                <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                {status.label}
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
