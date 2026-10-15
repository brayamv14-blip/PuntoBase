"use client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScannerButton } from "@/components/scanner/Scanner";
import { getStockStatus, STOCK_STATUS_STYLE } from "@/lib/stock-status";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useCart } from "@/hooks/useCart";
import Link from "next/link";
import type { ProductWithVariants, ProductVariant, Category } from "@/types";
import { isDefaultVariant, hasRealVariants } from "@/lib/product-helpers";
import { Pencil, Trash2, Check, X } from "lucide-react";

export default function ProductsPage() {
  const cart = useCart();

  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Add-to-cart dialog state
  const [cartDialog, setCartDialog] = useState<ProductWithVariants | null>(null);
  const [cartVariant, setCartVariant] = useState<ProductVariant | null>(null);
  const [cartQty, setCartQty] = useState("1");

  // Category management dialog state
  const [catDialog, setCatDialog] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    const res = await apiFetch("/api/products");
    setProducts(await res.json());
    setLoading(false);
  }, []);

  const loadCategories = useCallback(async () => {
    const res = await apiFetch("/api/categories");
    setCategories(await res.json());
  }, []);

  useEffect(() => {
    loadProducts();
    loadCategories();
  }, [loadProducts, loadCategories]);

  const filteredProducts = products.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (selectedCategory && p.category?.name !== selectedCategory) return false;
    return true;
  });

  function openCartDialog(p: ProductWithVariants) {
    setCartDialog(p);
    if (!hasRealVariants(p)) {
      const def = p.variants.find(isDefaultVariant);
      setCartVariant(def ?? null);
    } else {
      setCartVariant(null);
    }
    setCartQty("1");
  }

  function confirmAddToCart() {
    if (!cartDialog || !cartVariant) return;
    const qty = parseFloat(cartQty) || 1;
    cart.addItem({
      key: `product-${cartDialog.id}-${cartVariant.id}`,
      item_type: "product",
      product_id: cartDialog.id,
      variant_id: cartVariant.id,
      category_name: cartDialog.category?.name ?? undefined,
      description: cartVariant.size_label
        ? `${cartDialog.name} (${cartVariant.size_label})`
        : cartDialog.name,
      unit_price: cartVariant.price,
      qty,
    });
    toast.success("Added to cart");
    setCartDialog(null);
    setCartVariant(null);
    setCartQty("1");
  }

  function getStockBadge(stock: number, threshold: number) {
    const st = STOCK_STATUS_STYLE[getStockStatus(stock, threshold)];
    return (
      <span className={`inline-flex items-center justify-end gap-1 text-xs font-medium ${st.text}`} title={st.label}>
        <span className={`h-2 w-2 rounded-full ${st.dot}`} />
        {stock} Pcs
      </span>
    );
  }

  function handleScan(code: string) {
    const match = products.find((p) => p.barcode === code);
    if (match) { setSearch(match.name); toast.success(`Encontrado: ${match.name}`); }
    else { setSearch(code); toast.error("Código no registrado en el inventario"); }
  }

  async function saveCatRename(id: string) {
    if (!editingCatName.trim()) return;
    const res = await apiFetch(`/api/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: editingCatName.trim() }),
    });
    if (!res.ok) {
      const e = await res.json();
      toast.error(e.error ?? "Failed to rename");
      return;
    }
    toast.success("Category renamed");
    setEditingCatId(null);
    setEditingCatName("");
    await Promise.all([loadCategories(), loadProducts()]);
  }

  async function deleteCat(id: string) {
    const res = await apiFetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const e = await res.json();
      toast.error(e.error ?? "Failed to delete");
      setDeletingCatId(null);
      return;
    }
    toast.success("Category deleted");
    setDeletingCatId(null);
    if (selectedCategory === categories.find((c) => c.id === id)?.name) {
      setSelectedCategory(null);
    }
    await Promise.all([loadCategories(), loadProducts()]);
  }

  const cartDialogHasRealVariants = cartDialog ? hasRealVariants(cartDialog) : false;
  const showQtyStep = !cartDialogHasRealVariants || cartVariant !== null;

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">Stocks</h1>
        <div className="flex gap-2">
          <Link href="/stock/adjust">
            <Button size="sm">Adjust Stock</Button>
          </Link>
          <Link href="/products/new">
            <Button size="sm">+ Add</Button>
          </Link>
        </div>
      </div>

      {/* Search + Category filter */}
      <div className="flex gap-2">
        <ScannerButton onScan={handleScan} />
        <Input
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCatDialog(true)}
          className="flex-shrink-0 text-xs px-3"
        >
          Categories
        </Button>
      </div>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              selectedCategory === null
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-foreground/40"
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(selectedCategory === c.name ? null : c.name)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedCategory === c.name
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/40"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Product list */}
      {loading ? (
        <p className="text-center text-muted-foreground py-8">Loading…</p>
      ) : (
        <div className="space-y-2">
          {filteredProducts.map((p) => {
            const realVariants = hasRealVariants(p);
            const isOutOfStock = p.track_stock && p.variants.every((v) => v.stock_qty === 0);
            const defVariant = p.variants.find(isDefaultVariant);
            return (
              <div key={p.id} className="bg-card border rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{p.name}</p>

                    {realVariants ? (
                      <div className="mt-1 space-y-0.5">
                        {p.variants.filter((v) => v.size_label !== "").map((v) => (
                          <div key={v.id} className="flex text-xs text-muted-foreground">
                            <span className="w-20">{v.size_label}</span>
                            <span className="w-24 ml-2">{formatCurrency(v.price)}</span>
                            <span className="w-12 text-right">{p.track_stock ? getStockBadge(v.stock_qty, v.low_stock_threshold) : "—"}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1">
                        <div className="flex text-xs text-muted-foreground">
                          <span className="w-20">—</span>
                          <span className="w-24 ml-2">{formatCurrency(defVariant?.price ?? 0)}</span>
                          <span className="w-14 text-right">{p.track_stock && defVariant ? getStockBadge(defVariant.stock_qty, defVariant.low_stock_threshold) : "—"}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Add to cart button */}
                  <Button
                    size="sm"
                    variant={isOutOfStock ? "destructive" : "default"}
                    disabled={isOutOfStock}
                    onClick={() => openCartDialog(p)}
                    className="flex-shrink-0 disabled:opacity-100"
                    style={{ minWidth: "3.6rem" }}
                  >
                    {isOutOfStock ? "Out" : "+ Cart"}
                  </Button>
                </div>
              </div>
            );
          })}
          {filteredProducts.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              {search || selectedCategory ? "No products match your filter" : "No products yet"}
            </p>
          )}
        </div>
      )}

      {/* Add to Cart Dialog */}
      <Dialog open={!!cartDialog} onOpenChange={(open) => { if (!open) { setCartDialog(null); setCartVariant(null); setCartQty("1"); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cartDialog?.name}
              {cartVariant && cartVariant.size_label && <span className="text-muted-foreground font-normal"> — {cartVariant.size_label}</span>}
            </DialogTitle>
          </DialogHeader>

          {cartDialogHasRealVariants && !cartVariant && (
            <div className="space-y-2 mt-2">
              <p className="text-sm text-muted-foreground">Select size:</p>
              {cartDialog?.variants.filter((v) => v.size_label !== "").map((v) => {
                const outOfStock = cartDialog.track_stock && v.stock_qty === 0;
                return (
                  <button
                    key={v.id}
                    onClick={() => setCartVariant(v)}
                    disabled={outOfStock}
                    className="w-full flex justify-between items-center p-3 border rounded-xl text-left disabled:opacity-50 hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <span className="font-medium">{v.size_label}</span>
                    <span className="text-right">
                      <span className="font-bold">{formatCurrency(v.price)}</span>
                      {cartDialog.track_stock && <span className="text-xs text-muted-foreground ml-2">stock: {v.stock_qty}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {showQtyStep && cartVariant && (
            <div className="space-y-4 mt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price</span>
                <span className="font-bold">{formatCurrency(cartVariant.price)}</span>
              </div>
              <div className="space-y-1">
                <Label>Quantity</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" size="icon" variant="outline"
                    onClick={() => setCartQty((q) => String(Math.max(0.1, parseFloat(q) - 1)))}>−</Button>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={cartQty}
                    onChange={(e) => setCartQty(e.target.value)}
                    className="text-center"
                  />
                  <Button type="button" size="icon" variant="outline"
                    onClick={() => setCartQty((q) => String(parseFloat(q) + 1))}>+</Button>
                </div>
              </div>
              <Button className="w-full" onClick={confirmAddToCart}>
                Add to Cart · {formatCurrency(cartVariant.price * (parseFloat(cartQty) || 1))}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Category Management Dialog */}
      <Dialog open={catDialog} onOpenChange={(open) => {
        if (!open) { setCatDialog(false); setEditingCatId(null); setEditingCatName(""); setDeletingCatId(null); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Categories</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 mt-2">
            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
            )}
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-1.5">
                {editingCatId === c.id ? (
                  <>
                    <Input
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCatRename(c.id); if (e.key === "Escape") { setEditingCatId(null); setEditingCatName(""); } }}
                      className="flex-1 h-8 text-sm"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveCatRename(c.id)}>
                      <Check size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingCatId(null); setEditingCatName(""); }}>
                      <X size={14} />
                    </Button>
                  </>
                ) : deletingCatId === c.id ? (
                  <>
                    <span className="flex-1 text-sm text-red-600">Delete &ldquo;{c.name}&rdquo;?</span>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => deleteCat(c.id)}>Delete</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDeletingCatId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{c.name}</span>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingCatId(c.id); setEditingCatName(c.name); }}>
                      <Pencil size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeletingCatId(c.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
