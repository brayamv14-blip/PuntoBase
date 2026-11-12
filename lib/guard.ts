import { NextResponse } from "next/server";
import { normalizeRole } from "@/lib/permissions";
import type { Device } from "@/types";

/** Respuesta 403 si el dispositivo no es administrador; null si puede continuar. */
export function forbidUnlessAdmin(device: Pick<Device, "role">): NextResponse | null {
  if (normalizeRole(device.role) === "admin") return null;
  return NextResponse.json(
    { error: "Esta acción requiere permisos de administrador." },
    { status: 403 }
  );
}
