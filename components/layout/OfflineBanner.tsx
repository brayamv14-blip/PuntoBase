"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { flushQueue, getPendingSales } from "@/lib/offline-queue";
import { countPendingOps } from "@/lib/offline-ops";
import { SYNC_DONE_MESSAGE } from "@/lib/background-sync";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    try {
      const [sales, ops] = await Promise.all([getPendingSales(), countPendingOps()]);
      setPending(sales.length + ops);
    } catch {
      // IndexedDB no disponible: no se muestra el contador
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    let failed = 0;
    try {
      await flushQueue(
        () => {},
        () => {
          failed++;
        }
      );
      if (failed > 0) toast.error("Algunas operaciones no se pudieron sincronizar.");
      else toast.success("Sincronización completada.");
    } finally {
      setSyncing(false);
      void refreshPending();
    }
  }, [syncing, refreshPending]);

  useEffect(() => {
    setOffline(!navigator.onLine);
    void refreshPending();

    const on = () => {
      setOffline(false);
      void syncNow();
    };
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    // Mensaje del Service Worker al terminar la Background Sync.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === SYNC_DONE_MESSAGE) {
        if (event.data.failures > 0) toast.error("La sincronización en segundo plano quedó incompleta.");
        else if (event.data.synced > 0) toast.success("Sincronizado en segundo plano.");
        void refreshPending();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    const timer = window.setInterval(() => void refreshPending(), 5000);

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (offline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-400 text-yellow-900 text-center text-xs font-semibold py-1 px-2">
        Sin conexión — todo se guarda en el dispositivo y se sincroniza al reconectar
        {pending > 0 ? ` (${pending} pendiente${pending === 1 ? "" : "s"})` : ""}.
      </div>
    );
  }

  if (pending > 0) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white text-center text-xs font-semibold py-1 px-2 flex items-center justify-center gap-2">
        {pending} operación{pending === 1 ? "" : "es"} pendiente{pending === 1 ? "" : "s"} de sincronizar
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={syncing}
          className="underline underline-offset-2 disabled:opacity-60"
        >
          {syncing ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      </div>
    );
  }

  return null;
}
