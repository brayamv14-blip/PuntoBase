import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { validName, validPrice, validStock } from "@/lib/catalog-validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await supabase
    .from("products")
    .select("*, category:categories(*), variants:product_variants(*)")
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { name, category_id, track_stock, price, stock_qty, low_stock_threshold, barcode } = body;

    if (name !== undefined && !validName(name)) return NextResponse.json({ error: "El nombre es obligatorio (máx. 120 caracteres)." }, { status: 400 });
    if (price != null && !validPrice(price)) return NextResponse.json({ error: "Precio inválido." }, { status: 400 });
    if (stock_qty != null && !validStock(stock_qty)) return NextResponse.json({ error: "Existencias inválidas (entero, 0 o más)." }, { status: 400 });
    if (low_stock_threshold != null && !validStock(low_stock_threshold)) return NextResponse.json({ error: "Mínimo de existencias inválido." }, { status: 400 });

    const { data, error } = await supabase
      .from("products")
      .update({
        name: name?.trim(),
        category_id: category_id ?? null,
        barcode: barcode?.trim() || null,
        track_stock: track_stock ?? true,
        low_stock_threshold: low_stock_threshold ?? 5,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*, category:categories(*), variants:product_variants(*)")
      .single();

    // Keep product_name in sync on variants if name changed
    if (name?.trim()) {
      await supabase
        .from("product_variants")
        .update({ product_name: name.trim() })
        .eq("product_id", id);
    }

    // If product has a single default variant (size_label = ''), update its price/stock
    const { data: variantRows } = await supabase.from("product_variants").select("id, size_label, stock_qty").eq("product_id", id);
    const variants = (variantRows ?? []) as { id: string; size_label: string; stock_qty: number }[];
    const defaultVariant = variants.find((v) => v.size_label === "");
    if (defaultVariant && variants.length === 1) {
      const variantUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (price != null) variantUpdate.price = price;
      if (stock_qty != null) variantUpdate.stock_qty = stock_qty;
      if (low_stock_threshold != null) variantUpdate.low_stock_threshold = low_stock_threshold;
      await supabase.from("product_variants").update(variantUpdate).eq("id", defaultVariant.id);

      // Todo cambio de existencias deja historial (antes se cambiaba sin rastro).
      if (stock_qty != null && Number(stock_qty) !== Number(defaultVariant.stock_qty)) {
        await supabase.from("stock_adjustments").insert({
          product_id: id,
          variant_id: defaultVariant.id,
          adjustment_type: "manual",
          qty_before: Number(defaultVariant.stock_qty),
          qty_change: Number(stock_qty) - Number(defaultVariant.stock_qty),
          qty_after: Number(stock_qty),
          note: "Edición del producto",
          device_id: device.id,
        });
      }
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(device, "product.update", "product", id, { name: name?.trim(), price: price ?? null, stock_qty: stock_qty ?? null });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { error } = await supabase
      .from("products")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(device, "product.delete", "product", id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
