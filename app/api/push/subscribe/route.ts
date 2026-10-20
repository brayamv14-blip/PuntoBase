import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { USER_PUSH_CATEGORIES } from "@/lib/push";

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

// POST /api/push/subscribe  guarda (o actualiza) la suscripcion Web Push de este dispositivo.
// Es idempotente por endpoint: no crea duplicados y conserva las preferencias existentes.
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const endpoint = body?.endpoint;
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;

    if (
      !validEndpoint(endpoint) ||
      typeof p256dh !== "string" ||
      typeof auth !== "string" ||
      p256dh.length < 10 ||
      p256dh.length > 200 ||
      auth.length < 8 ||
      auth.length > 100
    ) {
      return NextResponse.json({ error: "Suscripción inválida" }, { status: 400 });
    }

    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 200) || null;

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        device_id: device.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        failure_count: 0,
        last_error_at: null,
        last_error_status: null,
      },
      { onConflict: "endpoint" }
    );

    if (error) {
      console.error("[push subscribe]", error.message);
      return NextResponse.json({ error: "No se pudo guardar la suscripción" }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH /api/push/subscribe  { endpoint, prefs }  actualiza las preferencias de avisos del dispositivo.
export async function PATCH(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { endpoint, prefs } = await req.json();
    if (!validEndpoint(endpoint) || typeof prefs !== "object" || prefs === null) {
      return NextResponse.json({ error: "endpoint y prefs requeridos" }, { status: 400 });
    }

    const clean: Record<string, boolean> = {};
    for (const key of USER_PUSH_CATEGORIES) {
      if (typeof prefs[key] === "boolean") clean[key] = prefs[key];
    }
    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: "Sin preferencias válidas" }, { status: 400 });
    }

    const { data: current } = await supabase
      .from("push_subscriptions")
      .select("id, prefs")
      .eq("endpoint", endpoint)
      .eq("device_id", device.id)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 });

    const { error } = await supabase
      .from("push_subscriptions")
      .update({ prefs: { ...(current.prefs ?? {}), ...clean } })
      .eq("id", current.id);
    if (error) return NextResponse.json({ error: "No se pudieron guardar las preferencias" }, { status: 500 });
    return NextResponse.json({ ok: true, prefs: { ...(current.prefs ?? {}), ...clean } });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/push/subscribe  { endpoint }  elimina la suscripcion (solo la de este dispositivo).
export async function DELETE(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { endpoint } = await req.json();
    if (typeof endpoint !== "string") {
      return NextResponse.json({ error: "endpoint requerido" }, { status: 400 });
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("device_id", device.id);
    if (error) return NextResponse.json({ error: "No se pudo eliminar la suscripción" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
