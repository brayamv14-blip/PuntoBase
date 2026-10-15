import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import type { CreateSaleRequest, DiscountType, PaymentMethod } from "@/types";
import { ensureOpenCashRegister } from "@/lib/cash-register";

// GET /api/sales
export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limit = parseInt(searchParams.get("limit") ?? "50");
    const offset = parseInt(searchParams.get("offset") ?? "0");

    let query = supabase
      .from("sales")
      .select("*, customer:customers(*), device:devices(id,name), items:sale_items(*)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    const { data, error, count } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, count });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/sales — all roles; atomic sale processing
export async function POST(req: NextRequest) {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: CreateSaleRequest = await req.json();
  const { items, customer_id, customer_name, customer_phone, discount_type, discount_value = 0, payment_method, notes } = body;

  if (!items?.length) return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  if (!payment_method) return NextResponse.json({ error: "payment_method required" }, { status: 400 });

  try {
    // ── 1. Resolve customer ──────────────────────────────────────────────────
    let resolvedCustomerId = customer_id ?? null;
    if (!resolvedCustomerId && customer_name?.trim()) {
      const { data: newCustomer } = await supabase
        .from("customers")
        .insert({ name: customer_name.trim(), phone: customer_phone?.trim() || null })
        .select()
        .single();
      resolvedCustomerId = newCustomer?.id ?? null;
    }

    // ── 3. Validate product/variant stock (skip untracked) ─────────────────
    const productItems = items.filter((i) => i.item_type === "product");
    for (const pi of productItems) {
      const { data: prod } = await supabase
        .from("products")
        .select("track_stock")
        .eq("id", pi.product_id!)
        .single();
      if (!prod) {
        return NextResponse.json({ error: `Product not found for ${pi.description}` }, { status: 404 });
      }
      if (!prod.track_stock) continue;

      const { data: variant } = await supabase
        .from("product_variants")
        .select("stock_qty")
        .eq("id", pi.variant_id!)
        .single();
      if (!variant || variant.stock_qty < pi.qty) {
        return NextResponse.json({ error: `Insufficient stock for ${pi.description}` }, { status: 409 });
      }
    }

    // ── 4. Calculate totals ───────────────────────────────────────────────────
    const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.qty, 0);
    let discountAmount = 0;
    if (discount_type === "flat") discountAmount = discount_value;
    else if (discount_type === "percent") discountAmount = (subtotal * discount_value) / 100;
    const total = Math.max(0, subtotal - discountAmount);

    // ── 5. Generate sale number ───────────────────────────────────────────────
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const { count: todayCount } = await supabase
      .from("sales")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date().toISOString().split("T")[0]);
    const saleNumber = `S-${today}-${String((todayCount ?? 0) + 1).padStart(4, "0")}`;

    // ── 6. Insert sale ───────────────────────────────────────────────────────
    const { data: sale, error: saleErr } = await supabase
      .from("sales")
      .insert({
        sale_number: saleNumber,
        device_id: device.id,
        customer_id: resolvedCustomerId,
        discount_type: discount_type || null,
        discount_value,
        subtotal,
        total,
        payment_method: payment_method as PaymentMethod,
        payment_status: payment_method === "cash" ? "paid" : "pending",
        paid_at: payment_method === "cash" ? new Date().toISOString() : null,
        notes: notes?.trim() || null,
      })
      .select()
      .single();

    if (saleErr) {
      // Retry if sale number collision
      if (saleErr.code === "23505") {
        const retryNumber = `S-${today}-${String((todayCount ?? 0) + 2).padStart(4, "0")}`;
        const { data: retrySale, error: retryErr } = await supabase
          .from("sales")
          .insert({
            sale_number: retryNumber,
            device_id: device.id,
            customer_id: resolvedCustomerId,
            discount_type: discount_type || null,
            discount_value,
            subtotal,
            total,
            payment_method: payment_method as PaymentMethod,
        payment_status: payment_method === "cash" ? "paid" : "pending",
        paid_at: payment_method === "cash" ? new Date().toISOString() : null,
            notes: notes?.trim() || null,
          })
          .select()
          .single();
        if (retryErr) throw retryErr;
        return processSaleItems(retrySale, items, device.id);
      }
      throw saleErr;
    }

    return await processSaleItems(sale, items, device.id);
  } catch (err) {
    console.error("[sales POST]", err);
    return NextResponse.json({ error: "Failed to process sale" }, { status: 500 });
  }
}

async function processSaleItems(sale: { id: string; payment_method: string }, items: CreateSaleRequest["items"], deviceId: string) {
  const now = new Date().toISOString();
  const rollbacks: (() => Promise<void>)[] = [];

  try {
    // ── 7. Insert sale items ───────────────────────────────────────────────
    const saleItemRows = items.map((i) => ({
      sale_id: sale.id,
      item_type: i.item_type,
      product_id: i.product_id ?? null,
      variant_id: i.variant_id ?? null,
      description: i.description,
      unit_price: i.unit_price,
      qty: i.qty,
      line_total: i.unit_price * i.qty,
    }));

    const { error: itemsErr } = await supabase.from("sale_items").insert(saleItemRows);
    if (itemsErr) throw itemsErr;
    rollbacks.push(async () => {
      await supabase.from("sale_items").delete().eq("sale_id", sale.id);
    });

    // ── 9. Deduct variant stock + log adjustments (skip untracked) ────────
    const productItems = items.filter((i) => i.item_type === "product");
    const stockChanges: { variantId: string; oldQty: number }[] = [];
    for (const pi of productItems) {
      const { data: prodCheck } = await supabase
        .from("products")
        .select("track_stock")
        .eq("id", pi.product_id!)
        .single();
      if (!prodCheck?.track_stock) continue;

      const { data: variant } = await supabase
        .from("product_variants")
        .select("stock_qty")
        .eq("id", pi.variant_id!)
        .single();
      if (variant) {
        const newQty = variant.stock_qty - pi.qty;
        const { error } = await supabase
          .from("product_variants")
          .update({ stock_qty: newQty, updated_at: now })
          .eq("id", pi.variant_id!);
        if (error) throw error;
        stockChanges.push({ variantId: pi.variant_id!, oldQty: variant.stock_qty });

        await supabase.from("stock_adjustments").insert({
          product_id: pi.product_id!,
          variant_id: pi.variant_id!,
          adjustment_type: "sale",
          qty_before: variant.stock_qty,
          qty_change: -pi.qty,
          qty_after: newQty,
          note: `Sale ${sale.id}`,
          device_id: deviceId,
          related_sale_id: sale.id,
        });
      }
    }
    if (stockChanges.length > 0) {
      rollbacks.push(async () => {
        for (const { variantId, oldQty } of stockChanges) {
          await supabase.from("product_variants").update({ stock_qty: oldQty, updated_at: now }).eq("id", variantId);
        }
        await supabase.from("stock_adjustments").delete().eq("related_sale_id", sale.id);
      });
    }

    // ── 10. Ensure cash register is open (reopens if EOD was already submitted) ──
    await ensureOpenCashRegister();

    return NextResponse.json({ id: sale.id }, { status: 201 });
  } catch (err) {
    // Compensate in reverse order, then delete sale
    console.error("[sales] processSaleItems failed, rolling back:", err);
    for (const undo of rollbacks.reverse()) {
      try { await undo(); } catch (rollbackErr) { console.error("[sales] rollback step failed:", rollbackErr); }
    }
    await supabase.from("sales").delete().eq("id", sale.id);
    throw err;
  }
}

