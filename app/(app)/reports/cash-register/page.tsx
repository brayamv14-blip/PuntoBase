import { supabase } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type CashRegRow = {
  id: string;
  date: string;
  opening_balance: number;
  expected_cash: number | null;
  actual_cash: number | null;
  discrepancy: number | null;
  closed_at: string | null;
  closed_by: { name: string } | null;
};

export default async function ReportsCashRegisterPage() {
  const { data: rawData } = await supabase
    .from("cash_register")
    .select("*, closed_by:devices(id,name)")
    .order("date", { ascending: false })
    .limit(30);

  const data = rawData as CashRegRow[] | null;

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <h1 className="font-bold text-2xl tracking-tight">
        Historial de cortes de caja
      </h1>

      <div className="space-y-2">
        {(data ?? []).map((row) => {
          const difference =
            row.discrepancy !== null
              ? Number(row.discrepancy)
              : null;

          const hasDifference =
            difference !== null && Math.abs(difference) > 0;

          return (
            <div
              key={row.id}
              className="bg-card border rounded-xl p-3 space-y-2"
            >
              <div className="flex justify-between items-center gap-2">
                <p className="font-semibold">
                  {formatDate(row.date)}
                </p>

                {row.closed_at ? (
                  <Badge
                    variant={hasDifference ? "destructive" : "secondary"}
                  >
                    {hasDifference
                      ? difference! > 0
                        ? `+${formatCurrency(difference!)} de sobrante`
                        : `${formatCurrency(difference!)} de faltante`
                      : "✓ Caja cuadrada"}
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    Caja abierta
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <span>Fondo inicial</span>
                  <span>
                    {formatCurrency(Number(row.opening_balance))}
                  </span>
                </div>

                {row.expected_cash != null && (
                  <div className="flex justify-between gap-2">
                    <span>Efectivo esperado</span>
                    <span>
                      {formatCurrency(Number(row.expected_cash))}
                    </span>
                  </div>
                )}

                {row.actual_cash != null && (
                  <div className="flex justify-between gap-2">
                    <span>Efectivo contado</span>
                    <span className="font-semibold text-foreground">
                      {formatCurrency(Number(row.actual_cash))}
                    </span>
                  </div>
                )}
              </div>

              {(row.closed_by as { name: string } | null)?.name && (
                <p className="text-xs text-muted-foreground">
                  Corte realizado por{" "}
                  {(row.closed_by as { name: string }).name}
                </p>
              )}
            </div>
          );
        })}

        {(!data || data.length === 0) && (
          <p className="text-center text-muted-foreground py-8">
            Todavía no hay cortes de caja registrados.
          </p>
        )}
      </div>
    </div>
  );
}
