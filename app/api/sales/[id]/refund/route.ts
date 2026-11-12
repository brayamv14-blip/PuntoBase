import { NextResponse } from "next/server";

// RETIRADA: este flujo no registraba la devolucion en caja ni era idempotente.
// Usa POST /api/returns (ver docs/MANUAL-TECNICO.md). proxy.ts tambien la bloquea con 410.
export async function POST() {
  return NextResponse.json(
    { error: "Esta ruta fue retirada. Usa /api/returns para registrar devoluciones." },
    { status: 410 }
  );
}
