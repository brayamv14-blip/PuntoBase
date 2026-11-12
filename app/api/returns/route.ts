import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canReturn, normalizeRole } from "@/lib/permissions";
import { computeReturn, type ReturnableItem } from "@/lib/returns";
import { applyStockDelta, revertStockMoves, type StockMove } from "@/lib/stock-ops";
import { notifyStockChanges } from "@/lib/push-events";
import { dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";

const FULL = "id, return_number, sale_id, reason, total_refund, refund_method, restocked, created_at, device:devices(name), items:sale_return_items(id, sale_item_id, qty, amount)";

// GET /api/returns?sale_id=...  |  ?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const saleId = searchParams.get("sale_id");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    let query = supabase
      .from("sale_returns")
      .select(`${FULL}, sale:sales(sale_number)`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (saleId) query = query.eq("sale_id", saleId);
    if (from) query = query.gte("created_at", dayStartISO(from));
    if (to) query = query.lte("created_at", dayEndISO(to));

    const { data, error } = await query;
    if (error) {
      console.error("[returns GET]", error.message);
      return NextResponse.json({ error: "No se pudieron consultar las devoluciones." }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/returns  { sale_id, items: [{ sale_item_id, qty }], reason, restock?, client_op_id? }
// La venta original NO se borra. Es idempotente por client_op_id.
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { sale_id, items, client_op_id } = body ?? {};
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const restock = body?.restock !== false;

    if (typeof sale_id !== "string" || !sale_id) {
      return NextResponse.json({ error: "sale_id requerido" }, { status: 400 });
    }
    if (reason.length < 3 || reason.length > 300) {
      return NextResponse.json({ error: "Indica el motivo de la devolución (3 a 300 caracteres)." }, { status: 400 });
    }
    if (client_op_id !== undefined && (typeof client_op_id !== "string" || !client_op_id || client_op_id.length > 200)) {
      return NextResponse.json({ error: "client_op_id inválido" }, { status: 400 });
    }

    if (client_op_id) {
      const { data: existing } = await supabase
        .from("sale_returns")
        .select(FULL)
        .eq("client_op_id", client_op_id)
        .maybeSingle();
      if (existing) return NextResponse.json({ ...existing, duplicate: true }, { status: 200 });
    }

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("id, sale_number, total, subtotal, payment_method, payment_status, created_at")
      .eq("id", sale_id)
      .maybeSingle();
    if (saleError) throw saleError;
    if (!sale) return NextResponse.json({ error: "Venta no encontrada." }, { status: 404 });

    if (sale.payment_status === "pending") {
      return NextResponse.json(
        { error: "La transferencia aún no está confirmada. Usa «Rechazar» en Transferencias para cancelarla." },
        { status: 409 }
      );
    }
    if (sale.payment_status !== "paid") {
      return NextResponse.json({ error: "Esta venta no está cobrada; no admite devoluciones." }, { status: 409 });
    }

    const role = normalizeRole(device.role);
    if (!canReturn(role, todayDateString(new Date(sale.created_at)), todayDateString())) {
      return NextResponse.json(
        { error: "Solo un administrador puede devolver ventas de días anteriores." },
        { status: 403 }
      );
    }

    // Lo vendido y lo ya devuelto (la fuente de verdad son las devoluciones registradas).
    const { data: saleItems, error: itemsError } = await supabase
      .from("sale_items")
      .select("id, product_id, variant_id, description, unit_price, qty")
      .eq("sale_id", sale.id);
    if (itemsError) throw itemsError;

    const { data: priorReturns, error: priorError } = await supabase
      .from("sale_returns")
      .select("id, total_refund")
      .eq("sale_id", sale.id);
    if (priorError) throw priorError;

    const priorIds = ((priorReturns ?? []) as { id: string }[]).map((r) => r.id);
    const priorRefunded = ((priorReturns ?? []) as { total_refund: number }[]).reduce(
      (s, r) => s + Number(r.total_refund),
      0
    );
    let priorItems: { sale_item_id: string; qty: number }[] = [];
    if (priorIds.length > 0) {
      const { data } = await supabase
        .from("sale_return_items")
        .select("sale_item_id, qty")
        .in("return_id", priorIds);
      priorItems = (data ?? []) as typeof priorItems;
    }

    const rows = (saleItems ?? []) as {
      id: string;
      product_id: string | null;
      variant_id: string | null;
      description: string;
      unit_price: number;
      qty: number;
    }[];
    const returnable: ReturnableItem[] = rows.map((r) => ({
      id: r.id,
      unit_price: Number(r.unit_price),
      qty: Number(r.qty),
      returned_qty: priorItems
        .filter((p) => p.sale_item_id === r.id)
        .reduce((s, p) => s + Number(p.qty), 0),
    }));

    const calc = computeReturn(
      { total: Number(sale.total), subtotal: Number(sale.subtotal) },
      returnable,
      Array.isArray(items) ? items : [],
      priorRefunded
    );
    if (!calc.ok) return NextResponse.json({ error: calc.error }, { status: 422 });

    // Numero de devolucion por dia de negocio (CDMX).
    const today = todayDateString();
    const { count } = await supabase
      .from("sale_returns")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStartISO(today))
      .lte("created_at", dayEndISO(today));
    const returnNumber = `D-${today.replace(/-/g, "")}-${String((count ?? 0) + 1).padStart(4, "0")}`;

    // 1) Registrar la devolucion (la restriccion unica protege contra reintentos simultaneos).
    const { data: created, error: createError } = await supabase
      .from("sale_returns")
      .insert({
        return_number: returnNumber,
        sale_id: sale.id,
        reason,
        total_refund: calc.total,
        refund_method: sale.payment_method,
        restocked: restock,
        device_id: device.id,
        client_op_id: client_op_id ?? null,
      })
      .select("id, return_number")
      .single();

    if (createError) {
      if ((createError as { code?: string }).code === "23505" && client_op_id) {
        const { data: existing } = await supabase.from("sale_returns").select(FULL).eq("client_op_id", client_op_id).maybeSingle();
        if (existing) return NextResponse.json({ ...existing, duplicate: true }, { status: 200 });
      }
      throw createError;
    }

    const moves: StockMove[] = [];
    try {
      const { error: lineError } = await supabase
        .from("sale_return_items")
        .insert(calc.lines.map((l) => ({ return_id: created.id, ...l })));
      if (lineError) throw lineError;

      // Verificacion posterior contra devoluciones simultaneas: si lo devuelto ya excede lo vendido,
      // esta devolucion (y la concurrente, si tambien se ve excedida) se deshace sin tocar inventario.
      const { data: allReturns } = await supabase.from("sale_returns").select("id").eq("sale_id", sale.id);
      const { data: allLines } = await supabase
        .from("sale_return_items")
        .select("sale_item_id, qty")
        .in("return_id", ((allReturns ?? []) as { id: string }[]).map((r) => r.id));
      for (const r of rows) {
        const returned = ((allLines ?? []) as { sale_item_id: string; qty: number }[])
          .filter((l) => l.sale_item_id === r.id)
          .reduce((t, l) => t + Number(l.qty), 0);
        if (returned > Number(r.qty) + 1e-9) throw new Error("OVER_RETURN");
      }

      // 2) Reintegrar inventario y registrar el ajuste.
      if (restock) {
        for (const line of calc.lines) {
          const item = rows.find((r) => r.id === line.sale_item_id)!;
          if (!item.product_id || !item.variant_id) continue;
          const { data: product } = await supabase
            .from("products")
            .select("track_stock")
            .eq("id", item.product_id)
            .maybeSingle();
          if (!product?.track_stock) continue;

          const move = await applyStockDelta(item.variant_id, line.qty);
          if (!move) continue;
          moves.push(move);
          const { error: adjError } = await supabase.from("stock_adjustments").insert({
            product_id: item.product_id,
            variant_id: item.variant_id,
            adjustment_type: "refund",
            qty_before: move.oldQty,
            qty_change: line.qty,
            qty_after: move.newQty,
            note: `Devolución ${created.return_number} (${sale.sale_number})`,
            device_id: device.id,
            related_sale_id: sale.id,
          });
          if (adjError) throw adjError;
        }
      }

      // 3) Compatibilidad con la pantalla anterior (sale_items.refunded_qty).
      for (const line of calc.lines) {
        const prev = returnable.find((r) => r.id === line.sale_item_id)!.returned_qty;
        await supabase.from("sale_items").update({ refunded_qty: prev + line.qty }).eq("id", line.sale_item_id);
      }
    } catch (error) {
      console.error("[returns] Falló el registro; se revierte:", error instanceof Error ? error.message : error);
      await revertStockMoves(moves);
      await supabase.from("stock_adjustments").delete().eq("related_sale_id", sale.id).like("note", `Devolución ${created.return_number}%`);
      await supabase.from("sale_return_items").delete().eq("return_id", created.id);
      await supabase.from("sale_returns").delete().eq("id", created.id);
      if (error instanceof Error && error.message === "OVER_RETURN") {
        return NextResponse.json({ error: "Otra devolución de esta venta se registró al mismo tiempo. Actualiza e intenta de nuevo." }, { status: 409 });
      }
      return NextResponse.json({ error: "No se pudo registrar la devolución. No se hicieron cambios." }, { status: 500 });
    }

    after(async () => {
      await notifyStockChanges(moves, device.id);
      await audit(device, "return.create", "sale", sale.id, {
        return_number: created.return_number,
        total_refund: calc.total,
        method: sale.payment_method,
        restock,
        reason,
      });
    });

    return NextResponse.json(
      {
        id: created.id,
        return_number: created.return_number,
        total_refund: calc.total,
        refund_method: sale.payment_method,
        completes_sale: calc.completesSale,
        lines: calc.lines,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[returns POST]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo procesar la devolución." }, { status: 500 });
  }
}
