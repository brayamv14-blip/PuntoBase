
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Html5Qrcode,
  Html5QrcodeScannerState,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScanLine } from "lucide-react";

interface ScannerButtonProps {
  onScan: (code: string) => void;
  label?: string;
}

export function ScannerButton({
  onScan,
  label = "Escanear",
}: ScannerButtonProps) {
  const [open, setOpen] = useState(false);

  const handleScan = useCallback(
    (code: string) => {
      setOpen(false);
      onScan(code);
    },
    [onScan]
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <ScanLine size={14} />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escanear código</DialogTitle>
          </DialogHeader>

          {open && <ScannerView onScan={handleScan} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScannerView({ onScan }: { onScan: (code: string) => void }) {
  const regionId = "pb-scanner-region";
  const onScanRef = useRef(onScan);
  const doneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let disposed = false;
    let started = false;

    // QR + codigos comerciales (UPC/EAN, Code 128). Si el navegador tiene la API
    // nativa BarcodeDetector, html5-qrcode la usa en lugar del decodificador JS.
    const scanner = new Html5Qrcode(regionId, {
      verbose: false,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
      ],
      useBarCodeDetectorIfSupported: true,
    });

    const startPromise = scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 160 } },
        (text) => {
          if (disposed || doneRef.current) return;

          doneRef.current = true;
          onScanRef.current(text.trim());
        },
        () => {}
      )
      .then(() => {
        started = true;
      })
      .catch((err: unknown) => {
        if (!disposed) {
          console.error("No se pudo iniciar el escáner:", err);
          setError(
            "No se pudo abrir la cámara. Revisa los permisos del navegador."
          );
        }
      });

    return () => {
      disposed = true;

      void startPromise.then(async () => {
        if (!started) return;

        try {
          if (
            scanner.getState() === Html5QrcodeScannerState.SCANNING
          ) {
            await scanner.stop();
          }

          scanner.clear();
        } catch (err) {
          console.error("Error al cerrar el escáner:", err);
        }
      });
    };
  }, []);

  return (
    <div className="space-y-2">
      <div
        id={regionId}
        className="min-h-48 w-full overflow-hidden rounded-lg bg-black"
      />

      {error && <p className="text-sm text-red-500">{error}</p>}

      <p className="text-xs text-muted-foreground">
        Apunta la cámara al código QR o de barras del producto.
      </p>
    </div>
  );
}
