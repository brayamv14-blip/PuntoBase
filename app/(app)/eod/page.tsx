"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { enqueueOp } from "@/lib/offline-ops";
import { formatCurrency, todayDateString } from "@/lib/utils";

interface RegisterData {
  date: string;
  opening_balance: number;
  cash_sales_total: number;
  expenses_total: number;
  expected_cash: number;
  actual_cash: number | null;
  discrepancy: number | null;
  closed_at: string | null;
  is_closed: boolean;
  transfer_paid_total?: number;
  transfer_pending_total?: number;
  transfer_pending_count?: number;
}

export default function EodPage() {
  const [data, setData] = useState<RegisterData | null>(null);
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [offline, setOffline] = useState(false);

  async function loadData() {
    try {
      const res = await apiFetch("/api/cash-register/today");
      if (!res.ok) throw new Error("No se pudo cargar la caja");
      setData(await res.json());
      setOffline(false);
    } catch {
      // Sin conexion: se permite capturar el corte y se calcula al sincronizar.
      setOffline(true);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!actualCash || Number(actualCash) < 0) {
      toast.error("Ingresa una cantidad válida para el efectivo contado.");
      return;
    }

    // Sin conexion: el corte se guarda en el dispositivo y se cierra la caja al reconectar.
    if (!navigator.onLine) {
      try {
        await enqueueOp("close_cash_register", {
          actual_cash: Number(actualCash),
          notes: notes.trim() || null,
          date: todayDateString(),
        });
        toast.success("Corte guardado en el dispositivo. La caja se cerrará al reconectar.");
        setActualCash("");
        setNotes("");
      } catch {
        toast.error("No se pudo guardar el corte en el dispositivo.");
      }
      return;
    }

    setSubmitting(true);

    try {
      const res = await apiFetch("/api/cash-register/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actual_cash: Number(actualCash),
          notes: notes.trim() || null,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "No se pudo realizar el corte de caja.");
        return;
      }

      toast.success("Corte de caja registrado correctamente.");
      await loadData();
    } catch {
      toast.error("Ocurrió un error al registrar el corte de caja.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data && offline) {
    return (
      <div className="p-4 space-y-4 max-w-lg mx-auto">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Corte de caja</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sin conexión. Captura el efectivo contado: el sistema calculará el efectivo
            esperado y la diferencia cuando se sincronice.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border rounded-xl p-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="actual-cash-offline">Efectivo contado (MXN) *</Label>
            <Input
              id="actual-cash-offline"
              type="number"
              min="0"
              step="0.01"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="notes-offline">Observaciones (opcional)</Label>
            <Textarea
              id="notes-offline"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <Button type="submit" className="w-full">
            Guardar corte en el dispositivo
          </Button>
        </form>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Cargando información de caja...
      </div>
    );
  }

  const discrepancy = data.is_closed ? data.discrepancy : null;

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">
          Corte de caja
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Revisa el efectivo y registra el cierre del día.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Resumen del día — {data.date}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              Fondo inicial de caja
            </span>
            <span className="font-medium">
              {formatCurrency(data.opening_balance)}
            </span>
          </div>

          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              + Ventas en efectivo
            </span>
            <span className="font-medium text-green-600">
              +{formatCurrency(data.cash_sales_total)}
            </span>
          </div>

          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              − Gastos del día
            </span>
            <span className="font-medium text-red-600">
              −{formatCurrency(data.expenses_total)}
            </span>
          </div>

          <div className="flex justify-between gap-3 border-t pt-2 font-bold">
            <span>Efectivo esperado</span>
            <span>{formatCurrency(data.expected_cash)}</span>
          </div>

          {data.is_closed && (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Efectivo contado
                </span>
                <span className="font-medium">
                  {formatCurrency(data.actual_cash ?? 0)}
                </span>
              </div>

              <div className="flex justify-between items-center gap-3">
                <span className="text-muted-foreground">
                  Diferencia de caja
                </span>

                <Badge
                  variant={
                    discrepancy === 0 ? "secondary" : "destructive"
                  }
                >
                  {discrepancy === 0
                    ? "✓ Caja cuadrada"
                    : discrepancy! > 0
                      ? `+${formatCurrency(discrepancy!)} de sobrante`
                      : `${formatCurrency(discrepancy!)} de faltante`}
                </Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Transferencias del día</CardTitle>
        </CardHeader>

        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Confirmadas</span>
            <span className="font-medium text-green-600">
              {formatCurrency(data.transfer_paid_total ?? 0)}
            </span>
          </div>

          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              Pendientes de confirmar ({data.transfer_pending_count ?? 0})
            </span>
            <span className="font-medium text-amber-600">
              {formatCurrency(data.transfer_pending_total ?? 0)}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Las transferencias no entran al efectivo esperado. Confirma cada pago en el
            recibo de la venta cuando veas el depósito en tu banco.
          </p>
        </CardContent>
      </Card>

      {!data.is_closed && (
        <form
          onSubmit={handleSubmit}
          className="bg-card border rounded-xl p-4 space-y-3"
        >
          <p className="font-semibold text-sm">
            Registrar corte de caja
          </p>

          <p className="text-xs text-muted-foreground">
            Cuenta el dinero disponible en la caja e ingresa el total.
          </p>

          <div className="space-y-1">
            <Label htmlFor="actual-cash">
              Efectivo contado (MXN) *
            </Label>

            <Input
              id="actual-cash"
              type="number"
              min="0"
              step="0.01"
              placeholder="Ej. 1500.00"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              required
            />
          </div>

          {actualCash !== "" && Number(actualCash) >= 0 && (
            <div className="text-sm bg-muted/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between gap-3">
                <span>Efectivo esperado</span>
                <span>{formatCurrency(data.expected_cash)}</span>
              </div>

              <div className="flex justify-between gap-3">
                <span>Efectivo contado</span>
                <span>{formatCurrency(Number(actualCash))}</span>
              </div>

              <div className="flex justify-between gap-3 font-bold border-t pt-2 mt-2">
                <span>Diferencia</span>
                <span
                  className={
                    Number(actualCash) - data.expected_cash === 0
                      ? "text-green-600"
                      : "text-red-600"
                  }
                >
                  {formatCurrency(
                    Number(actualCash) - data.expected_cash
                  )}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="notes">Observaciones (opcional)</Label>

            <Textarea
              id="notes"
              placeholder="Anota cualquier aclaración sobre el corte..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={submitting}
          >
            {submitting
              ? "Registrando corte..."
              : "Registrar corte de caja"}
          </Button>
        </form>
      )}

      {data.is_closed && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 text-center">
          ✓ El corte de caja de hoy ya fue registrado.
          <p className="mt-1">
            Efectivo registrado al cierre:{" "}
            <strong>
              {formatCurrency(data.actual_cash ?? 0)}
            </strong>
          </p>
        </div>
      )}
    </div>
  );
}
