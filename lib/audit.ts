import { supabase } from "@/lib/supabase/server";
import { normalizeRole } from "@/lib/permissions";
import type { Device } from "@/types";

export type AuditAction =
  | "device.register"
  | "device.update"
  | "sale.create"
  | "sale.price_override"
  | "return.create"
  | "transfer.confirm"
  | "transfer.reject"
  | "stock.adjust"
  | "cash.close"
  | "layaway.create"
  | "layaway.payment"
  | "layaway.confirm_payment"
  | "layaway.deliver"
  | "layaway.cancel"
  | "product.cost"
  | "product.update"
  | "product.delete"
  | "variant.update"
  | "variant.delete"
  | "category.update"
  | "category.delete"
  | "backup.export"
  | "export.report";

/** Registra quien hizo que. Nunca lanza errores ni bloquea la operacion principal. */
export async function audit(
  device: Pick<Device, "id" | "name"> & { role?: unknown },
  action: AuditAction,
  entity: string | null,
  entityId: string | null,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      device_id: device.id,
      device_name: device.name,
      role: normalizeRole(device.role),
      action,
      entity,
      entity_id: entityId,
      details: details ?? null,
    });
    if (error) console.error("[audit] No se pudo registrar:", error.message);
  } catch (error) {
    console.error("[audit] Error inesperado:", error instanceof Error ? error.message : error);
  }
}
