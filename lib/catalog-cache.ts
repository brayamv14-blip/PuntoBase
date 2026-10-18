import { openDb, type Positioned } from "./db";
import type { Category, ProductWithVariants } from "@/types";

const PRODUCTS_AT = "products_cached_at";
const CATEGORIES_AT = "categories_cached_at";

function withPosition<T>(rows: T[]): Positioned<T>[] {
  return rows.map((row, index) => ({ ...row, __pos: index }));
}

function withoutPosition<T>(rows: Positioned<T>[]): T[] {
  return rows
    .sort((a, b) => a.__pos - b.__pos)
    .map((row) => {
      const { __pos: _ignored, ...rest } = row;
      void _ignored;
      return rest as unknown as T;
    });
}

export async function saveCachedProducts(
  products: ProductWithVariants[]
): Promise<void> {
  if (!Array.isArray(products)) {
    throw new Error("Los productos recibidos no son una lista válida.");
  }

  const db = await openDb();
  await db.transaction("rw", db.products, db.meta, async () => {
    await db.products.clear();
    await db.products.bulkPut(withPosition(products));
    await db.meta.put({ key: PRODUCTS_AT, value: new Date().toISOString() });
  });
}

export async function getCachedProducts(): Promise<
  ProductWithVariants[] | null
> {
  const db = await openDb();
  if (!(await db.meta.get(PRODUCTS_AT))) return null;
  return withoutPosition<ProductWithVariants>(await db.products.toArray());
}

export async function saveCachedCategories(
  categories: Category[]
): Promise<void> {
  if (!Array.isArray(categories)) {
    throw new Error("Las categorías recibidas no son una lista válida.");
  }

  const db = await openDb();
  await db.transaction("rw", db.categories, db.meta, async () => {
    await db.categories.clear();
    await db.categories.bulkPut(withPosition(categories));
    await db.meta.put({ key: CATEGORIES_AT, value: new Date().toISOString() });
  });
}

export async function getCachedCategories(): Promise<Category[] | null> {
  const db = await openDb();
  if (!(await db.meta.get(CATEGORIES_AT))) return null;
  return withoutPosition<Category>(await db.categories.toArray());
}

/**
 * Aplica una edicion hecha sin conexion al catalogo guardado en el dispositivo,
 * para que el POS y el inventario ya muestren el cambio antes de sincronizar.
 */
export async function patchCachedProduct(
  productId: string,
  patch: (product: ProductWithVariants) => ProductWithVariants
): Promise<void> {
  const products = await getCachedProducts();
  if (!products) return;

  await saveCachedProducts(
    products.map((product) => (product.id === productId ? patch(product) : product))
  );
}
