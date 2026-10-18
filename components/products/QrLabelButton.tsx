"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Codigo propio para productos sin codigo de fabrica: PB-XXXXXXXX. */
export function generateProductCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "PB-" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface QrLabelButtonProps {
  code: string;
  name: string;
  onGenerate: (code: string) => void;
}

/** Genera el QR del producto y permite imprimir la etiqueta. */
export function QrLabelButton({ code, name, onGenerate }: QrLabelButtonProps) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !code) return;
    let cancelled = false;
    void QRCode.toDataURL(code, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then(
      (url) => {
        if (!cancelled) setDataUrl(url);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [open, code]);

  function handleClick() {
    if (!code) onGenerate(generateProductCode());
    setOpen(true);
  }

  function print() {
    if (!dataUrl) return;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) return;
    doc.open();
    doc.write(
      `<html><body style="font-family:sans-serif;text-align:center;margin:8px">` +
        `<div style="width:220px;border:1px dashed #999;padding:8px;display:inline-block">` +
        `<div style="font-weight:bold;font-size:14px">${escapeHtml(name || "Producto")}</div>` +
        `<img src="${dataUrl}" style="width:180px;height:180px"/>` +
        `<div style="font-size:12px;letter-spacing:1px">${escapeHtml(code)}</div></div></body></html>`
    );
    doc.close();

    frame.onload = () => {
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    };
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleClick}>
        <QrCode size={14} />
        {code ? "Etiqueta QR" : "Generar QR"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Etiqueta QR del producto</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col items-center gap-2">
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt={`QR ${code}`} className="h-48 w-48" />
            ) : (
              <p className="text-sm text-muted-foreground">Generando…</p>
            )}
            <p className="font-medium text-sm">{name || "Producto"}</p>
            <p className="text-xs text-muted-foreground tracking-wider">{code}</p>
            <p className="text-xs text-muted-foreground text-center">
              Guarda el producto para conservar este código. Imprime la etiqueta y pégala en el
              artículo: al escanearla en el POS se agrega al carrito.
            </p>
            <Button type="button" size="sm" onClick={print} disabled={!dataUrl}>
              Imprimir etiqueta
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
