"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Expense } from "@/types";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadExpenses() {
    try {
      const res = await apiFetch("/api/expenses");
      const data = await res.json();

      if (!res.ok) {
        toast.error(
          data.error ?? "No se pudieron cargar los gastos."
        );
        return;
      }

      setExpenses(data.data ?? []);
      setTotal(
        data.data?.reduce(
          (sum: number, expense: Expense) =>
            sum + Number(expense.amount),
          0
        ) ?? 0
      );
    } catch {
      toast.error("Error de conexión al consultar los gastos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExpenses();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!description.trim()) {
      toast.error("Ingresa el concepto del gasto.");
      return;
    }

    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      toast.error("Ingresa un importe válido mayor que cero.");
      return;
    }

    setSaving(true);

    try {
      const res = await apiFetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          amount: Number(amount),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(
          data.error ?? "No se pudo registrar el gasto."
        );
        return;
      }

      setDescription("");
      setAmount("");

      toast.success("Gasto registrado correctamente.");
      await loadExpenses();
    } catch {
      toast.error("Error de conexión al registrar el gasto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">
          Gastos del negocio
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Registra y consulta los gastos de tu establecimiento.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-card border rounded-xl p-4 space-y-3"
      >
        <p className="font-semibold text-sm">
          Registrar nuevo gasto
        </p>

        <div className="space-y-1">
          <Label htmlFor="expense-description">
            Concepto del gasto *
          </Label>
          <Input
            id="expense-description"
            placeholder="Ej. Pago de electricidad"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="expense-amount">
            Importe del gasto (MXN) *
          </Label>
          <Input
            id="expense-amount"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={saving}
        >
          {saving ? "Registrando gasto..." : "Registrar gasto"}
        </Button>
      </form>

      <Separator />

      <div className="flex justify-between items-center gap-3">
        <div>
          <p className="font-semibold">Historial de gastos</p>
          <p className="text-xs text-muted-foreground">
            {expenses.length} {expenses.length === 1 ? "registro" : "registros"}
          </p>
        </div>

        <p className="font-bold text-red-600 text-right">
          {formatCurrency(total)}
        </p>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground py-4">
          Cargando gastos...
        </p>
      ) : (
        <div className="space-y-2">
          {expenses.map((expense) => (
            <div
              key={expense.id}
              className="bg-card border rounded-xl p-3 flex justify-between items-start gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">
                  {expense.description}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDateTime(expense.created_at)}
                </p>
              </div>

              <p className="font-bold text-red-600 flex-shrink-0">
                −{formatCurrency(Number(expense.amount))}
              </p>
            </div>
          ))}

          {expenses.length === 0 && (
            <div className="text-center text-muted-foreground py-8 border rounded-xl">
              <p className="font-medium">Aún no hay gastos registrados</p>
              <p className="text-sm mt-1">
                Los gastos que registres aparecerán aquí.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
