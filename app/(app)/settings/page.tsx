"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, HelpCircle, LogOut, ScrollText, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useIsAdmin } from "@/contexts/RoleContext";
import { countPendingOps } from "@/lib/offline-ops";
import { getPendingSales } from "@/lib/offline-queue";
import { openDb } from "@/lib/db";
import { StoragePanel } from "@/components/settings/StoragePanel";
import { formatDateTime } from "@/lib/utils";

interface DeviceRow {
  id: string;
  name: string;
  role?: "admin" | "employee";
  is_active: boolean;
  registered_at: string;
  last_seen_at: string | null;
}
interface Me { id: string; name: string; role: "admin" | "employee" }

export default function SettingsPage() {
  const isAdmin = useIsAdmin();
  const [me, setMe] = useState<Me | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [meRes, devRes] = await Promise.all([apiFetch("/api/auth/me"), apiFetch("/api/devices")]);
      if (meRes.ok) setMe(await meRes.json());
      if (devRes.ok) setDevices(await devRes.json());
      else setError("No se pudo cargar la lista de dispositivos.");
    } catch {
      setError("Sin conexión: esta pantalla necesita internet.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function patchDevice(id: string, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(id);
    try {
      const res = await apiFetch("/api/devices", { method: "PATCH", body: JSON.stringify({ id, ...body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(json.error ?? "No se pudo actualizar el dispositivo.");
      else { toast.success("Dispositivo actualizado."); await load(); }
    } finally {
      setBusy(null);
    }
  }

  async function downloadBackup() {
    setBusy("backup");
    try {
      const res = await apiFetch("/api/backup");
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({}))).error ?? "No se pudo generar el respaldo.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `puntobase-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Respaldo descargado. Guárdalo en un lugar seguro: contiene los datos del negocio.");
    } catch {
      toast.error("Sin conexión: no se pudo descargar el respaldo.");
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    let pending = 0;
    try { pending = (await countPendingOps()) + (await getPendingSales()).length; } catch { /* sin IndexedDB */ }
    const msg = pending > 0
      ? `Hay ${pending} operación(es) sin sincronizar en este dispositivo. Si cierras sesión se BORRARÁN. Conéctate y espera a que se sincronicen antes de salir.\n\n¿Cerrar sesión y borrar de todos modos?`
      : "¿Cerrar sesión en este dispositivo? Se borrarán los datos guardados localmente y habrá que registrarlo de nuevo con el código de acceso.";
    if (!window.confirm(msg)) return;
    setBusy("logout");
    try {
      const res = await apiFetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({}))).error ?? "No se pudo cerrar la sesión.");
        return;
      }
      try {
        const db = await openDb();
        await Promise.all(db.tables.map((t) => t.clear()));
        if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      } catch { /* mejor esfuerzo */ }
      window.location.href = "/setup";
    } catch {
      toast.error("Sin conexión: no se pudo cerrar la sesión en el servidor. Inténtalo con internet.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <h1 className="font-bold text-2xl tracking-tight">Ajustes</h1>

      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <Smartphone size={20} className="text-muted-foreground" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{me?.name ?? "Este dispositivo"}</p>
            <p className="text-xs text-muted-foreground">Rol en este dispositivo</p>
          </div>
          <Badge variant={isAdmin ? "default" : "secondary"}>{isAdmin ? "Administrador" : "Empleado"}</Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Link href="/ayuda" className="bg-card border rounded-xl p-3 flex items-center gap-2 text-sm font-medium hover:bg-muted/50">
          <HelpCircle size={18} aria-hidden /> Ayuda
        </Link>
        {isAdmin && (
          <Link href="/audit" className="bg-card border rounded-xl p-3 flex items-center gap-2 text-sm font-medium hover:bg-muted/50">
            <ScrollText size={18} aria-hidden /> Bitácora
          </Link>
        )}
      </div>

      <StoragePanel />

      {isAdmin && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5"><ShieldCheck size={15} aria-hidden /> Dispositivos y roles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              {!devices && !error && (
                <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Cargando dispositivos">
                  {[0, 1].map((i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}
                </div>
              )}
              {devices?.length === 0 && <p className="text-sm text-muted-foreground">No hay dispositivos registrados.</p>}
              {devices?.map((d) => {
                const role = d.role ?? "admin";
                const isMe = d.id === me?.id;
                return (
                  <div key={d.id} className={`border rounded-lg p-2.5 space-y-2 ${d.is_active ? "" : "opacity-60"}`}>
                    <div className="flex items-center gap-2">
                      <p className="flex-1 min-w-0 text-sm font-medium truncate">{d.name}{isMe ? " (este)" : ""}</p>
                      <Badge variant={role === "admin" ? "default" : "secondary"}>{role === "admin" ? "Admin" : "Empleado"}</Badge>
                      {!d.is_active && <Badge variant="outline">Inactivo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Registrado {formatDateTime(d.registered_at)}{d.last_seen_at ? ` · Visto ${formatDateTime(d.last_seen_at)}` : ""}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy === d.id}
                        onClick={() => patchDevice(d.id, { role: role === "admin" ? "employee" : "admin" },
                          role === "admin" ? `¿Quitar permisos de administrador a «${d.name}»?` : `¿Dar permisos de administrador a «${d.name}»? Podrá cambiar precios, cancelar y cerrar caja.`)}>
                        {role === "admin" ? "Hacer empleado" : "Hacer admin"}
                      </Button>
                      <Button size="sm" variant={d.is_active ? "destructive" : "outline"} disabled={busy === d.id || isMe}
                        onClick={() => patchDevice(d.id, { is_active: !d.is_active },
                          d.is_active ? `¿Desactivar «${d.name}»? Perderá el acceso de inmediato.` : undefined)}>
                        {d.is_active ? "Desactivar" : "Reactivar"}
                      </Button>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">Los dispositivos nuevos entran como empleado. Siempre debe quedar al menos un administrador.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Respaldo</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Descarga todos los datos del negocio (ventas, inventario, devoluciones, apartados, bitácora) en un archivo. No incluye
                contraseñas, códigos de acceso ni claves. Hazlo con regularidad; la guía de recuperación está en Ayuda.
              </p>
              <Button className="w-full" variant="outline" disabled={busy === "backup"} onClick={downloadBackup}>
                <Download size={16} className="mr-2" aria-hidden />
                {busy === "backup" ? "Generando…" : "Descargar respaldo"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Button variant="outline" className="w-full" disabled={busy === "logout"} onClick={logout}>
        <LogOut size={16} className="mr-2" aria-hidden /> Cerrar sesión en este dispositivo
      </Button>
    </div>
  );
}
