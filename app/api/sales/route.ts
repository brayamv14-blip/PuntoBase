import { after, NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import type { CreateSaleRequest, PaymentMethod } from "@/types";
import { ensureOpenCashRegister } from "@/lib/cash-register";
import { notifySaleEvents } from "@/lib/push-events";
import { dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";
import { resolveSaleDate } from "@/lib/sale-date";

type SaleRequestWithClientId = CreateSaleRequest & {
  client_sale_id?: string;
  created_at?: string;
};

// GET /api/sales
export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();

    if (!device) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limit = Math.max(
      1,
      Math.min(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200)
    );
    const offset = Math.max(
      0,
      Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0
    );

    let query = supabase
      .from("sales")
      .select(
        "*, customer:customers(*), device:devices(id,name), items:sale_items(*)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Las transferencias rechazadas no son ventas vigentes (se pueden pedir con ?include_rejected=1).
    if (searchParams.get("include_rejected") !== "1") {
      query = query.neq("payment_status", "rejected");
    }

    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    const { data, error, count } = await query;

    if (error) {
      console.error("[sales GET]", error);
      return NextResponse.json(
        { error: "No se pudieron consultar las ventas." },
        { status: 500 }
      );
    }

    return NextResponse.json({ data, count });
  } catch (error) {
    console.error("[sales GET]", error);
    return NextResponse.json(
      { error: "Error interno del servidor." },
      { status: 500 }
    );
  }
}

// POST /api/sales
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();

    if (!device) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as SaleRequestWithClientId;

    const {
      items,
      customer_id,
      customer_name,
      customer_phone,
      discount_type,
      discount_value = 0,
      payment_method,
      notes,
      client_sale_id,
    } = body;

    // Una venta hecha sin conexion conserva la fecha en que ocurrio (no la de la sincronizacion).
    // Solo se acepta si trae client_sale_id y la fecha es razonable.
    const nowDate = new Date();
    const saleDate = client_sale_id
      ? resolveSaleDate(body.created_at, nowDate)
      : nowDate;
    const isOfflineSync = !!client_sale_id;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    if (!["cash", "bank_transfer"].includes(payment_method)) {
      return NextResponse.json(
        { error: "Método de pago inválido." },
        { status: 400 }
      );
    }

    if (
      client_sale_id !== undefined &&
      (typeof client_sale_id !== "string" ||
        client_sale_id.trim().length === 0 ||
        client_sale_id.length > 200)
    ) {
      return NextResponse.json(
        { error: "Identificador de venta inválido." },
        { status: 400 }
      );
    }

    for (const item of items) {
      if (
        item.item_type !== "product" ||
        !item.product_id ||
        !item.variant_id ||
        !item.description?.trim() ||
        !Number.isFinite(item.unit_price) ||
        item.unit_price < 0 ||
        !Number.isInteger(item.qty) ||
        item.qty <= 0
      ) {
        return NextResponse.json(
          { error: "Hay un artículo inválido en la venta." },
          { status: 400 }
        );
      }
    }

    if (
      !Number.isFinite(discount_value) ||
      discount_value < 0 ||
      (discount_type === "percent" && discount_value > 100) ||
      (discount_type !== undefined &&
        discount_type !== null &&
        discount_type !== "flat" &&
        discount_type !== "percent")
    ) {
      return NextResponse.json(
        { error: "El descuento no es válido." },
        { status: 400 }
      );
    }

    // Si la venta ya se recibió, devolver su ID sin volver a procesarla.
    if (client_sale_id) {
      const { data: existing, error: lookupError } = await supabase
        .from("sales")
        .select("id")
        .eq("client_sale_id", client_sale_id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (existing) {
        return NextResponse.json(
          { id: existing.id, duplicate: true },
          { status: 200 }
        );
      }
    }

    // Resolver cliente.
    let resolvedCustomerId = customer_id ?? null;

    if (!resolvedCustomerId && customer_name?.trim()) {
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .insert({
          name: customer_name.trim(),
          phone: customer_phone?.trim() || null,
        })
        .select("id")
        .single();

      if (customerError) throw customerError;
      resolvedCustomerId = customer.id;
    }

    // Validar productos y variantes.
    // Una venta sincronizada (client_sale_id) ya ocurrio fisicamente: no se rechaza por falta de
    // existencias; se registra, el inventario queda en 0 y se marca para revision.
    for (const item of items) {
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id, track_stock")
        .eq("id", item.product_id!)
        .single();

      if (productError || !product) {
        return NextResponse.json(
          { error: `No se encontró el producto: ${item.description}` },
          { status: 404 }
        );
      }

      const { data: variant, error: variantError } = await supabase
        .from("product_variants")
        .select("id, product_id, stock_qty")
        .eq("id", item.variant_id!)
        .eq("product_id", item.product_id!)
        .single();

      if (variantError || !variant) {
        return NextResponse.json(
          { error: `No se encontró la variante: ${item.description}` },
          { status: 404 }
        );
      }

      if (product.track_stock && variant.stock_qty < item.qty && !isOfflineSync) {
        return NextResponse.json(
          { error: `Existencias insuficientes para ${item.description}` },
          { status: 409 }
        );
      }
    }

    // Calcular importes en el servidor.
    const subtotal = items.reduce(
      (sum, item) => sum + item.unit_price * item.qty,
      0
    );

    const discountAmount =
      discount_type === "flat"
        ? discount_value
        : discount_type === "percent"
          ? (subtotal * discount_value) / 100
          : 0;

    const total = Math.max(0, subtotal - discountAmount);

    const now = saleDate;
    // Folio por dia calendario de la Ciudad de Mexico (no UTC).
    const mxDay = todayDateString(now);
    const today = mxDay.replace(/-/g, "");

    const { count, error: countError } = await supabase
      .from("sales")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayStartISO(mxDay))
      .lte("created_at", dayEndISO(mxDay));

    if (countError) throw countError;

    const salePayload = {
      sale_number: `S-${today}-${String((count ?? 0) + 1).padStart(4, "0")}`,
      client_sale_id: client_sale_id ?? null,
      device_id: device.id,
      customer_id: resolvedCustomerId,
      discount_type: discount_type || null,
      discount_value,
      subtotal,
      total,
      payment_method: payment_method as PaymentMethod,
      payment_status: payment_method === "cash" ? "paid" : "pending",
      paid_at: payment_method === "cash" ? now.toISOString() : null,
      notes: notes?.trim() || null,
      created_at: now.toISOString(),
    };

    // Insertar venta.
    let { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert(salePayload)
      .select("id, payment_method")
      .single();

    // Ante una colisión, primero comprobar si es un reintento de la misma venta.
    if (saleError?.code === "23505" && client_sale_id) {
      const { data: existing, error: lookupError } = await supabase
        .from("sales")
        .select("id")
        .eq("client_sale_id", client_sale_id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (existing) {
        return NextResponse.json(
          { id: existing.id, duplicate: true },
          { status: 200 }
        );
      }
    }

    // Si colisionó el número de venta, intentar con el siguiente número.
    if (saleError?.code === "23505") {
      const retryPayload = {
        ...salePayload,
        sale_number: `S-${today}-${String((count ?? 0) + 2).padStart(4, "0")}`,
      };

      const retry = await supabase
        .from("sales")
        .insert(retryPayload)
        .select("id, payment_method")
        .single();

      sale = retry.data;
      saleError = retry.error;

      if (saleError?.code === "23505" && client_sale_id) {
        const { data: existing, error: lookupError } = await supabase
          .from("sales")
          .select("id")
          .eq("client_sale_id", client_sale_id)
          .maybeSingle();

        if (lookupError) throw lookupError;

        if (existing) {
          return NextResponse.json(
            { id: existing.id, duplicate: true },
            { status: 200 }
          );
        }
      }
    }

    if (saleError || !sale) {
      throw saleError ?? new Error("No se pudo crear la venta.");
    }

    return await processSaleItems(sale, items, device.id, isOfflineSync);
  } catch (error) {
    console.error("[sales POST]", error);
    return NextResponse.json(
      { error: "No se pudo procesar la venta." },
      { status: 500 }
    );
  }
}

async function processSaleItems(
  sale: { id: string; payment_method: string },
  items: CreateSaleRequest["items"],
  deviceId: string,
  allowShortage = false
) {
  const now = new Date().toISOString();

  const insertedVariantChanges: Array<{
    variantId: string;
    oldQty: number;
    newQty: number;
  }> = [];

  const shortages: string[] = [];
  let saleItemsInserted = false;

  try {
    const rows = items.map((item) => ({
      sale_id: sale.id,
      item_type: item.item_type,
      product_id: item.product_id ?? null,
      variant_id: item.variant_id ?? null,
      description: item.description,
      unit_price: item.unit_price,
      qty: item.qty,
      line_total: item.unit_price * item.qty,
    }));

    const { error: itemsError } = await supabase
      .from("sale_items")
      .insert(rows);

    if (itemsError) throw itemsError;
    saleItemsInserted = true;

    for (const item of items) {
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("track_stock")
        .eq("id", item.product_id!)
        .single();

      if (productError) throw productError;
      if (!product?.track_stock) continue;

      const { data: variant, error: variantError } = await supabase
        .from("product_variants")
        .select("stock_qty")
        .eq("id", item.variant_id!)
        .eq("product_id", item.product_id!)
        .single();

      if (variantError || !variant) {
        throw variantError ?? new Error("No se encontró la variante.");
      }

      const short = variant.stock_qty < item.qty;
      if (short && !allowShortage) {
        throw new Error(`Existencias insuficientes para ${item.description}.`);
      }
      if (short) shortages.push(`${item.description}: vendidas ${item.qty}, había ${variant.stock_qty}`);

      const newQty = Math.max(0, variant.stock_qty - item.qty);

      // Actualización condicional para detectar cambios concurrentes.
      const { data: updated, error: updateError } = await supabase
        .from("product_variants")
        .update({ stock_qty: newQty, updated_at: now })
        .eq("id", item.variant_id!)
        .eq("stock_qty", variant.stock_qty)
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        throw new Error(
          `El stock de ${item.description} cambió. Intenta nuevamente.`
        );
      }

      // Guardar inmediatamente el cambio para poder revertirlo si falla algo.
      insertedVariantChanges.push({
        variantId: item.variant_id!,
        oldQty: variant.stock_qty,
        newQty,
      });

      const { error: adjustmentError } = await supabase
        .from("stock_adjustments")
        .insert({
          product_id: item.product_id!,
          variant_id: item.variant_id!,
          adjustment_type: "sale",
          qty_before: variant.stock_qty,
          qty_change: newQty - variant.stock_qty,
          qty_after: newQty,
          note: short ? `Sale ${sale.id} (faltante de inventario al sincronizar)` : `Sale ${sale.id}`,
          device_id: deviceId,
          related_sale_id: sale.id,
        });

      if (adjustmentError) throw adjustmentError;
    }

    await ensureOpenCashRegister();

    let attentionNote: string | null = null;
    if (shortages.length > 0) {
      attentionNote = `Inventario insuficiente al sincronizar (${shortages.length} artículo${shortages.length === 1 ? "" : "s"})`;
      await supabase
        .from("sales")
        .update({ needs_attention: true, attention_note: shortages.join("; ").slice(0, 500) })
        .eq("id", sale.id);
    }

    // Notificaciones push (transferencia pendiente, revision, inventario bajo/agotado).
    after(() => notifySaleEvents(sale.id, insertedVariantChanges, deviceId, attentionNote));

    return NextResponse.json({ id: sale.id }, { status: 201 });
  } catch (error) {
    console.error("[sales] Error procesando artículos; intentando revertir:", error);

    // Revertir únicamente si el stock todavía tiene el valor que dejó esta venta.
    for (const change of [...insertedVariantChanges].reverse()) {
      const { error: rollbackError } = await supabase
        .from("product_variants")
        .update({
          stock_qty: change.oldQty,
          updated_at: new Date().toISOString(),
        })
        .eq("id", change.variantId)
        .eq("stock_qty", change.newQty);

      if (rollbackError) {
        console.error("[sales] Error revirtiendo stock:", rollbackError);
      }
    }

    const { error: adjustmentDeleteError } = await supabase
      .from("stock_adjustments")
      .delete()
      .eq("related_sale_id", sale.id);

    if (adjustmentDeleteError) {
      console.error("[sales] Error eliminando ajustes:", adjustmentDeleteError);
    }

    if (saleItemsInserted) {
      const { error: itemDeleteError } = await supabase
        .from("sale_items")
        .delete()
        .eq("sale_id", sale.id);

      if (itemDeleteError) {
        console.error("[sales] Error eliminando artículos:", itemDeleteError);
      }
    }

    const { error: saleDeleteError } = await supabase
      .from("sales")
      .delete()
      .eq("id", sale.id);

    if (saleDeleteError) {
      console.error("[sales] Error eliminando venta:", saleDeleteError);
    }

    throw error;
  }
}