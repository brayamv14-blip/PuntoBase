"use client";

import { useState, useEffect } from "react";
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
import { formatCurrency, todayDateString } from "@/lib/utils";

interface SalesReport {
  from: string;
  to: string;
  total_revenue: number;
  cash_revenue: number;
  transfer_revenue: number;
  transaction_count: number;
}

export default function ReportsSalesPage() {
  const today = todayDateString();

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);

    try {
      const res = await apiFetch(
        `/api/reports/sales?from=${from}&to=${to}`
      );

      setData(await res.json());
    } catch (error) {
      console.error("Error al cargar el reporte de ventas:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <h1 className="font-bold text-2xl tracking-tight">
        Reporte de ventas
      </h1>

      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Fecha inicial</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>

        <div className="flex-1 space-y-1">
          <Label className="text-xs">Fecha final</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs invisible">Consultar</Label>
          <Button size="sm" onClick={load} disabled={loading}>
            Consultar
          </Button>
        </div>
      </div>

      {data && (
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
      )}

      {loading && (
        <p className="text-center text-muted-foreground">
          Cargando reporte...
        </p>
      )}
    </div>
  );
}