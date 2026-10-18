import { NextResponse } from "next/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { isPushConfigured, sendPushToAll } from "@/lib/push";

// POST /api/push/test  envia una notificacion de prueba a los dispositivos suscritos
export async function POST() {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Faltan las llaves VAPID en el servidor." }, { status: 501 });
  }

  const sent = await sendPushToAll({
    title: "PuntoBase",
    body: "Las notificaciones están activas ✓",
    url: "/dashboard",
    tag: "test",
  });
  return NextResponse.json({ sent });
}
