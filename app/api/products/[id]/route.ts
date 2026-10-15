import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";

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
    const defaultVariant = data?.variants?.find((v: { size_label: string }) => v.size_label === "");
    if (defaultVariant && data?.variants?.length === 1) {
      const variantUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (price != null) variantUpdate.price = price;
      if (stock_qty != null) variantUpdate.stock_qty = stock_qty;
      if (low_stock_threshold != null) variantUpdate.low_stock_threshold = low_stock_threshold;
      await supabase.from("product_variants").update(variantUpdate).eq("id", defaultVariant.id);
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const device = await getDeviceFromCookies();

    const { id } = await params;
    const { error } = await supabase
      .from("products")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
