"use client";

import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { LocalSale } from "@/lib/local-sales";

/** Comprobante de una venta guardada en este dispositivo (funciona sin conexion). */
export function LocalReceipt({ sale }: { sale: LocalSale }) {
  return (
    <div className="space-y-3 text-sm">
      {sale.local_status === "pending" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          Pendiente de sincronizar: la venta está guardada en este dispositivo.
        </div>
      )}
      {sale.local_status === "failed" && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs">
          El servidor no aceptó esta venta y fue descartada de la cola.
        </div>
      )}
      {sale.local_status === "synced" && (
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 p-2 text-xs">
          Venta sincronizada correctamente.
        </div>
      )}

      <div className="space-y-1">
        <p>
          <span className="font-medium">Folio: </span>
          {sale.sale_number}
        </p>
        <p>
          <span className="font-medium">Fecha: </span>
          {formatDateTime(sale.created_at)}
        </p>
        {sale.customer && (
          <p>
            <span className="font-medium">Cliente: </span>
            {sale.customer.name}
          </p>
        )}
      </div>

      <div className="border-t border-b py-3 space-y-2">
        {sale.items.map((item) => (
          <div key={item.id} className="flex justify-between items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium break-words">{item.description}</p>
              <p className="text-xs text-muted-foreground">
                {item.qty} × {formatCurrency(item.unit_price)}
              </p>
            </div>
            <p className="font-medium whitespace-nowrap">{formatCurrency(item.line_total)}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatCurrency(sale.subtotal)}</span>
        </div>
        {sale.discount_value > 0 && (
          <div className="flex justify-between">
            <span>Descuento</span>
            <span>
              {sale.discount_type === "percent"
                ? `${sale.discount_value}%`
                : formatCurrency(sale.discount_value)}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t pt-2 font-bold text-base">
          <span>Total</span>
          <span>{formatCurrency(sale.total)}</span>
        </div>
      </div>

      <div className="border-t pt-2 space-y-1">
        <p>
          <span className="font-medium">Forma de pago: </span>
          {sale.payment_method === "cash" ? "Efectivo" : "Transferencia"}
        </p>
        <p>
          <span className="font-medium">Estado del pago: </span>
          {sale.payment_status === "paid" ? "Pagado" : "Pendiente de confirmar"}
        </p>
        {sale.notes && (
          <p>
            <span className="font-medium">Observaciones: </span>
            {sale.notes}
          </p>
        )}
      </div>
    </div>
  );
}
