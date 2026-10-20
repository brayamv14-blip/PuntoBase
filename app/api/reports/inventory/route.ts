import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import type { ProductWithVariants } from "@/types";

export async function GET() {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: rawProducts } = await supabase
      .from("products")
      .select("id, name, track_stock, variants:product_variants(id, size_label, price, stock_qty, low_stock_threshold)")
      .eq("is_active", true)
      .order("name");
    const products = rawProducts as ProductWithVariants[] | null;

    const productRows = (products ?? []).flatMap((p) =>
      (p.variants ?? []).map((v) => ({
        id: v.id,
        name: v.size_label ? `${p.name} (${v.size_label})` : p.name,
        track_stock: p.track_stock,
        stock_qty: v.stock_qty,
        price: v.price,
        low_stock_threshold: v.low_stock_threshold,
        is_low_stock: v.stock_qty <= v.low_stock_threshold && v.stock_qty > 0,
        is_out_of_stock: v.stock_qty === 0,
      }))
    );

    return NextResponse.json({ products: productRows });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
