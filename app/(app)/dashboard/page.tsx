import { redirect } from "next/navigation";
import { getDeviceFromCookies } from "@/lib/auth";
import { supabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  dayEndISO,
  dayStartISO,
  formatCurrency,
  formatDateTime,
  todayDateString,
} from "@/lib/utils";
import {
  TrendingUp,
  Wallet,
  ArrowLeftRight,
  TrendingDown,
  AlertTriangle,
  PackageX,
} from "lucide-react";
import type { CashRegister, Sale, VariantWithProduct } from "@/types";
import { SalesStats } from "@/components/dashboard/SalesStats";
import {
  CatalogLinkButton,
  ShoppingListButton,
} from "@/components/dashboard/ShareButtons";

export const dynamic = "force-dynamic";

type TodaySaleRow = Pick<Sale, "total" | "payment_method">;
type ExpenseRow = { amount: number };

export default async function DashboardPage() {
  const device = await getDeviceFromCookies();
  if (!device) redirect("/setup");

  const today = todayDateString();
  const todayStart = dayStartISO(today);
  const todayEnd = dayEndISO(today);

  const [cashRegRes, salesRes, expRes, recentRes, varRes] =
    await Promise.all([
      supabase
        .from("cash_register")
        .select("*")
        .eq("date", today)
        .single(),

      supabase
        .from("sales")
        .select("total, payment_method")
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd),

      supabase
        .from("expenses")
        .select("amount")
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd),

      supabase
        .from("sales")
        .select(
          "id, sale_number, total, payment_method, created_at, customer:customers(name)"
        )
        .order("created_at", { ascending: false })
        .limit(10),

      supabase
        .from("product_variants")
        .select(
          "id, size_label, stock_qty, low_stock_threshold, product:products(id, name, track_stock)"
        )
        .limit(200),
    ]);

  const cashRegister = cashRegRes.data as Pick<
    CashRegister,
    "opening_balance" | "discrepancy"
  > | null;

  const todaySales = salesRes.data as TodaySaleRow[] | null;
  const todayExpenses = expRes.data as ExpenseRow[] | null;

  const recentSales = recentRes.data as
    | (Pick<
        Sale,
        "id" | "sale_number" | "total" | "payment_method" | "created_at"
      > & { customer: { name: string } | null })[]
    | null;

  const lowStockVariants = varRes.data as
    | (VariantWithProduct & {
        product: { track_stock: boolean } | null;
      })[]
    | null;

  const allAlertItems = (lowStockVariants ?? [])
    .filter(
      (v) =>
        v.product?.track_stock &&
        v.stock_qty <= v.low_stock_threshold
    )
    .map((v) => ({
      id: v.id,
      name: v.size_label
        ? `${v.product?.name ?? "Sin nombre"} (${v.size_label})`
        : v.product?.name ?? "Sin nombre",
      stock_qty: v.stock_qty,
      low_stock_threshold: v.low_stock_threshold,
    }));

  const outOfStockItems = allAlertItems.filter(
    (item) => item.stock_qty === 0
  );

  const lowStockItems = allAlertItems.filter(
    (item) => item.stock_qty > 0
  );

  const totalRevenue =
    todaySales?.reduce((sum, sale) => sum + Number(sale.total), 0) ?? 0;

  const cashRevenue =
    todaySales
      ?.filter((sale) => sale.payment_method === "cash")
      .reduce((sum, sale) => sum + Number(sale.total), 0) ?? 0;

  const transferRevenue = totalRevenue - cashRevenue;

  const expensesTotal =
    todayExpenses?.reduce((sum, expense) => sum + Number(expense.amount), 0) ??
    0;

  const openingBalance = cashRegister?.opening_balance ?? 0;
  const cashBalance = openingBalance + cashRevenue - expensesTotal;

  const hasDiscrepancy =
    cashRegister?.discrepancy != null &&
    Math.abs(Number(cashRegister.discrepancy)) > 0;

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">
          Panel de control
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Resumen de ventas, caja e inventario
        </p>
      </div>

      {hasDiscrepancy && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle
            size={16}
            className="flex-shrink-0 mt-0.5"
          />
          <span>
            Diferencia en caja del día:{" "}
            {formatCurrency(Math.abs(Number(cashRegister!.discrepancy)))}.
            {Number(cashRegister!.discrepancy) < 0
              ? " Falta dinero respecto al saldo esperado."
              : " Hay dinero de más respecto al saldo esperado."}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-l-4 border-l-red-500 overflow-hidden">
          <CardContent className="px-3 py-3">
            <div className="flex items-start justify-between mb-1">
              <p className="text-xs text-muted-foreground">
                Ventas de hoy
              </p>
              <TrendingUp
                size={16}
                className="text-red-500 flex-shrink-0"
                strokeWidth={1.8}
              />
            </div>
            <p className="font-bold text-xl leading-tight">
              {formatCurrency(totalRevenue)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {todaySales?.length ?? 0} operaciones
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 overflow-hidden">
          <CardContent className="px-3 py-3">
            <div className="flex items-start justify-between mb-1">
              <p className="text-xs text-muted-foreground">
                Saldo de caja
              </p>
              <Wallet
                size={16}
                className="text-red-500 flex-shrink-0"
                strokeWidth={1.8}
              />
            </div>
            <p className="font-bold text-xl leading-tight">
              {formatCurrency(cashBalance)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fondo inicial: {formatCurrency(openingBalance)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 overflow-hidden">
          <CardContent className="px-3 py-3">
            <div className="flex items-start justify-between mb-1">
              <p className="text-xs text-muted-foreground">
                Efectivo y transferencias
              </p>
              <ArrowLeftRight
                size={16}
                className="text-red-500 flex-shrink-0"
                strokeWidth={1.8}
              />
            </div>
            <p className="font-bold text-lg leading-tight">
              {formatCurrency(cashRevenue)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCurrency(transferRevenue)} en transferencias
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 overflow-hidden">
          <CardContent className="px-3 py-3">
            <div className="flex items-start justify-between mb-1">
              <p className="text-xs text-muted-foreground">
                Gastos de hoy
              </p>
              <TrendingDown
                size={16}
                className="text-red-500 flex-shrink-0"
                strokeWidth={1.8}
              />
            </div>
            <p className="font-bold text-xl leading-tight">
              {formatCurrency(expensesTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      {outOfStockItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <div className="flex items-center gap-1.5">
              <PackageX size={15} className="text-red-500" />
              <CardTitle className="text-sm">
                Productos agotados
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {outOfStockItems.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between text-sm"
                >
                  <span className="truncate flex-1">{item.name}</span>
                  <Badge
                    variant="destructive"
                    className="ml-2 flex-shrink-0 min-w-[3rem] justify-center"
                  >
                    Agotado
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {lowStockItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <div className="flex items-center gap-1.5">
              <PackageX size={15} className="text-amber-500" />
              <CardTitle className="text-sm">
                Inventario bajo
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {lowStockItems.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between text-sm"
                >
                  <span className="truncate flex-1">{item.name}</span>
                  <Badge className="ml-2 flex-shrink-0 min-w-[3rem] justify-center bg-amber-500 hover:bg-amber-500 text-white">
                    {item.stock_qty} pzas.
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-sm">
            Últimas ventas
          </CardTitle>
        </CardHeader>

        <CardContent className="px-3 pb-3 space-y-2">
          {(!recentSales || recentSales.length === 0) && (
            <p className="text-sm text-muted-foreground">
              Aún no hay ventas registradas
            </p>
          )}

          {recentSales?.map((sale) => (
            <div
              key={sale.id}
              className="flex justify-between items-center text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold">
                  {sale.sale_number}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {formatDateTime(sale.created_at)}
                  {sale.customer?.name && ` · ${sale.customer.name}`}
                </p>
              </div>

              <div className="text-right ml-2 flex-shrink-0">
                <p className="font-bold">
                  {formatCurrency(Number(sale.total))}
                </p>
                <Badge variant="outline" className="text-[10px]">
                  {sale.payment_method === "cash"
                    ? "Efectivo"
                    : "Transferencia"}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {allAlertItems.length > 0 && (
        <ShoppingListButton
          items={allAlertItems.map((item) => ({
            name: item.name,
            stock_qty: item.stock_qty,
          }))}
        />
      )}

      <SalesStats />

      <CatalogLinkButton />
    </div>
  );
}
