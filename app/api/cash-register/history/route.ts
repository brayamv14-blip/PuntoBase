import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") ?? "30", 10) || 30, 200));
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

    const { data, error, count } = await supabase
      .from("cash_register")
      .select("*, closed_by:devices(id,name)", { count: "exact" })
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, count });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
