import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { validName, validPrice, validStock } from "@/lib/catalog-validation";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: product_id, vid } = await params;
    const { size_label, price, stock_qty, low_stock_threshold } = await req.json();

    if (size_label !== undefined && !validName(size_label, 60) && size_label !== "") return NextResponse.json({ error: "Nombre de variante inválido." }, { status: 400 });
    if (price !== undefined && !validPrice(price)) return NextResponse.json({ error: "Precio inválido." }, { status: 400 });
    if (stock_qty !== undefined && !validStock(stock_qty)) return NextResponse.json({ error: "Existencias inválidas (entero, 0 o más)." }, { status: 400 });
    if (low_stock_threshold !== undefined && !validStock(low_stock_threshold)) return NextResponse.json({ error: "Mínimo de existencias inválido." }, { status: 400 });

    const { data: before } = await supabase.from("product_variants").select("stock_qty, price").eq("id", vid).maybeSingle();

    const { data, error } = await supabase
      .from("product_variants")
      .update({
        size_label: size_label?.trim(),
        price,
        stock_qty,
        low_stock_threshold,
        updated_at: new Date().toISOString(),
      })
      .eq("id", vid)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (before && stock_qty !== undefined && Number(stock_qty) !== Number(before.stock_qty)) {
      await supabase.from("stock_adjustments").insert({
        product_id,
        variant_id: vid,
        adjustment_type: "manual",
        qty_before: Number(before.stock_qty),
        qty_change: Number(stock_qty) - Number(before.stock_qty),
        qty_after: Number(stock_qty),
        note: "Edición de variante",
        device_id: device.id,
      });
    }
    await audit(device, "variant.update", "product_variant", vid, {
      price_before: before?.price ?? null, price_after: price ?? null, stock_after: stock_qty ?? null,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: product_id, vid } = await params;
    const { error } = await supabase.from("product_variants").delete().eq("id", vid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(device, "variant.delete", "product_variant", vid);

    // If no variants left, create default variant so product always has at least 1
    const { data: remaining } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", product_id);

    if (!remaining || remaining.length === 0) {
      const { data: prod } = await supabase.from("products").select("name, low_stock_threshold").eq("id", product_id).single();
      await supabase.from("product_variants").insert({
        product_id,
        product_name: prod?.name ?? null,
        size_label: "",
        price: 0,
        stock_qty: 0,
        low_stock_threshold: prod?.low_stock_threshold ?? 5,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
