"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import {
  formatCurrency,
  formatDateTime,
  todayDateString,
} from "@/lib/utils";
import type { Expense } from "@/types";

export default function ReportsExpensesPage() {
  const today = todayDateString();

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);

    try {
      const res = await apiFetch(
        `/api/reports/expenses?from=${from}&to=${to}`
      );

      if (!res.ok) {
        throw new Error("No se pudo cargar el reporte de gastos.");
      }

      const data = await res.json();

      setTotal(data.total ?? 0);
      setItems(data.items ?? []);
    } catch {
      setTotal(0);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <h1 className="font-bold text-2xl tracking-tight">
        Reporte de gastos
      </h1>

      {/* Filtros por periodo */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1 min-w-0">
          <Label className="text-xs">Fecha inicial</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>

        <div className="flex-1 space-y-1 min-w-0">
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
            {loading ? "Cargando..." : "Consultar"}
          </Button>
        </div>
      </div>

      {from > to && (
        <p className="text-sm text-red-600">
          La fecha inicial no puede ser posterior a la fecha final.
        </p>
      )}

      {/* Total de gastos */}
      <div className="flex justify-between items-center">
        <p className="font-semibold">Total de gastos</p>
        <p className="font-bold text-lg text-red-600">
          {formatCurrency(total)}
        </p>
      </div>

      {/* Detalle de gastos */}
      <div className="space-y-2">
        {items.map((exp) => (
          <div
            key={exp.id}
            className="bg-card border rounded-xl p-3 flex justify-between items-start"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">
                {exp.description}
              </p>

              <p className="text-xs text-muted-foreground">
                {formatDateTime(exp.created_at)}
              </p>
            </div>

            <p className="font-bold text-red-600 flex-shrink-0 ml-2">
              {formatCurrency(Number(exp.amount))}
            </p>
          </div>
        ))}

        {items.length === 0 && !loading && (
          <p className="text-center text-muted-foreground py-4">
            No hay gastos registrados en este periodo.
          </p>
        )}

        {loading && (
          <p className="text-center text-muted-foreground py-4">
            Cargando reporte de gastos...
          </p>
        )}
      </div>
    </div>
  );
}
