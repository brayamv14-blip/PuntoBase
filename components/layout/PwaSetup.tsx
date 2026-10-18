"use client";
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { toast } from "sonner";

/** Evento no estandar de Chrome/Edge/Android que permite mostrar nuestro boton de instalar. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "puntobase-install-dismissed";

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // almacenamiento bloqueado: simplemente no se recuerda
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Instalacion y almacenamiento de la PWA:
 *  - Boton "Instalar" (Chrome/Edge/Android) o instrucciones manuales en iOS/Safari.
 *  - Pide almacenamiento persistente para que el navegador no borre la base local
 *    (limitante 4 y 5 del MVP) y avisa si queda poco espacio.
 */
export function PwaSetup() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (safeGet(DISMISS_KEY) === "1") return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setShowIosHint(false);
      toast.success("PuntoBase instalada en tu dispositivo.");
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (isIos()) setShowIosHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    const storage = navigator.storage;
    if (!storage) return;

    void (async () => {
      try {
        if (storage.persist && !(await storage.persisted?.())) {
          await storage.persist();
        }
        const { usage, quota } = (await storage.estimate?.()) ?? {};
        if (usage && quota && usage / quota > 0.8) {
          toast.warning(
            "El almacenamiento del dispositivo está casi lleno. Sincroniza y libera espacio para seguir trabajando sin conexión."
          );
        }
      } catch {
        // API no disponible: la app sigue funcionando
      }
    })();
  }, []);

  function dismiss() {
    safeSet(DISMISS_KEY, "1");
    setInstallEvent(null);
    setShowIosHint(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === "dismissed") safeSet(DISMISS_KEY, "1");
  }

  if (!installEvent && !showIosHint) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 z-40 mx-auto max-w-md rounded-2xl border bg-background p-3 shadow-lg flex items-center gap-3">
      {installEvent ? (
        <>
          <Download className="shrink-0 text-primary" size={22} />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Instala PuntoBase</p>
            <p className="text-muted-foreground text-xs">Úsala como app y trabaja sin internet.</p>
          </div>
          <button
            type="button"
            onClick={() => void install()}
            className="rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
          >
            Instalar
          </button>
        </>
      ) : (
        <>
          <Share className="shrink-0 text-primary" size={22} />
          <p className="flex-1 text-xs">
            Para instalar: toca <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>.
          </p>
        </>
      )}
      <button type="button" onClick={dismiss} aria-label="Cerrar" className="text-muted-foreground">
        <X size={18} />
      </button>
    </div>
  );
}
