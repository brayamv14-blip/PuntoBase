"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/utils";

interface PendingTransfer {
  id: string;
  sale_number: string;
  total: number;
  created_at: string;
  notes: string | null;
  customer: { name: string } | null;
}

export default function TransfersPage() {
  const [items, setItems] = useState<PendingTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/transfers");
      if (!res.ok) throw new Error("No se pudo cargar");
      const json = await res.json();
      setItems(json.data ?? []);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(item: PendingTransfer) {
    if (!navigator.onLine) {
      toast.error("Necesitas conexión para confirmar un pago.");
      return;
    }
    if (!window.confirm(`¿Ya ves el depósito de ${formatCurrency(Number(item.total))} en tu banco?`)) return;

    setConfirming(item.id);
    try {
      const res = await apiFetch("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ id: item.id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "No se pudo confirmar el pago.");
        return;
      }
      toast.success("Pago confirmado.");
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      toast.error("Error de conexión al confirmar el pago.");
    } finally {
      setConfirming(null);
    }
  }

  const total = items.reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Transferencias</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bandeja de verificación: confirma cada pago cuando veas el depósito en tu banco.
        </p>
      </div>

      {offline && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm text-yellow-800">
          Sin conexión: no se puede cargar la bandeja. Las ventas por transferencia hechas
          sin internet aparecerán aquí al sincronizar.
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {!loading && !offline && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay transferencias pendientes. ✓</p>
      )}

      {items.length > 0 && (
        <p className="text-sm">
          {items.length} pendiente{items.length === 1 ? "" : "s"} · {formatCurrency(total)}
        </p>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <Card key={item.id}>
            <CardContent className="px-3 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{formatCurrency(Number(item.total))}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.sale_number} · {formatDateTime(item.created_at)}
                  {item.customer?.name ? ` · ${item.customer.name}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 flex-shrink-0"
                disabled={confirming === item.id}
                onClick={() => void confirm(item)}
              >
                {confirming === item.id ? "Confirmando…" : "Confirmar pago"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
