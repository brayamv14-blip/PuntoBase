import { NextResponse } from "next/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { normalizeRole } from "@/lib/permissions";

export async function GET() {
  const device = await getDeviceFromCookies();
  if (!device) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ id: device.id, name: device.name, role: normalizeRole(device.role) });
}
