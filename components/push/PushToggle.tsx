"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function PushToggle() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const ok =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!ok) {
        setSupported(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setSubscribed(subscription !== null);
      } catch {
        // sin Service Worker activo (modo desarrollo)
      }
      setPermission(Notification.permission);
      setSupported(true);
    })();
  }, []);

  async function enable() {
    if (!PUBLIC_KEY) return;
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        toast.error("No se concedió el permiso de notificaciones.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY) as BufferSource,
      });

      const res = await apiFetch("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error("No se pudo guardar la suscripción");

      setSubscribed(true);
      toast.success("Notificaciones activadas.");
    } catch {
      toast.error("No se pudieron activar las notificaciones.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await apiFetch("/api/push/subscribe", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notificaciones desactivadas.");
    } catch {
      toast.error("No se pudieron desactivar las notificaciones.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    const res = await apiFetch("/api/push/test", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) toast.error(json.error ?? "No se pudo enviar la prueba.");
    else if (json.sent === 0) toast.error("Ningún dispositivo suscrito recibió la prueba.");
    else toast.success("Prueba enviada.");
  }

  if (supported === null) return null;

  let message = "Avisos de inventario bajo, agotados y transferencias por confirmar.";
  if (!supported) {
    message =
      "Este navegador no admite notificaciones. En iPhone/iPad instala la app en la pantalla de inicio (iOS 16.4 o superior).";
  } else if (!PUBLIC_KEY) {
    message = "Faltan las llaves VAPID en el servidor para activar las notificaciones.";
  } else if (permission === "denied") {
    message = "Las notificaciones están bloqueadas. Actívalas en los permisos del navegador.";
  }

  const canUse = supported && !!PUBLIC_KEY && permission !== "denied";

  return (
    <Card>
      <CardContent className="px-3 py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm flex items-center gap-1.5">
            {subscribed ? <Bell size={15} className="text-primary" /> : <BellOff size={15} />}
            Notificaciones push
          </p>
          {canUse && (
            <div className="flex gap-2">
              {subscribed && (
                <Button size="sm" variant="ghost" onClick={() => void sendTest()}>
                  Probar
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void (subscribed ? disable() : enable())}
              >
                {subscribed ? "Desactivar" : "Activar"}
              </Button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
