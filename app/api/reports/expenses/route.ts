import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { dayEndISO, dayStartISO, todayDateString } from "@/lib/utils";

export async function GET(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") ?? todayDateString();
    const to = searchParams.get("to") ?? from;

    const { data, error } = await supabase
      .from("expenses")
      .select("*, device:devices(id,name)")
      .gte("created_at", dayStartISO(from))
      .lte("created_at", dayEndISO(to))
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const total = (data as { amount: number }[] | null)?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;
    return NextResponse.json({ from, to, total, items: data });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
