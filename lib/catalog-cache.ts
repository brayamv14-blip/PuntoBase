
import { openDB, type IDBPDatabase } from "idb";
import type { Category, ProductWithVariants } from "@/types";

const DB_NAME = "puntobase-catalog-cache";
const DB_VERSION = 1;

const PRODUCTS_STORE = "products";
const CATEGORIES_STORE = "categories";
const CACHE_KEY = "latest";

type CatalogDB = IDBPDatabase;

let dbPromise: Promise<CatalogDB> | null = null;

function getDB(): Promise<CatalogDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PRODUCTS_STORE)) {
          db.createObjectStore(PRODUCTS_STORE);
        }

        if (!db.objectStoreNames.contains(CATEGORIES_STORE)) {
          db.createObjectStore(CATEGORIES_STORE);
        }
      },
    }).catch((error) => {
      // Permite volver a intentar abrir la base de datos si falla.
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

export async function saveCachedProducts(
  products: ProductWithVariants[]
): Promise<void> {
  if (!Array.isArray(products)) {
    throw new Error("Los productos recibidos no son una lista válida.");
  }

  const db = await getDB();
  await db.put(PRODUCTS_STORE, products, CACHE_KEY);
}

export async function getCachedProducts(): Promise<
  ProductWithVariants[] | null
> {
  const db = await getDB();
  const products: unknown = await db.get(PRODUCTS_STORE, CACHE_KEY);

  if (products == null) {
    return null;
  }

  if (!Array.isArray(products)) {
    throw new Error("La caché local de productos no tiene un formato válido.");
  }

  return products as ProductWithVariants[];
}

export async function saveCachedCategories(
  categories: Category[]
): Promise<void> {
  if (!Array.isArray(categories)) {
    throw new Error("Las categorías recibidas no son una lista válida.");
  }

  const db = await getDB();
  await db.put(CATEGORIES_STORE, categories, CACHE_KEY);
}

export async function getCachedCategories(): Promise<Category[] | null> {
  const db = await getDB();
  const categories: unknown = await db.get(CATEGORIES_STORE, CACHE_KEY);

  if (categories == null) {
    return null;
  }

  if (!Array.isArray(categories)) {
    throw new Error(
      "La caché local de categorías no tiene un formato válido."
    );
  }

  return categories as Category[];
}
