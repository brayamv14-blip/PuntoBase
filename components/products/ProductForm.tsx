"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { ScannerButton } from "@/components/scanner/Scanner";
import { enqueueOp } from "@/lib/offline-ops";
import type { Product, ProductVariant, Category } from "@/types";

interface ProductFormProps {
  product?: Product & { variants: ProductVariant[]; category: Category | null };
}

export function ProductForm({ product }: ProductFormProps) {
  const router = useRouter();
  const isEdit = !!product;

  const [name, setName] = useState(product?.name ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [categoryInput, setCategoryInput] = useState(product?.category?.name ?? "");
  const [categoryId, setCategoryId] = useState(product?.category_id ?? null as string | null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCatSuggestions, setShowCatSuggestions] = useState(false);
  // Para productos individuales, lee el precio y el inventario de la variante predeterminada
  const [trackStock, setTrackStock] = useState(product?.track_stock ?? true);
  const [lowStockAlertEnabled, setLowStockAlertEnabled] = useState((product?.low_stock_threshold ?? 5) > 0);
  const [lowStockThreshold, setLowStockThreshold] = useState(product?.low_stock_threshold?.toString() ?? "5");
  // Todas las variantes, incluida la predeterminada sin etiqueta. Los productos nuevos comienzan con una fila vacía.
  const [variants, setVariants] = useState<(Partial<ProductVariant> & { tempId: string })[]>(() => {
    if (product) {
      return (product.variants ?? []).map((v) => ({ ...v, tempId: v.id }));
    }
    return [{ tempId: "default-new", size_label: "", price: 0, stock_qty: 0, low_stock_threshold: 5 }];
  });
  const [saving, setSaving] = useState(false);

  // Guarda el inventario original para registrar los ajustes al editar
  const [originalStockMap] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    (product?.variants ?? []).forEach((v) => map.set(v.id, v.stock_qty));
    return map;
  });
  const [adjustNote, setAdjustNote] = useState("");

  const hasStockChanges = isEdit && variants.some((v) => {
    if (!v.id) return false;
    const original = originalStockMap.get(v.id);
    return original !== undefined && Number(v.stock_qty ?? 0) !== original;
  });

  const namedVariants = variants.filter((v) => (v.size_label ?? "") !== "");
  const hasVariants = namedVariants.length > 0;

  useEffect(() => {
    apiFetch("/api/categories").then((r) => r.json()).then(setCategories);
  }, []);

  const filteredCats = categories.filter((c) =>
    c.name.toLowerCase().includes(categoryInput.toLowerCase())
  );

  async function handleCategorySelect(cat: Category | null) {
    if (cat) {
      setCategoryId(cat.id);
      setCategoryInput(cat.name);
    } else {
      // Crear una categoría nueva
      if (!categoryInput.trim()) return;
      const res = await apiFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: categoryInput.trim() }),
      });
      const data = await res.json();
      setCategoryId(data.id);
      setCategories((prev) => [...prev, data]);
    }
    setShowCatSuggestions(false);
  }

  function addVariant() {
    setVariants((prev) => [
      ...prev,
      { tempId: `new-${Date.now()}`, size_label: "", price: 0, stock_qty: 0, low_stock_threshold: 5 },
    ]);
  }

  function removeVariant(tempId: string) {
    setVariants((prev) => prev.filter((v) => v.tempId !== tempId));
  }

  function updateVariant(tempId: string, field: string, value: string | number) {
    setVariants((prev) => prev.map((v) => v.tempId === tempId ? { ...v, [field]: value } : v));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("El nombre es obligatorio");

    setSaving(true);
    try {
      const blankVariant = variants.find((v) => (v.size_label ?? "") === "");
      const threshold = lowStockAlertEnabled ? (Number(lowStockThreshold) || 5) : 0;

      // Sin conexion: el alta se guarda en el dispositivo y se envia al reconectar.
      if (!isEdit && !navigator.onLine) {
        if (hasVariants) {
          toast.error("Los productos con variantes necesitan conexión a internet.");
          return;
        }

        await enqueueOp("create_product", {
          name: name.trim(),
          category_id: categoryId,
          barcode,
          track_stock: trackStock,
          price: blankVariant ? Number(blankVariant.price ?? 0) : null,
          stock_qty: blankVariant ? (trackStock ? Number(blankVariant.stock_qty ?? 0) : 0) : null,
          low_stock_threshold: threshold,
        });
        toast.success("Producto guardado en el dispositivo. Se creará al reconectar.");
        router.push("/products");
        return;
      }

      // Guardar el producto
      const url = isEdit ? `/api/products/${product!.id}` : "/api/products";
      const method = isEdit ? "PUT" : "POST";
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify({
          name: name.trim(),
          category_id: categoryId,
          barcode,
          track_stock: trackStock,
          price: blankVariant ? Number(blankVariant.price ?? 0) : null,
          stock_qty: blankVariant ? (trackStock ? Number(blankVariant.stock_qty ?? 0) : 0) : null,
          low_stock_threshold: threshold,
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "No se pudo guardar el producto");

      const productId = data.id ?? product!.id;

      // Al editar, actualizar directamente la variante predeterminada si ya tiene un ID
      if (isEdit && blankVariant?.id) {
        await apiFetch(`/api/products/${productId}/variants/${blankVariant.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            size_label: "",
            price: Number(blankVariant.price ?? 0),
            low_stock_threshold: threshold,
          }),
        });
      }

      // Variantes con nombre o tamaño
      if (hasVariants) {
        const existingNamed = (product?.variants ?? []).filter((v) => v.size_label !== "");
        const existingIds = new Set(existingNamed.map((v) => v.id));
        for (const v of namedVariants) {
          const isNew = !existingIds.has(v.id ?? "");
          const varThreshold = lowStockAlertEnabled ? (v.low_stock_threshold ?? 5) : 0;
          if (isNew) {
            await apiFetch(`/api/products/${productId}/variants`, {
              method: "POST",
              body: JSON.stringify({ size_label: v.size_label, price: v.price, stock_qty: v.stock_qty, low_stock_threshold: varThreshold }),
            });
          } else {
            // Al editar, el inventario se actualiza mediante /api/stock/adjust
            const varBody: Record<string, unknown> = { size_label: v.size_label, price: v.price, low_stock_threshold: varThreshold };
            if (!isEdit) varBody.stock_qty = v.stock_qty;
            await apiFetch(`/api/products/${productId}/variants/${v.id}`, {
              method: "PUT",
              body: JSON.stringify(varBody),
            });
          }
        }

        // Eliminar las variantes que se quitaron
        const removedIds = existingNamed.filter((v) => !namedVariants.find((nv) => nv.id === v.id)).map((v) => v.id);
        for (const vid of removedIds) {
          await apiFetch(`/api/products/${productId}/variants/${vid}`, { method: "DELETE" });
        }
      }

      // Registrar ajustes de inventario al editar
      if (isEdit) {
        for (const v of variants) {
          if (!v.id) continue;
          const original = originalStockMap.get(v.id);
          const newQty = Number(v.stock_qty ?? 0);
          if (original !== undefined && newQty !== original) {
            await apiFetch("/api/stock/adjust", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                product_id: productId,
                variant_id: v.id,
                qty_change: newQty - original,
                note: adjustNote.trim() || null,
              }),
            });
          }
        }
      }

      toast.success(isEdit ? "Producto actualizado correctamente" : "Producto agregado correctamente");
      router.push("/products");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!product || !confirm("¿Seguro que deseas eliminar este producto?")) return;
    const res = await apiFetch(`/api/products/${product.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("No se pudo eliminar el producto");
    toast.success("Producto eliminado correctamente");
    router.push("/products");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label>Nombre *</Label>
        <Input placeholder="Nombre del producto" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="space-y-1">
        <Label>Código QR / barras <span className="text-muted-foreground">(opcional)</span></Label>
        <div className="flex gap-2">
          <Input placeholder="Escanea o escribe el código" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          <ScannerButton onScan={setBarcode} />
        </div>
      </div>

      {/* Categoría */}
      <div className="space-y-1 relative">
        <Label>Categoría <span className="text-muted-foreground">(opcional)</span></Label>
        <Input
          placeholder="Buscar o crear una categoría…"
          value={categoryInput}
          onChange={(e) => { setCategoryInput(e.target.value); setCategoryId(null); setShowCatSuggestions(true); }}
          onFocus={() => setShowCatSuggestions(true)}
          onBlur={() => setTimeout(() => setShowCatSuggestions(false), 150)}
        />
        {showCatSuggestions && (categoryInput || filteredCats.length > 0) && (
          <div className="absolute z-10 top-full left-0 right-0 bg-white border rounded-xl shadow-lg mt-1 overflow-hidden max-h-40 overflow-y-auto">
            {filteredCats.map((c) => (
              <button key={c.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
                onMouseDown={() => handleCategorySelect(c)}>{c.name}</button>
            ))}
            {categoryInput.trim() && !filteredCats.find((c) => c.name.toLowerCase() === categoryInput.toLowerCase()) && (
              <button type="button" className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-zinc-50"
                onMouseDown={() => handleCategorySelect(null)}>
                Crear &ldquo;{categoryInput.trim()}&rdquo;
              </button>
            )}
          </div>
        )}
      </div>

      {/* Control de inventario */}
      <div className="flex items-center gap-2">
        <input type="checkbox" id="track_stock" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} className="h-4 w-4" />
        <Label htmlFor="track_stock">Controlar cantidad en inventario</Label>
        {!trackStock && <span className="text-xs text-muted-foreground">No se contará ni se limitará el inventario</span>}
      </div>

      {trackStock && (
        <div className="flex items-center gap-2">
          <input type="checkbox" id="low_stock_alert" checked={lowStockAlertEnabled} onChange={(e) => setLowStockAlertEnabled(e.target.checked)} className="h-4 w-4" />
          <Label htmlFor="low_stock_alert">Alerta de inventario bajo</Label>
          {!lowStockAlertEnabled && <span className="text-xs text-muted-foreground">No se avisará cuando quede poco inventario</span>}
        </div>
      )}

      <Separator />

      {/* Variantes del producto */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Tamaños / Variantes</Label>
          <Button type="button" size="sm" variant="outline" onClick={addVariant}>+ Agregar tamaño</Button>
        </div>

        {variants.map((v) => (
          <div key={v.tempId} className="bg-zinc-50 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">{v.size_label || "—"}</Badge>
              <Button type="button" size="sm" variant="ghost" className="text-red-500 h-7"
                onClick={() => removeVariant(v.tempId!)}>Quitar</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Nombre del tamaño <span className="text-muted-foreground">(opcional)</span></Label>
                <Input placeholder="Ej. 500 g, Grande" value={v.size_label ?? ""}
                  onChange={(e) => updateVariant(v.tempId!, "size_label", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Precio (Rp) *</Label>
                <Input type="number" placeholder="0" value={v.price ?? ""}
                  onChange={(e) => updateVariant(v.tempId!, "price", Number(e.target.value))} />
              </div>
              {trackStock && (
                <div className="space-y-1">
                  <Label className="text-xs">Cantidad en inventario</Label>
                  <Input type="number" placeholder="0" value={v.stock_qty ?? ""}
                    onChange={(e) => updateVariant(v.tempId!, "stock_qty", Number(e.target.value))} />
                </div>
              )}
              {trackStock && lowStockAlertEnabled && (
                <div className="space-y-1">
                  <Label className="text-xs">Límite para alerta</Label>
                  <Input type="number" placeholder="5" value={v.low_stock_threshold ?? ""}
                    onChange={(e) => updateVariant(v.tempId!, "low_stock_threshold", Number(e.target.value))} />
                </div>
              )}
            </div>
          </div>
        ))}

      </div>

      {hasStockChanges && (
        <div className="space-y-1">
          <Label>Motivo del ajuste de inventario</Label>
          <Input placeholder="Motivo del cambio de inventario…" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Agregar producto"}
        </Button>
        {isEdit && (
          <Button type="button" variant="destructive" onClick={handleDelete}>Eliminar</Button>
        )}
      </div>
      <Button type="button" variant="ghost" className="w-full" onClick={() => router.back()}>Cancelar</Button>
    </form>
  );
}
