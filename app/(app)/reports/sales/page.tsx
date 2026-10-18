
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import {
  formatCurrency,
  formatDateTime,
  todayDateString,
} from "@/lib/utils";

interface ReportSale {
  id: string;
  sale_number: string | null;
  total: number;
  payment_method: string;
  created_at: string;
}

interface SalesReport {
  from: string;
  to: string;
  total_revenue: number;
  cash_revenue: number;
  transfer_revenue: number;
  transaction_count: number;
  sales: ReportSale[];
}

export default function ReportsSalesPage() {
  const router = useRouter();
  const today = todayDateString();

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function load() {
    setLoading(true);
    setErrorMessage("");

    try {
      const res = await apiFetch(
        `/api/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );

      const result = await res.json();

      if (!res.ok) {
        throw new Error(
          result.error ?? "No se pudo cargar el reporte."
        );
      }

      setData({
        ...result,
        sales: result.sales ?? [],
      });
    } catch (error) {
      console.error("Error al cargar el reporte de ventas:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo cargar el reporte."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <h1 className="font-bold text-2xl tracking-tight">
        Reporte de ventas
      </h1>

      <div className="flex gap-2 items-end">
        <div className="flex-1 min-w-0 space-y-1">
          <Label className="text-xs">Fecha inicial</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <Label className="text-xs">Fecha final</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs invisible">Consultar</Label>
          <Button
            size="sm"
            onClick={load}
            disabled={loading || from > to}
          >
            Consultar
          </Button>
        </div>
      </div>

      {from > to && (
        <p className="text-sm text-red-600">
          La fecha inicial no puede ser posterior a la fecha final.
        </p>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-red-300 p-3 space-y-2">
          <p className="text-sm text-red-600">{errorMessage}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading || from > to}
          >
            Intentar de nuevo
          </Button>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground">
                  Ingresos totales
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="font-bold text-lg">
                  {formatCurrency(data.total_revenue)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground">
                  Número de ventas
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="font-bold text-lg">
                  {data.transaction_count}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground">
                  Ventas en efectivo
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="font-bold">
                  {formatCurrency(data.cash_revenue)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground">
                  Ventas por transferencia
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <p className="font-bold">
                  {formatCurrency(data.transfer_revenue)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Historial de ventas
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {data.sales.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay ventas en el periodo seleccionado.
                </p>
              ) : (
                data.sales.map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-lg border p-3 space-y-3"
                  >
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold break-all">
                          Folio: {sale.sale_number ?? sale.id}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(sale.created_at)}
                        </p>

                        <p className="text-sm text-muted-foreground">
                          {sale.payment_method === "cash"
                            ? "Efectivo"
                            : sale.payment_method === "bank_transfer"
                              ? "Transferencia"
                              : sale.payment_method}
                        </p>
                      </div>

                      <p className="font-bold whitespace-nowrap">
                        {formatCurrency(sale.total)}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        router.push(
                          `/pos/receipt/${encodeURIComponent(sale.id)}`
                        )
                      }
                    >
                      Ver comprobante
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}

      {loading && (
        <p className="text-center text-muted-foreground">
          Cargando reporte...
        </p>
      )}
    </div>
  );
}
