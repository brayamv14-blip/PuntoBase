import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { normalizeRole } from "@/lib/permissions";

export async function GET() {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let { data, error } = await supabase
      .from("devices")
      .select("id, name, role, is_active, registered_at, last_seen_at")
      .order("registered_at", { ascending: false });

    // Base sin migracion 6: sin columna role.
    if (error && /role/i.test(error.message ?? "")) {
      ({ data, error } = await supabase
        .from("devices")
        .select("id, name, is_active, registered_at, last_seen_at")
        .order("registered_at", { ascending: false }));
    }

    if (error) {
      console.error("[devices GET]", error.message);
      return NextResponse.json({ error: "No se pudieron consultar los dispositivos." }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH /api/devices  { id, role?, is_active?, name? }   (solo administrador)
export async function PATCH(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const body = await req.json().catch(() => ({}));
    const { id } = body ?? {};
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.role !== undefined) {
      if (body.role !== "admin" && body.role !== "employee") {
        return NextResponse.json({ error: "Rol inválido." }, { status: 400 });
      }
      updates.role = body.role;
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json({ error: "is_active inválido." }, { status: 400 });
      }
      updates.is_active = body.is_active;
    }
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 80) {
        return NextResponse.json({ error: "Nombre inválido." }, { status: 400 });
      }
      updates.name = name;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
    }

    const { data: target, error: targetError } = await supabase
      .from("devices")
      .select("id, name, role, is_active")
      .eq("id", id)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: "Dispositivo no encontrado." }, { status: 404 });

    // Nunca dejar la tienda sin un administrador activo.
    const losesAdmin =
      normalizeRole(target.role) === "admin" &&
      target.is_active &&
      (updates.role === "employee" || updates.is_active === false);
    if (losesAdmin) {
      const { data: admins, error: adminsError } = await supabase
        .from("devices")
        .select("id, role")
        .eq("is_active", true);
      if (adminsError) throw adminsError;
      const activeAdmins = (admins ?? []).filter((d: { role?: unknown }) => normalizeRole(d.role) === "admin");
      if (activeAdmins.length <= 1) {
        return NextResponse.json(
          { error: "Debe quedar al menos un administrador activo." },
          { status: 409 }
        );
      }
    }

    const { error } = await supabase.from("devices").update(updates).eq("id", id);
    if (error) throw error;

    await audit(device, "device.update", "device", id, { from: { role: target.role, is_active: target.is_active, name: target.name }, to: updates });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[devices PATCH]", error);
    return NextResponse.json({ error: "No se pudo actualizar el dispositivo." }, { status: 500 });
  }
}
