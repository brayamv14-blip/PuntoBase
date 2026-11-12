"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useIsAdmin } from "@/contexts/RoleContext";
import { formatDateTime, todayDateString } from "@/lib/utils";

interface AuditRow {
  id: string;
  created_at: string;
  device_name: string | null;
  role: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
}

const LABELS: Record<string, string> = {
  "device.register": "Registró un dispositivo",
  "device.update": "Cambió un dispositivo",
  "sale.create": "Registró una venta",
  "sale.price_override": "Vendió con precio distinto al catálogo",
  "return.create": "Registró una devolución",
  "transfer.confirm": "Confirmó una transferencia",
  "transfer.reject": "Rechazó una transferencia",
  "stock.adjust": "Ajustó inventario",
  "cash.close": "Cerró la caja",
  "layaway.create": "Creó un apartado",
  "layaway.payment": "Registró un abono",
  "layaway.confirm_payment": "Resolvió un abono por transferencia",
  "layaway.deliver": "Entregó un apartado",
  "layaway.cancel": "Canceló un apartado",
  "product.cost": "Cambió el costo de un producto",
  "product.update": "Editó un producto",
  "product.delete": "Dio de baja un producto",
  "variant.update": "Editó una variante (precio o existencias)",
  "variant.delete": "Eliminó una variante",
  "category.update": "Renombró una categoría",
  "category.delete": "Eliminó una categoría",
  "backup.export": "Descargó un respaldo",
  "export.report": "Exportó un reporte",
};
const PAGE = 50;

function summarize(details: AuditRow["details"]): string {
  if (!details) return "";
  return Object.entries(details)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export default function AuditPage() {
  const isAdmin = useIsAdmin();
  const [from, setFrom] = useState(() => todayDateString());
  const [to, setTo] = useState(() => todayDateString());
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from, to, limit: String(PAGE), offset: String(offset) });
      if (action) qs.set("action", action);
      const res = await apiFetch(`/api/audit?${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "No se pudo cargar la bitácora."); return; }
      setCount(json.count ?? 0);
      setRows((prev) => (offset === 0 ? json.data : [...prev, ...json.data]));
    } catch {
      setError("Sin conexión: la bitácora necesita internet.");
    } finally {
      setLoading(false);
    }
  }, [from, to, action]);

  useEffect(() => { if (isAdmin) void load(0); }, [load, isAdmin]);

  if (!isAdmin) {
    return <div className="p-4 max-w-lg mx-auto text-sm text-muted-foreground" role="alert">Solo un administrador puede ver la bitácora.</div>;
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2">
        <Link href="/settings" aria-label="Volver" className="p-1 -ml-1"><ChevronLeft size={22} /></Link>
        <h1 className="font-bold text-2xl tracking-tight">Bitácora</h1>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label htmlFor="a-from" className="text-xs">Desde</Label>
          <Input id="a-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="a-to" className="text-xs">Hasta</Label>
          <Input id="a-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="a-action" className="text-xs">Acción</Label>
        <select id="a-action" value={action} onChange={(e) => setAction(e.target.value)}
          className="w-full h-10 rounded-md border bg-background px-3 text-sm">
          <option value="">Todas</option>
          {Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {error && (
        <div role="alert" className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-sm flex items-center justify-between gap-2">
          <span>{error}</span><Button size="sm" variant="outline" onClick={() => load(0)}>Reintentar</Button>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Cargando bitácora">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No hay movimientos registrados en este periodo.</p>
      )}

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="bg-card border rounded-xl p-3 space-y-1">
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-medium">{LABELS[r.action] ?? r.action}</p>
              <Badge variant={r.role === "admin" ? "default" : "secondary"}>{r.role === "admin" ? "Admin" : "Empleado"}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{r.device_name ?? "Dispositivo desconocido"} · {formatDateTime(r.created_at)}</p>
            {summarize(r.details) && <p className="text-xs text-muted-foreground break-words">{summarize(r.details)}</p>}
          </li>
        ))}
      </ul>

      {rows.length < count && (
        <Button variant="outline" className="w-full" disabled={loading} onClick={() => load(rows.length)}>
          {loading ? "Cargando…" : `Cargar más (${count - rows.length})`}
        </Button>
      )}
    </div>
  );
}
