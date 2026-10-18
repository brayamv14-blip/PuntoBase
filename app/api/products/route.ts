import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("category_id");

  let query = supabase
    .from("products")
    .select("*, category:categories(*), variants:product_variants(*)")
    .eq("is_active", true)
    .order("name");

  if (categoryId) query = query.eq("category_id", categoryId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { name, category_id, track_stock, price, stock_qty, low_stock_threshold, barcode, client_id } = body;

    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    // Altas hechas sin conexion: si ya llegaron (reintento) o si otro dispositivo
    // dio de alta el mismo codigo de barras, se devuelve el producto existente en vez de duplicarlo.
    if (typeof client_id === "string" && client_id) {
      const FULL = "*, category:categories(*), variants:product_variants(*)";
      const { data: byClient } = await supabase
        .from("products")
        .select(FULL)
        .eq("client_id", client_id)
        .maybeSingle();
      if (byClient) return NextResponse.json({ ...byClient, duplicate: true }, { status: 200 });

      const code = typeof barcode === "string" ? barcode.trim() : "";
      if (code) {
        const { data: byBarcode } = await supabase
          .from("products")
          .select(FULL)
          .eq("barcode", code)
          .maybeSingle();
        if (byBarcode) return NextResponse.json({ ...byBarcode, duplicate: true }, { status: 200 });
      }
    }

    const { data, error } = await supabase
      .from("products")
      .insert({
        name: name.trim(),
        category_id: category_id || null,
        barcode: barcode?.trim() || null,
        track_stock: track_stock ?? true,
        price: null,
        stock_qty: null,
        low_stock_threshold: low_stock_threshold ?? 5,
        ...(typeof client_id === "string" && client_id ? { client_id } : {}),
        updated_at: new Date().toISOString(),
      })
      .select("*, category:categories(*), variants:product_variants(*)")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Ya existe un producto con ese código de barras." }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auto-create default variant (every product has at least 1 variant)
    await supabase.from("product_variants").insert({
      product_id: data.id,
      product_name: name.trim(),
      size_label: "",
      price: price ?? 0,
      stock_qty: (track_stock ?? true) ? (stock_qty ?? 0) : 0,
      low_stock_threshold: low_stock_threshold ?? 5,
    });

    // Re-fetch with variant included
    const { data: full } = await supabase
      .from("products")
      .select("*, category:categories(*), variants:product_variants(*)")
      .eq("id", data.id)
      .single();

    return NextResponse.json(full, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
