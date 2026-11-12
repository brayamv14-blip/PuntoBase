import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";

export async function GET() {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("store_config")
    .select("store_name, setup_complete, updated_at")
    .eq("id", 1)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const { store_name, new_access_code } = await req.json();
    if (typeof new_access_code === "string" && new_access_code.trim() && new_access_code.trim().length < 6) {
      return NextResponse.json({ error: "El código de acceso debe tener al menos 6 caracteres." }, { status: 400 });
    }
    const updates: Record<string, string> = { updated_at: new Date().toISOString() };
    if (store_name?.trim()) updates.store_name = store_name.trim();
    if (new_access_code?.trim()) updates.access_code = await bcrypt.hash(new_access_code.trim(), 10);

    const { data, error } = await supabase
      .from("store_config")
      .update(updates)
      .eq("id", 1)
      .select("store_name, updated_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
