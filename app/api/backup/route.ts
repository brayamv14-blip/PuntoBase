import { after, NextResponse } from "next/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { forbidUnlessAdmin } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { buildBackup } from "@/lib/backup";
import { todayDateString } from "@/lib/utils";

// GET /api/backup  -> descarga un JSON con todos los datos de negocio (sin secretos). Solo administrador.
export async function GET() {
  try {
    const device = await getDeviceFromCookies();
    if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const forbidden = forbidUnlessAdmin(device);
    if (forbidden) return forbidden;

    const backup = await buildBackup();
    after(() => audit(device, "backup.export", "backup", null, { counts: backup.counts, skipped: backup.skipped }));
    return new NextResponse(JSON.stringify(backup), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="puntobase-respaldo-${todayDateString()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[backup]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo generar el respaldo." }, { status: 500 });
  }
}
