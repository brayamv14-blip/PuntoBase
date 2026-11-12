import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";
import { dayEndISO, dayStartISO } from "@/lib/utils";

// GET /api/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&action=...&limit=100&offset=0   (solo administrador)
export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(Number.parseInt(searchParams.get("limit") ?? "100", 10) || 100, 500));
    const offset = Math.max(0, Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0);

    let q = supabase
      .from("audit_log")
      .select("id, created_at, device_name, role, action, entity, entity_id, details", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const action = searchParams.get("action");
    if (from) q = q.gte("created_at", dayStartISO(from));
    if (to) q = q.lte("created_at", dayEndISO(to));
    if (action) q = q.eq("action", action);

    const { data, error, count } = await q;
    if (error) {
      console.error("[audit GET]", error.message);
      return NextResponse.json({ error: "No se pudo consultar la bitácora." }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [], count });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
