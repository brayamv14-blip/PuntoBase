import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies, deviceCookieOptions } from "@/lib/auth";
import { normalizeRole } from "@/lib/permissions";

// POST /api/auth/logout
// Invalida el acceso de ESTE dispositivo en el servidor (queda inactivo) y borra la cookie.
// El unico administrador activo no puede cerrar sesion: se quedaria sin forma de volver a entrar como administrador.
export async function POST() {
  try {
    const device = await getDeviceFromCookies();
    const opts = deviceCookieOptions();
    const clear = (res: NextResponse) => {
      res.cookies.set(opts.name, "", { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path, maxAge: 0 });
      return res;
    };
    if (!device) return clear(NextResponse.json({ ok: true, success: true }));

    if (normalizeRole(device.role) === "admin") {
      const { data, error } = await supabase.from("devices").select("id, role").eq("is_active", true);
      if (error) throw error;
      const admins = (data ?? []).filter((d: { role?: unknown }) => normalizeRole(d.role) === "admin");
      if (admins.length <= 1) {
        return NextResponse.json(
          { error: "Eres el único administrador. Asigna a otro dispositivo como administrador (Ajustes → Dispositivos) antes de cerrar sesión." },
          { status: 409 }
        );
      }
    }

    const { error: updateError } = await supabase.from("devices").update({ is_active: false }).eq("id", device.id);
    if (updateError) throw updateError;
    return clear(NextResponse.json({ ok: true, success: true }));
  } catch (e) {
    console.error("[logout]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo cerrar la sesión." }, { status: 500 });
  }
}
