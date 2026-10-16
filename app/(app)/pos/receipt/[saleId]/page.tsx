
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { getLocalSale } from "@/lib/local-sales";
import type { Sale, SaleItem, Customer, Device } from "@/types";

type FullSale = Sale & {
  items: SaleItem[];
  customer: Customer | null;
  device: Device | null;
  local_status?: "pending" | "synced";
  server_sale_id?: string | null;
};

export default function ReceiptPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const router = useRouter();

  const [sale, setSale] = useState<FullSale | null>(null);
  const [storeName, setStoreName] = useState("PuntoBase");
  const [loading, setLoading] = useState(true);
  const [isLocal, setIsLocal] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadReceipt() {
      setLoading(true);

      try {
        // Las ventas LOCAL- se buscan primero en IndexedDB.
        if (saleId.startsWith("LOCAL-")) {
          const localSale = await getLocalSale(saleId);

          if (!localSale) {
            if (!cancelled) {
              setSale(null);
              toast.error(
                "No se encontró el recibo local en este dispositivo."
              );
            }
            return;
          }

          if (!cancelled) {
            setSale(localSale as FullSale);
            setIsLocal(true);
          }

          return;
        }

        // Las ventas del servidor conservan su comportamiento habitual.
        const [saleResponse, configResponse] = await Promise.all([
          apiFetch(`/api/sales/${encodeURIComponent(saleId)}`),
          apiFetch("/api/store-config"),
        ]);

        if (!saleResponse.ok) {
          throw new Error("No se pudo cargar la venta.");
        }

        const saleData = await saleResponse.json();

        let configName = "PuntoBase";

        if (configResponse.ok) {
          const config = await configResponse.json();
          configName = config.store_name ?? "PuntoBase";
        }

        if (!cancelled) {
          setSale(saleData as FullSale);
          setStoreName(configName);
          setIsLocal(false);
        }
      } catch {
        if (!cancelled) {
          setSale(null);
          toast.error(
            navigator.onLine
              ? "No se pudo cargar el recibo."
              : "No se pudo cargar el recibo. Comprueba que la venta esté guardada en este dispositivo."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReceipt();

    return () => {
      cancelled = true;
    };
  }, [saleId]);

  async function confirmPayment() {
    if (isLocal || confirmingPayment) return;

    setConfirmingPayment(true);

    try {
      const res = await apiFetch(
        `/api/sales/${encodeURIComponent(saleId)}/confirm-payment`,
        { method: "POST" }
      );

      if (!res.ok) {
        toast.error("No se pudo confirmar el pago.");
        return;
      }

      setSale((current) =>
        current
          ? {
              ...current,
              payment_status: "paid",
              paid_at: new Date().toISOString(),
            }
          : current
      );

      toast.success("Pago confirmado correctamente.");
    } catch {
      toast.error("No hay conexión para confirmar el pago.");
    } finally {
      setConfirmingPayment(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Cargando recibo de venta...
      </div>
    );
  }

  if (!sale) {
    return (
      <div className="max-w-sm mx-auto p-6 space-y-4 text-center">
        <p className="font-semibold">No se pudo mostrar el recibo.</p>
        <p className="text-sm text-muted-foreground">
          Si es una venta offline, debe existir previamente en el
          almacenamiento local de este dispositivo.
        </p>
        <Button className="w-full" onClick={() => router.push("/pos")}>
          Volver al punto de venta
        </Button>
      </div>
    );
  }

  const subtotal = Number(sale.subtotal);

  const discountAmount =
    sale.discount_type === "flat"
      ? Number(sale.discount_value)
      : sale.discount_type === "percent"
        ? (subtotal * Number(sale.discount_value)) / 100
        : 0;

  const pendingSync =
    isLocal && sale.local_status !== "synced";

  return (
    <div className="max-w-sm mx-auto p-4 space-y-4">
      {pendingSync && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            Venta guardada en este dispositivo
          </p>
          <p>
            Está pendiente de sincronización. Conserva este dispositivo
            hasta que la venta se sincronice.
          </p>
        </div>
      )}

      {/* Recibo de venta */}
      <div
        id="receipt-print"
        className="bg-white border rounded-2xl p-5 space-y-3 shadow-sm"
      >
        <div className="text-center space-y-0.5">
          <h2 className="font-bold text-lg">{storeName}</h2>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(sale.created_at)}
          </p>
          <p className="text-xs text-muted-foreground">
            Comprobante de venta
          </p>
        </div>

        <div className="border-t border-dashed pt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Folio de venta</span>
            <span className="font-mono font-bold break-all text-right">
              {sale.sale_number}
            </span>
          </div>

          {sale.device && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                Caja o dispositivo
              </span>
              <span>{sale.device.name}</span>
            </div>
          )}

          {sale.customer && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Cliente</span>
              <span className="text-right">{sale.customer.name}</span>
            </div>
          )}
        </div>

        <div className="border-t border-dashed pt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide">
            Productos y artículos
          </p>

          {sale.items?.map((item) => (
            <div key={item.id}>
              <p className="text-sm font-medium">{item.description}</p>

              <div className="flex justify-between gap-3 text-sm text-muted-foreground">
                <span>
                  {item.qty} ×{" "}
                  {formatCurrency(Number(item.unit_price))}
                </span>
                <span className="font-medium text-foreground">
                  {formatCurrency(Number(item.line_total))}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed pt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>

          {discountAmount > 0 && (
            <div className="flex justify-between gap-3 text-red-500">
              <span>
                Descuento
                {sale.discount_type === "percent"
                  ? ` (${sale.discount_value}%)`
                  : ""}
              </span>
              <span>−{formatCurrency(discountAmount)}</span>
            </div>
          )}

          <div className="flex justify-between gap-3 font-bold text-base border-t pt-2">
            <span>Total a pagar</span>
            <span>{formatCurrency(Number(sale.total))}</span>
          </div>

          {sale.payment_status === "pending" && (
            <div className="flex justify-between gap-3 text-amber-600 font-medium pt-1">
              <span>Estado del pago</span>
              <span>Pendiente</span>
            </div>
          )}

          <div className="flex justify-between items-center gap-3 text-muted-foreground pt-1">
            <span>Forma de pago</span>
            <Badge variant="outline" className="font-normal">
              {sale.payment_method === "cash"
                ? "💵 Efectivo"
                : "🏦 Transferencia"}
            </Badge>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground border-t border-dashed pt-3">
          ¡Gracias por tu compra! 🐟
        </p>
      </div>

      {/* Acciones del recibo */}
      <div className="flex gap-2">
        {!isLocal && (
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              window.open(
                `/api/sales/${encodeURIComponent(saleId)}/pdf`,
                "_blank"
              );
            }}
          >
            Descargar PDF
          </Button>
        )}

        <Button
          variant="outline"
          className="flex-1"
          onClick={() => window.print()}
        >
          Imprimir ticket
        </Button>
      </div>

      {!isLocal && sale.payment_status === "pending" && (
        <Button
          className="w-full bg-green-600 hover:bg-green-700"
          onClick={confirmPayment}
          disabled={confirmingPayment}
        >
          {confirmingPayment ? "Confirmando..." : "Confirmar pago"}
        </Button>
      )}

      <Button className="w-full" onClick={() => router.push("/pos")}>
        Registrar nueva venta
      </Button>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }

          #receipt-print,
          #receipt-print * {
            visibility: visible;
          }

          #receipt-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 80mm;
            max-width: 100%;
            box-shadow: none;
          }

          @page {
            size: 80mm auto;
            margin: 0;
          }
        }
      `}</style>
    </div>
  );
}
