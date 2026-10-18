"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import {
  formatCurrency,
  formatDateTime,
  todayDateString,
  dayStartISO,
  dayEndISO,
  cn,
} from "@/lib/utils";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface SaleItem {
  id: string;
  description: string;
  qty: number;
  unit_price: number;
  line_total: number;
  refunded_qty: number;
}

interface SaleRow {
  id: string;
  sale_number: string;
  total: number;
  payment_method: string;
  discount_type: string | null;
  discount_value: number | null;
  created_at: string;
  customer: { name: string } | null;
  items: SaleItem[];
}

interface ExpenseRow {
  id: string;
  description: string;
  amount: number;
  created_at: string;
  device: { name: string } | null;
}

interface AdjustmentRow {
  id: string;
  qty_change: number;
  note: string | null;
  created_at: string;
  product: { name: string } | null;
  variant: { size_label: string } | null;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ReportsPage() {
  const router = useRouter();
  const today = todayDateString();

  const [date, setDate] = useState(today);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [salesSearch, setSalesSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<
    "all" | "cash" | "bank_transfer"
  >("all");
  const [expenseSearch, setExpenseSearch] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);

    const fromISO = dayStartISO(date);
    const toISO = dayEndISO(date);

    try {
      const [salesRes, expRes, adjRes] = await Promise.all([
        apiFetch(
          `/api/sales?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}&limit=200`
        ).then(async (r) => {
          const result = await r.json();
          if (!r.ok) {
            throw new Error(result.error ?? "No se pudieron cargar las ventas.");
          }
          return result;
        }),
        apiFetch(
          `/api/reports/expenses?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`
        ).then(async (r) => {
          const result = await r.json();
          if (!r.ok) {
            throw new Error(result.error ?? "No se pudieron cargar los gastos.");
          }
          return result;
        }),
        apiFetch(
          `/api/stock/adjustments?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`
        ).then(async (r) => {
          const result = await r.json();
          if (!r.ok) {
            throw new Error(result.error ?? "No se pudieron cargar los ajustes.");
          }
          return result;
        }),
      ]);

      setSales(salesRes.data ?? []);
      setExpenses(expRes.items ?? []);
      setAdjustments(Array.isArray(adjRes) ? adjRes : []);
    } catch (error) {
      console.error("Error al cargar los reportes:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los reportes."
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function shiftDate(days: number) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  }

  const filteredSales = sales.filter((s) => {
    const search = salesSearch.toLowerCase();

    const nameMatch =
      !search ||
      (s.customer?.name ?? "").toLowerCase().includes(search) ||
      (s.sale_number ?? "").toLowerCase().includes(search);

    const payMatch =
      paymentFilter === "all" || s.payment_method === paymentFilter;

    return nameMatch && payMatch;
  });

  const filteredExpenses = expenses.filter(
    (e) =>
      !expenseSearch ||
      e.description.toLowerCase().includes(expenseSearch.toLowerCase())
  );

  const filteredAdjustments = adjustments.filter(
    (a) =>
      !stockSearch ||
      (a.product?.name ?? "")
        .toLowerCase()
        .includes(stockSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] max-w-lg mx-auto w-full">
      <div className="px-4 pt-4 pb-2">
        <h1 className="font-bold text-2xl tracking-tight">Reportes</h1>
      </div>

      <Tabs defaultValue="sales" className="flex flex-col flex-1 min-h-0">
        <div className="px-4">
          <TabsList className="w-full">
            <TabsTrigger value="sales" className="flex-1">
              Ventas
            </TabsTrigger>
            <TabsTrigger value="expenses" className="flex-1">
              Gastos
            </TabsTrigger>
            <TabsTrigger value="stock" className="flex-1">
              Ajustes de inventario
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => shiftDate(-1)}
            aria-label="Día anterior"
          >
            <ChevronLeft size={16} />
          </Button>

          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 text-center"
          />

          <Button
            size="icon"
            variant="outline"
            onClick={() => shiftDate(1)}
            disabled={date >= today}
            aria-label="Día siguiente"
          >
            <ChevronRight size={16} />
          </Button>
        </div>

        {/* Pestaña de ventas */}
        <TabsContent
          value="sales"
          className="flex-1 overflow-y-auto px-4 pb-4 mt-0 space-y-2"
        >
          <div className="flex gap-2">
            <Input
              placeholder="Buscar cliente o folio..."
              value={salesSearch}
              onChange={(e) => setSalesSearch(e.target.value)}
              className="flex-1"
            />

            <Select
              value={paymentFilter}
              onValueChange={(v) =>
                setPaymentFilter(v as typeof paymentFilter)
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Pago" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="cash">Efectivo</SelectItem>
                <SelectItem value="bank_transfer">Transferencia</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading && <LoadingSkeleton />}

          {!loading && filteredSales.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No hay ventas registradas en este periodo.
            </p>
          )}

          {filteredSales.map((sale) => (
            <SaleCard
              key={sale.id}
              sale={sale}
              expanded={expandedSaleId === sale.id}
              onToggle={() =>
                setExpandedSaleId(
                  expandedSaleId === sale.id ? null : sale.id
                )
              }
              onRefunded={loadAll}
              onViewReceipt={() =>
                router.push(
                  `/pos/receipt/${encodeURIComponent(sale.id)}`
                )
              }
            />
          ))}
        </TabsContent>

        {/* Pestaña de gastos */}
        <TabsContent
          value="expenses"
          className="flex-1 overflow-y-auto px-4 pb-4 mt-0 space-y-2"
        >
          <Input
            placeholder="Buscar descripción..."
            value={expenseSearch}
            onChange={(e) => setExpenseSearch(e.target.value)}
          />

          {loading && <LoadingSkeleton />}

          {!loading && filteredExpenses.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No hay gastos registrados en este periodo.
            </p>
          )}

