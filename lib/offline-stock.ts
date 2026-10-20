import { openDb } from "./db";
import type { ProductWithVariants } from "@/types";

export interface SoldItem {
  product_id?: string | null;
  variant_id?: string | null;
  qty: number;
}

/**
 * Resta lo vendido del inventario mostrado (funcion pura). Respeta track_stock y nunca baja de 0.
 * Se usa para que el catalogo local refleje las ventas pendientes de sincronizar.
 */
export function reduceStock(
  products: ProductWithVariants[],
  items: SoldItem[]
): ProductWithVariants[] {
  if (items.length === 0) return products;

  const byVariant = new Map<string, number>();
  for (const item of items) {
    if (!item.variant_id) continue;
    byVariant.set(item.variant_id, (byVariant.get(item.variant_id) ?? 0) + Number(item.qty));
  }
  if (byVariant.size === 0) return products;

  return products.map((product) => {
    if (!product.track_stock) return product;
    if (!product.variants?.some((v) => byVariant.has(v.id))) return product;
    return {
      ...product,
      variants: product.variants.map((v) =>
        byVariant.has(v.id)
          ? { ...v, stock_qty: Math.max(0, Number(v.stock_qty) - (byVariant.get(v.id) ?? 0)) }
          : v
      ),
    };
  });
}

/** Descuenta una venta hecha sin conexion del catalogo guardado en el dispositivo. */
export async function decrementCachedStock(items: SoldItem[]): Promise<void> {
  const db = await openDb();
  const ids = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];

  await db.transaction("rw", db.products, async () => {
    for (const id of ids) {
      const row = await db.products.get(id);
      if (!row) continue;
      const { __pos, ...product } = row;
      const [updated] = reduceStock(
        [product as unknown as ProductWithVariants],
        items.filter((i) => i.product_id === id)
      );
      await db.products.put({ ...updated, __pos });
    }
  });
}

/**
 * Al refrescar el catalogo desde el servidor, vuelve a restar las ventas que aun estan en la
 * cola (el servidor todavia no las conoce), para que el inventario no "reaparezca".
 */
export async function applyPendingSalesToCatalog(
  products: ProductWithVariants[]
): Promise<ProductWithVariants[]> {
  try {
    const db = await openDb();
    const pending = await db.pending_sales.toArray();
    const items = pending.flatMap((entry) => entry.payload.items);
    return reduceStock(products, items);
  } catch {
    return products;
  }
}
