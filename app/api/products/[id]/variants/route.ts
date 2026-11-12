import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { validName, validPrice, validStock } from "@/lib/catalog-validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: product_id } = await params;
    const { size_label, price, stock_qty, low_stock_threshold } = await req.json();

    if (!validName(size_label, 60) || !validPrice(price)) {
      return NextResponse.json({ error: "Nombre de variante y precio válidos son obligatorios." }, { status: 400 });
    }
    if (stock_qty != null && !validStock(stock_qty)) return NextResponse.json({ error: "Existencias inválidas." }, { status: 400 });
    if (low_stock_threshold != null && !validStock(low_stock_threshold)) return NextResponse.json({ error: "Mínimo de existencias inválido." }, { status: 400 });

    const { data: product } = await supabase
      .from("products")
      .select("name")
      .eq("id", product_id)
      .single();

    const { data, error } = await supabase
      .from("product_variants")
      .insert({
        product_id,
        product_name: product?.name ?? null,
        size_label: size_label.trim(),
        price,
        stock_qty: stock_qty ?? 0,
        low_stock_threshold: low_stock_threshold ?? 5,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Quita la variante por defecto (size_label = '') DESPUES de crear la nueva: si el alta falla,
    // el producto no se queda sin variantes.
    await supabase.from("product_variants").delete().eq("product_id", product_id).eq("size_label", "");
    await audit(device, "variant.update", "product_variant", data.id, { created: true, size_label: data.size_label, price: data.price });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
