import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";
import { audit } from "@/lib/audit";

// GET /api/products/cost?variant_id=  |  PATCH { variant_id, cost }   (solo administrador: el costo es confidencial)
export async function GET(req: NextRequest) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const forbidden = forbidUnlessAdmin(device);
  if (forbidden) return forbidden;
  const ids = (new URL(req.url).searchParams.get("variant_ids") ?? "").split(",").filter(Boolean).slice(0, 200);
  if (ids.length === 0) return NextResponse.json({ data: [] });
  const { data, error } = await supabase.from("product_variants").select("id, cost").in("id", ids);
  if (error) return NextResponse.json({ error: "No se pudieron consultar los costos." }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const body = await req.json().catch(() => ({}));
    const { variant_id } = body ?? {};
    const cost = body?.cost === null || body?.cost === "" ? null : Number(body?.cost);
    if (typeof variant_id !== "string" || !variant_id) return NextResponse.json({ error: "variant_id requerido" }, { status: 400 });
    if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 10_000_000)) {
      return NextResponse.json({ error: "Costo inválido." }, { status: 400 });
    }

    const { data: before } = await supabase.from("product_variants").select("id, cost").eq("id", variant_id).maybeSingle();
    if (!before) return NextResponse.json({ error: "Variante no encontrada." }, { status: 404 });
    const { error } = await supabase.from("product_variants").update({ cost: cost === null ? null : Math.round(cost * 100) / 100 }).eq("id", variant_id);
    if (error) throw error;

    after(() => audit(device, "product.cost", "product_variant", variant_id, { before: before.cost, after: cost }));
    return NextResponse.json({ ok: true, cost });
  } catch (e) {
    console.error("[product cost]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo guardar el costo." }, { status: 500 });
  }
}
