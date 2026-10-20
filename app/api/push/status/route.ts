import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { DEFAULT_PUSH_PREFS, getVapidStatus } from "@/lib/push";

// POST /api/push/status  { endpoint? }  diagnostico del modulo (sin exponer llaves ni endpoints)
export async function POST(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("device_id, endpoint, prefs, failure_count, last_success_at, last_error_at, last_error_status");
    if (error) {
      return NextResponse.json({ error: "No se pudo consultar el estado" }, { status: 500 });
    }

    type Row = {
      device_id: string | null;
      endpoint: string;
      prefs: Record<string, boolean> | null;
      failure_count: number | null;
      last_success_at: string | null;
      last_error_at: string | null;
      last_error_status: number | null;
    };
    const rows = (data ?? []) as Row[];
    const mine = rows.filter((r) => r.device_id === device.id);
    const current = endpoint ? rows.find((r) => r.endpoint === endpoint && r.device_id === device.id) : undefined;

    return NextResponse.json({
      vapid: getVapidStatus(),
      subscriptions: { total: rows.length, thisDevice: mine.length },
      registered: !!current,
      prefs: current ? { ...DEFAULT_PUSH_PREFS, ...(current.prefs ?? {}) } : null,
      health: current
        ? {
            failureCount: current.failure_count ?? 0,
            lastSuccessAt: current.last_success_at,
            lastErrorAt: current.last_error_at,
            lastErrorStatus: current.last_error_status,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