          {filteredExpenses.map((exp) => (
            <div key={exp.id} className="bg-card border rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium flex-1">
                  {exp.description}
                </p>
                <p className="font-bold text-red-600 flex-shrink-0">
                  {formatCurrency(Number(exp.amount))}
                </p>
              </div>

              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDateTime(exp.created_at)}
                {exp.device?.name && (
                  <span className="ml-2">· {exp.device.name}</span>
                )}
              </p>
            </div>
          ))}
        </TabsContent>

        {/* Pestaña de ajustes de inventario */}
        <TabsContent
          value="stock"
          className="flex-1 overflow-y-auto px-4 pb-4 mt-0 space-y-2"
        >
          <Input
            placeholder="Buscar producto..."
            value={stockSearch}
            onChange={(e) => setStockSearch(e.target.value)}
          />

          {loading && <LoadingSkeleton />}

          {!loading && filteredAdjustments.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No hay ajustes de inventario en este periodo.
            </p>
          )}

          {filteredAdjustments.map((adj) => (
            <div key={adj.id} className="bg-card border rounded-xl p-3">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "font-bold text-base w-10 flex-shrink-0 text-right",
                    adj.qty_change > 0
                      ? "text-emerald-600"
                      : "text-red-600"
                  )}
                >
                  {adj.qty_change > 0
                    ? `+${adj.qty_change}`
                    : adj.qty_change}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {adj.product?.name ?? "—"}
                    {adj.variant?.size_label && (
                      <span className="text-muted-foreground font-normal">
                        {" "}({adj.variant.size_label})
                      </span>
                    )}
                  </p>

                  {adj.note && (
                    <p className="text-xs text-muted-foreground truncate">
                      {adj.note}
                    </p>
                  )}
                </div>

                <p className="text-xs text-muted-foreground flex-shrink-0">
                  {formatDateTime(adj.created_at)}
                </p>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Tarjeta de venta con detalle desplegable ──────────────────────────────────

function SaleCard({
  sale,
  expanded,
  onToggle,
  onRefunded,
  onViewReceipt,
}: {
  sale: SaleRow;
  expanded: boolean;
  onToggle: () => void;
  onRefunded: () => void;
  onViewReceipt: () => void;
}) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [refunding, setRefunding] = useState(false);

  const items = sale.items ?? [];
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.line_total || 0),
    0
  );

  const discountAmount =
    sale.discount_type === "percent"
      ? (subtotal * (sale.discount_value ?? 0)) / 100
      : (sale.discount_value ?? 0);

  const hasAnyRefund = items.some((i) => i.refunded_qty > 0);

  const refundableItems = items.filter(
    (i) => i.refunded_qty < i.qty
  );

  const checkedItems = items.filter((i) => checkedIds.has(i.id));

  const refundTotal = checkedItems.reduce(
    (sum, item) =>
      sum + Number(item.unit_price) * (item.qty - item.refunded_qty),
    0
  );

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  async function confirmRefund() {
    if (!checkedItems.length) return;

    setRefunding(true);

    try {
      const res = await apiFetch(`/api/sales/${sale.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: checkedItems.map((item) => ({
            sale_item_id: item.id,
            qty: item.qty - item.refunded_qty,
          })),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(
          result.error ?? "No se pudo realizar la devolución."
        );
        return;
      }

      toast.success(
        `Devolución realizada: ${formatCurrency(result.refunded_total)}`
      );

      setCheckedIds(new Set());
      onRefunded();
    } catch (error) {
      console.error("Error al realizar devolución:", error);
      toast.error("Ocurrió un error al realizar la devolución.");
    } finally {
      setRefunding(false);
    }
  }

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-3 flex items-center gap-2 text-left cursor-pointer hover:bg-muted/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold truncate">
              {sale.customer?.name ?? "Cliente ocasional"}
            </p>

            <Badge
              variant={
                sale.payment_method === "cash" ? "default" : "secondary"
              }
              className="text-[10px]"
            >
              {sale.payment_method === "cash"
                ? "Efectivo"
                : "Transferencia"}
            </Badge>

            {hasAnyRefund && (
              <Badge className="text-[10px] bg-amber-500 hover:bg-amber-500">
                Con devolución
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {formatDateTime(sale.created_at)}
          </p>
        </div>

        <p className="font-bold text-sm flex-shrink-0">
          {formatCurrency(Number(sale.total))}
        </p>

        {expanded ? (
          <ChevronUp
            size={15}
            className="text-muted-foreground flex-shrink-0"
          />
        ) : (
          <ChevronDown
            size={15}
            className="text-muted-foreground flex-shrink-0"
          />
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-1.5 bg-muted/30">
          {items.map((item) => {
            const fullyRefunded = item.refunded_qty >= item.qty;
            const checked = checkedIds.has(item.id);

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  fullyRefunded && "opacity-50"
                )}
              >
                {!fullyRefunded ? (
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 flex-shrink-0"
                    checked={checked}
                    onChange={() => toggleCheck(item.id)}
                    aria-label={`Seleccionar ${item.description} para devolución`}
                  />
                ) : (
                  <span className="h-3.5 w-3.5 flex-shrink-0" />
                )}

                <span
                  className={cn(
                    "flex-1 truncate text-muted-foreground",
                    fullyRefunded && "line-through"
                  )}
                >
                  {item.description}
                  <span className="text-foreground">
                    {" "}× {item.qty}
                  </span>
                </span>

                {fullyRefunded ? (
                  <span className="text-[10px] text-amber-600 flex-shrink-0">
                    Devuelto
                  </span>
                ) : (
                  <span className="font-medium flex-shrink-0">
                    {formatCurrency(Number(item.line_total))}
                  </span>
                )}
              </div>
            );
          })}

          {discountAmount > 0 && (
            <div className="flex justify-between text-sm text-red-600 border-t pt-1.5 mt-1">
              <span>Descuento</span>
              <span>−{formatCurrency(discountAmount)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm font-bold border-t pt-1.5 mt-1">
            <span>Total</span>
            <span>{formatCurrency(Number(sale.total))}</span>
          </div>

          {/* Botón para abrir el comprobante de esta venta */}
          <Button
            type="button"
            variant="outline"
            className="w-full mt-2"
            onClick={onViewReceipt}
          >
            Ver comprobante
          </Button>

          {refundableItems.length > 0 && checkedIds.size > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="w-full mt-1"
              onClick={confirmRefund}
              disabled={refunding}
            >
              {refunding
                ? "Procesando..."
                : `Devolver ${checkedIds.size} ${
                    checkedIds.size === 1 ? "producto" : "productos"
                  } · ${formatCurrency(refundTotal)}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-card border rounded-xl p-3 space-y-2 animate-pulse"
        >
          <div className="flex justify-between">
            <div className="h-3 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-1/4" />
          </div>
          <div className="h-3 bg-muted rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}
