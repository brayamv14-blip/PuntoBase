import { NextResponse, type NextRequest } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { COOKIE_NAME } from "@/lib/auth";
import { isLegacyRefund, normalizeRole, requiresAdmin } from "@/lib/permissions";

/**
 * Control de acceso por rol para TODAS las rutas /api (incluidas las que no se modificaron).
 * Solo consulta la base de datos cuando la ruta exige administrador.
 * Las rutas nuevas ademas validan el rol por su cuenta (defensa en profundidad).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Flujo anterior de devoluciones: sustituido por /api/returns (una sola fuente de verdad
  // para inventario, caja y reportes).
  if (isLegacyRefund(pathname)) {
    return NextResponse.json(
      { error: "Esta ruta fue reemplazada por POST /api/returns." },
      { status: 410 }
    );
  }

  if (!requiresAdmin(method, pathname)) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data, error } = await supabase
      .from("devices")
      .select("id, role")
      .eq("device_token", token)
      .eq("is_active", true)
      .maybeSingle();

    // Un fallo de la base no es "sin sesion": responder 503 evita cerrar la sesion de alguien valido.
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (normalizeRole(data.role) !== "admin") {
      return NextResponse.json(
        { error: "Esta acción requiere permisos de administrador." },
        { status: 403 }
      );
    }
  } catch (error) {
    // Ante un fallo de la base no se concede acceso a una ruta restringida.
    console.error("[proxy] No se pudo verificar el rol:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo verificar el permiso." }, { status: 503 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
