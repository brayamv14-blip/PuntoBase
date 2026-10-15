"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Sale, SaleItem, Customer, Device } from "@/types";

type FullSale = Sale & {
  items: SaleItem[];
  customer: Customer | null;
  device: Device | null;
};

export default function ReceiptPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const router = useRouter();

  const [sale, setSale] = useState<FullSale | null>(null);
  const [storeName, setStoreName] = useState("PuntoBase");

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/sales/${saleId}`).then((res) => res.json()),
      apiFetch("/api/store-config").then((res) => res.json()),
    ]).then(([saleData, config]) => {
      setSale(saleData);
      setStoreName(config.store_name ?? "PuntoBase");
    });
  }, [saleId]);

  async function confirmPayment() {
    const res = await apiFetch(
      `/api/sales/${saleId}/confirm-payment`,
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
  }

  if (!sale) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Cargando recibo de venta...
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

  return (
    <div className="max-w-sm mx-auto p-4 space-y-4">
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
            <span className="text-muted-foreground">
              Folio de venta
            </span>
            <span className="font-mono font-bold">
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
              <span className="text-muted-foreground">
                Cliente
              </span>
              <span className="text-right">
                {sale.customer.name}
              </span>
            </div>
          )}
        </div>

        <div className="border-t border-dashed pt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide">
            Productos y artículos
          </p>

          {sale.items?.map((item) => (
            <div key={item.id}>
              <p className="text-sm font-medium">
                {item.description}
              </p>

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
            <span className="text-muted-foreground">
              Subtotal
            </span>
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

              <span>
                −{formatCurrency(discountAmount)}
              </span>
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
        <Button
          variant="outline"
          className="flex-1"
          onClick={() =>
            window.open(
              `/api/sales/${saleId}/pdf`,
              "_blank"
            )
          }
        >
          Descargar PDF
        </Button>

        <Button
          variant="outline"
          className="flex-1"
          onClick={() => window.print()}
        >
          Imprimir ticket
        </Button>
      </div>

      {sale.payment_status === "pending" && (
        <Button
          className="w-full bg-green-600 hover:bg-green-700"
          onClick={confirmPayment}
        >
          Confirmar pago
        </Button>
      )}

      <Button
        className="w-full"
        onClick={() => router.push("/pos")}
      >
        Registrar nueva venta
      </Button>

      <style>{`
        @media print {
          body > * { display: none !important; }
          #receipt-print { display: block !important; }
          @page { size: 80mm auto; margin: 0; }
        }
      `}</style>
    </div>
  );
}
