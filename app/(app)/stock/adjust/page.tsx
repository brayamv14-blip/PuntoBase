"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { ProductForm } from "@/components/products/ProductForm";
import type { Product, ProductVariant, Category } from "@/types";

type FullProduct = Product & {
  variants: ProductVariant[];
  category: Category | null;
};

export default function EditProductPage() {
  const searchParams = useSearchParams();

  const [products, setProducts] = useState<FullProduct[]>([]);
  const [search, setSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedProduct, setSelectedProduct] =
    useState<FullProduct | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/products")
      .then((r) => r.json())
      .then((data: FullProduct[]) => {
        setProducts(data);
        setLoading(false);

        // Seleccionar automáticamente el producto indicado en ?product=<id>
        const productId = searchParams.get("product");

        if (productId) {
          const found = data.find((p) => p.id === productId);

          if (found) {
            setSelectedProduct(found);
            setSearch(found.name);
          }
        }
      });
  }, [searchParams]);

  const filtered = products.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase())
  );

  function selectProduct(p: FullProduct) {
    setSelectedProduct(p);
    setSearch(p.name);
    setShowSuggestions(false);
  }

  function clearProduct() {
    setSelectedProduct(null);
    setSearch("");
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="font-bold text-xl mb-4">
        Editar producto
      </h1>

      {/* Buscar producto */}
      <div className="space-y-1 relative mb-4">
        <Label>Buscar producto</Label>

        <Input
          placeholder="Escribe el nombre del producto..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowSuggestions(true);

            if (
              selectedProduct &&
              e.target.value !== selectedProduct.name
            ) {
              clearProduct();
              setSearch(e.target.value);
              setShowSuggestions(true);
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() =>
            setTimeout(() => setShowSuggestions(false), 150)
          }
        />

        {showSuggestions &&
          filtered.length > 0 &&
          !selectedProduct && (
            <div className="absolute z-10 top-full left-0 right-0 bg-white border rounded-xl shadow-lg mt-1 overflow-hidden max-h-48 overflow-y-auto">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
                  onMouseDown={() => selectProduct(p)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
      </div>

      {loading && (
        <p className="text-center text-muted-foreground py-8">
          Cargando productos...
        </p>
      )}

      {!loading && !selectedProduct && (
        <p className="text-center text-muted-foreground py-8">
          Busca y selecciona un producto para editarlo.
        </p>
      )}

      {selectedProduct && (
        <ProductForm
          key={selectedProduct.id}
          product={selectedProduct}
        />
      )}
    </div>
  );
}