import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { validateDueDate } from "@/lib/layaways";
import { LAYAWAY_SELECT as FULL, decorateLayaway as decorate, type LayawayRow as Row } from "@/lib/layaway-query";
import { applyStockDelta, revertStockMoves, type StockMove } from "@/lib/stock-ops";
import { notifyStockChanges } from "@/lib/push-events";
import { round2 } from "@/lib/cash-math";
import { dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";

// GET /api/layaways?view=active|expired|delivered|cancelled|all
export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const view = new URL(req.url).searchParams.get("view") ?? "active";
    const today = todayDateString();

    let q = supabase.from("layaways").select(FULL).order("due_date", { ascending: true }).limit(300);
    if (view === "active") q = q.eq("status", "active").gte("due_date", today);
    else if (view === "expired") q = q.eq("status", "active").lt("due_date", today);
    else if (view === "delivered" || view === "cancelled") {
      q = q.eq("status", view).order("created_at", { ascending: false });
    } else if (view !== "all") {
      return NextResponse.json({ error: "view inválido" }, { status: 400 });
    }

    const { data, error } = await q;
    if (error) {
      console.error("[layaways GET]", error.message);
      return NextResponse.json({ error: "No se pudieron consultar los apartados." }, { status: 500 });
    }
    return NextResponse.json({ data: (data ?? []).map((r: unknown) => decorate(r as Row, today)) });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/layaways
// { customer_name, customer_phone?, due_date, notes?, deposit, deposit_method, client_op_id?,
//   items: [{ variant_id, qty }] }
// El precio sale SIEMPRE del catalogo; el inventario se aparta (descuenta) al crear.
export async function POST(req: NextRequest) {
  const moves: StockMove[] = [];
  let layawayId: string | null = null;
  let layawayFolio = "";
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
    const customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 300) : "";
    const clientOpId = body.client_op_id;
    const deposit = round2(Number(body.deposit));
    const method = body.deposit_method;
    const items = body.items;
    const today = todayDateString();

    if (!customerName || customerName.length > 80) {
      return NextResponse.json({ error: "Indica el nombre del cliente." }, { status: 400 });
    }
    if (customerPhone.length > 30) return NextResponse.json({ error: "Teléfono demasiado largo." }, { status: 400 });
    const dueError = validateDueDate(body.due_date, today);
    if (dueError) return NextResponse.json({ error: dueError }, { status: 400 });
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return NextResponse.json({ error: "Agrega al menos un producto." }, { status: 400 });
    }
    if (method !== "cash" && method !== "bank_transfer") {
      return NextResponse.json({ error: "Método de pago inválido." }, { status: 400 });
    }
    if (!Number.isFinite(deposit) || deposit <= 0) {
      return NextResponse.json({ error: "El anticipo debe ser mayor a 0." }, { status: 400 });
    }
    if (clientOpId !== undefined && (typeof clientOpId !== "string" || !clientOpId || clientOpId.length > 200)) {
      return NextResponse.json({ error: "client_op_id inválido" }, { status: 400 });
    }
    const seen = new Set<string>();
    for (const it of items) {
      if (typeof it?.variant_id !== "string" || !Number.isInteger(it?.qty) || it.qty <= 0 || it.qty > 9999) {
        return NextResponse.json({ error: "Hay un producto inválido en el apartado." }, { status: 400 });
      }
      if (seen.has(it.variant_id)) {
        return NextResponse.json({ error: "Un producto está repetido; suma las cantidades." }, { status: 400 });
      }
      seen.add(it.variant_id);
    }

    if (clientOpId) {
      const { data: existing } = await supabase.from("layaways").select(FULL).eq("client_op_id", clientOpId).maybeSingle();
      if (existing) return NextResponse.json({ ...decorate(existing as Row, today), duplicate: true });
    }

    // Precios, costos y existencias desde la base (nunca del cliente).
    const lines: { variant_id: string; product_id: string; description: string; unit_price: number; unit_cost: number | null; qty: number; track: boolean }[] = [];
    for (const it of items as { variant_id: string; qty: number }[]) {
      const { data: v, error } = await supabase
        .from("product_variants")
        .select("id, product_id, size_label, price, cost, stock_qty")
        .eq("id", it.variant_id)
        .maybeSingle();
      if (error) throw error;
      const { data: product, error: prodError } = v
        ? await supabase.from("products").select("name, track_stock, is_active").eq("id", v.product_id).maybeSingle()
        : { data: null, error: null };
      if (prodError) throw prodError;
      if (!v || !product) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
      if (product.is_active === false) return NextResponse.json({ error: `${product.name} no está disponible.` }, { status: 409 });
      if (product.track_stock && Number(v.stock_qty) < it.qty) {
        return NextResponse.json({ error: `Existencias insuficientes para ${product.name}.` }, { status: 409 });
      }
      lines.push({
        variant_id: v.id,
        product_id: v.product_id,
        description: v.size_label ? `${product.name} (${v.size_label})` : product.name,
        unit_price: Number(v.price),
        unit_cost: v.cost == null ? null : Number(v.cost),
        qty: it.qty,
        track: !!product.track_stock,
      });
    }

    const total = round2(lines.reduce((s, l) => s + l.unit_price * l.qty, 0));
    if (deposit > total) {
      return NextResponse.json({ error: "El anticipo no puede ser mayor al total." }, { status: 400 });
    }

    // Folio por dia (hora de la Ciudad de Mexico).
    const { count } = await supabase
      .from("layaways")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStartISO(today))
      .lte("created_at", dayEndISO(today));
    const stamp = today.replace(/-/g, "");

    let layaway: { id: string; folio: string } | null = null;
    for (let n = (count ?? 0) + 1; n < (count ?? 0) + 4 && !layaway; n++) {
      const { data, error } = await supabase
        .from("layaways")
        .insert({
          folio: `A-${stamp}-${String(n).padStart(4, "0")}`,
          customer_name: customerName,
          customer_phone: customerPhone || null,
          total,
          due_date: body.due_date,
          notes: notes || null,
          created_by_device_id: device.id,
          client_op_id: clientOpId ?? null,
        })
        .select("id, folio")
        .single();
      if (!error) layaway = data;
      else if (error.code !== "23505") throw error;
      else if (clientOpId) {
        const { data: existing } = await supabase.from("layaways").select(FULL).eq("client_op_id", clientOpId).maybeSingle();
        if (existing) return NextResponse.json({ ...decorate(existing as Row, today), duplicate: true });
      }
    }
    if (!layaway) throw new Error("No se pudo asignar folio");
    layawayId = layaway.id;
    layawayFolio = layaway.folio;

    const { error: itemsError } = await supabase.from("layaway_items").insert(
      lines.map((l) => ({
        layaway_id: layaway!.id,
        product_id: l.product_id,
        variant_id: l.variant_id,
        description: l.description,
        unit_price: l.unit_price,
        unit_cost: l.unit_cost,
        qty: l.qty,
        line_total: round2(l.unit_price * l.qty),
        reserved: l.track,
      }))
    );
    if (itemsError) throw itemsError;

    // Apartar inventario.
    for (const l of lines) {
      if (!l.track) continue;
      let move: StockMove | null;
      try {
        move = await applyStockDelta(l.variant_id, -l.qty);
      } catch (e) {
        if (e instanceof Error && e.message === "INSUFFICIENT") {
          await rollbackCreate(layaway.id, layaway.folio, moves);
          return NextResponse.json({ error: `Existencias insuficientes para ${l.description}.` }, { status: 409 });
        }
        throw e;
      }
      if (move) {
        moves.push(move);
        await supabase.from("stock_adjustments").insert({
          product_id: l.product_id,
          variant_id: l.variant_id,
          adjustment_type: "layaway",
          qty_before: move.oldQty,
          qty_change: move.newQty - move.oldQty,
          qty_after: move.newQty,
          note: `Apartado ${layaway.folio}`,
          device_id: device.id,
        });
      }
    }

    const { error: payError } = await supabase.from("layaway_payments").insert({
      layaway_id: layaway.id,
      kind: "payment",
      method,
      amount: deposit,
      payment_status: method === "cash" ? "paid" : "pending",
      device_id: device.id,
      client_op_id: clientOpId ? `${clientOpId}:deposit` : null,
      paid_at: method === "cash" ? new Date().toISOString() : null,
    });
    if (payError) throw payError;

    after(async () => {
      if (moves.length) await notifyStockChanges(moves, device.id);
      await audit(device, "layaway.create", "layaway", layaway!.id, { folio: layaway!.folio, total, deposit, method });
    });

    const { data: full } = await supabase.from("layaways").select(FULL).eq("id", layaway.id).single();
    return NextResponse.json(decorate(full as Row, today), { status: 201 });
  } catch (error) {
    console.error("[layaways POST]", error);
    if (layawayId) await rollbackCreate(layawayId, layawayFolio, moves).catch(() => {});
    return NextResponse.json({ error: "No se pudo crear el apartado. No se hicieron cambios." }, { status: 500 });
  }
}

async function rollbackCreate(id: string, folio: string, moves: StockMove[]) {
  await revertStockMoves(moves);
  await supabase.from("stock_adjustments").delete().eq("note", `Apartado ${folio}`);
  await supabase.from("layaways").delete().eq("id", id); // items y pagos caen en cascada
}
