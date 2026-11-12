/**
 * Roles y permisos. Funciones puras: las usan el proxy (todas las rutas /api, incluso las
 * que no se modificaron), las rutas nuevas y la interfaz.
 *
 *  - admin: todo.
 *  - employee: vender, apartar, abonar, consultar, dar de alta productos y ajustar inventario
 *    (todo queda en la bitacora). No puede editar/eliminar productos ni precios, cerrar caja,
 *    rechazar transferencias, cancelar apartados, ver analisis/auditoria ni exportar/respaldar.
 */
export type Role = "admin" | "employee";

export function normalizeRole(value: unknown): Role {
  // Sin columna (migracion 6 pendiente) o valor desconocido: se conserva el comportamiento anterior.
  return value === "employee" ? "employee" : "admin";
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Rutas HTTP que solo puede usar un administrador. */
export function requiresAdmin(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  const p = pathname.replace(/\/+$/, "");

  // Productos: editar/eliminar el producto, sus variantes (precios) y los costos.
  if (/^\/api\/products\/(?!image$)[^/]+(\/.*)?$/.test(p) && MUTATING.has(m)) return true;
  if (p === "/api/products/cost") return true;
  // Categorias
  if (/^\/api\/categories\/[^/]+$/.test(p) && (m === "PUT" || m === "PATCH" || m === "DELETE")) return true;
  // Caja
  if (p === "/api/cash-register/close" && m === "POST") return true;
  // Equipo, configuracion, respaldo, auditoria y analisis
  if (p === "/api/devices" && MUTATING.has(m)) return true;
  if (p === "/api/store-config" && MUTATING.has(m)) return true;
  if (p === "/api/backup" || p === "/api/audit") return true;
  if (p === "/api/reports/analytics" || p === "/api/reports/export") return true;
  // Apartados: cancelar / liberar
  if (p === "/api/layaways/cancel" && m === "POST") return true;
  return false;
}

/** Devoluciones: el administrador siempre; un empleado solo ventas del mismo dia de negocio. */
export function canReturn(role: Role, saleDay: string, today: string): boolean {
  return role === "admin" || saleDay === today;
}

/** El flujo anterior de devoluciones se retira: ahora existe /api/returns. */
export function isLegacyRefund(pathname: string): boolean {
  return /^\/api\/sales\/[^/]+\/refund\/?$/.test(pathname);
}
