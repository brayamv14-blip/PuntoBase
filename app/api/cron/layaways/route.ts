import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { notifyLayawaysDue } from "@/lib/layaway-reminders";

export const dynamic = "force-dynamic";

function validSecret(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// GET /api/cron/layaways
// Tarea diaria (Vercel Cron manda "Authorization: Bearer $CRON_SECRET"). Solo AVISA de apartados
// vencidos o por vencer; la liberacion del inventario sigue siendo una decision del administrador.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "CRON_SECRET no está configurado (mínimo 16 caracteres)." }, { status: 503 });
  }
  if (!validSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await notifyLayawaysDue();
    return NextResponse.json({
      today: result.today,
      overdue: result.overdue,
      dueSoon: result.dueSoon,
      sent: result.sent,
      skippedDuplicate: result.push?.skippedDuplicate ?? false,
      pushConfigured: result.push?.configured ?? null,
    });
  } catch (e) {
    console.error("[cron/layaways]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo revisar los apartados." }, { status: 500 });
  }
}
