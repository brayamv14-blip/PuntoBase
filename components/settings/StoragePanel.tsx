"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, Download, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clearBrowserCaches, exportPendingData, getLocalStats, type LocalStorageStats } from "@/lib/local-export";
import { flushQueue, getFailedItems } from "@/lib/offline-queue";
import type { FailedOp } from "@/lib/offline-ops";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Estado del almacenamiento local y de la sincronizacion de ESTE dispositivo. */
export function StoragePanel() {
  const [stats, setStats] = useState<LocalStorageStats | null>(null);
  const [failed, setFailed] = useState<FailedOp[]>([]);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStats(await getLocalStats());
      setFailed(await getFailedItems());
    } catch {
      setStats(null);
    }
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) setQuota({ usage: est.usage ?? 0, quota: est.quota });
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch {
      // API no disponible
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow() {
    if (!navigator.onLine) return toast.error("Sin conexión: se sincronizará al reconectar.");
    setBusy(true);
    try {
      await flushQueue(() => {}, () => {}, { force: true });
      toast.success("Sincronización intentada.");
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function exportPending() {
    const data = await exportPendingData();
    if (data.counts.pendingSales + data.counts.pendingOps === 0) return toast.info("No hay nada pendiente por respaldar.");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `puntobase-pendientes-${data.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function clearCaches() {
    if (!window.confirm("Se borran las pantallas y fotos guardadas (se vuelven a bajar con internet). Tus ventas pendientes NO se borran. ¿Continuar?")) return;
    const n = await clearBrowserCaches();
    toast.success(`Caché limpiada (${n}).`);
    void load();
  }

  const pending = (stats?.pendingSales ?? 0) + (stats?.pendingOps ?? 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5"><Database size={15} aria-hidden /> Almacenamiento y sincronización</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {stats ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Productos locales</dt><dd className="text-right font-medium">{stats.products}</dd>
            <dt className="text-muted-foreground">Ventas en este equipo</dt><dd className="text-right font-medium">{stats.localSales}</dd>
            <dt className="text-muted-foreground">Pendientes de sincronizar</dt><dd className="text-right font-medium">{pending}</dd>
            <dt className="text-muted-foreground">Con error</dt><dd className="text-right font-medium">{failed.length}</dd>
            {quota && (<><dt className="text-muted-foreground">Espacio usado</dt><dd className="text-right font-medium">{mb(quota.usage)} de {mb(quota.quota)}</dd></>)}
            {persisted !== null && (<><dt className="text-muted-foreground">Almacenamiento protegido</dt><dd className="text-right font-medium">{persisted ? "Sí" : "No (el navegador podría borrarlo)"}</dd></>)}
          </dl>
        ) : (
          <p className="text-muted-foreground">No se pudo leer el almacenamiento local de este navegador.</p>
        )}

        {failed.length > 0 && (
          <ul className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs space-y-1" aria-label="Operaciones con error">
            {failed.slice(0, 5).map((f) => (<li key={f.id}>• {f.message}</li>))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => void syncNow()}><RefreshCw size={14} aria-hidden /> Sincronizar ahora</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void exportPending()}><Download size={14} aria-hidden /> Descargar pendientes</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void clearCaches()}><Trash2 size={14} aria-hidden /> Limpiar caché</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Si vas a cambiar o formatear este teléfono con pendientes, descarga el archivo primero y pásalo a un administrador.
        </p>
      </CardContent>
    </Card>
  );
}
