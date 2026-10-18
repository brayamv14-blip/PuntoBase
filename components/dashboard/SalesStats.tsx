import { supabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { BarChart3, Clock, Trophy } from "lucide-react";

// Las graficas agrupan por dia y hora locales del negocio, no por UTC.
const TZ = "America/Mexico_City";
const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourOf = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "numeric",
  hourCycle: "h23",
});
const dayLabel = new Intl.DateTimeFormat("es-MX", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
});

type SaleRow = { total: number | string; created_at: string };
type ItemRow = {
  description: string;
  qty: number | string;
  refunded_qty: number | string | null;
  line_total: number | string;
};

function barHeight(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}

export async function SalesStats() {
  const now = new Date().getTime();
  const since7 = new Date(now - 7 * 86400000).toISOString();
  const since30 = new Date(now - 30 * 86400000).toISOString();

  const [salesRes, itemsRes] = await Promise.all([
    supabase.from("sales").select("total, created_at").gte("created_at", since7).limit(5000),
    supabase
      .from("sale_items")
      .select("description, qty, refunded_qty, line_total, sales!inner(created_at)")
      .gte("sales.created_at", since30)
      .limit(5000),
  ]);

  const sales = (salesRes.data ?? []) as SaleRow[];
  const items = (itemsRes.data ?? []) as unknown as ItemRow[];

  // Ventas por dia (ultimos 7 dias)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now - (6 - i) * 86400000);
    return { key: dayKey.format(date), label: dayLabel.format(date), total: 0 };
  });
  for (const sale of sales) {
    const day = days.find((d) => d.key === dayKey.format(new Date(sale.created_at)));
    if (day) day.total += Number(sale.total);
  }
  const maxDay = Math.max(...days.map((d) => d.total));

  // Ventas por hora (hoy)
  const todayKey = dayKey.format(new Date(now));
  const byHour = new Map<number, number>();
  for (const sale of sales) {
    const created = new Date(sale.created_at);
    if (dayKey.format(created) !== todayKey) continue;
    const hour = Number(hourOf.format(created));
    byHour.set(hour, (byHour.get(hour) ?? 0) + Number(sale.total));
  }
  const hoursWithSales = [...byHour.keys()];
  const firstHour = Math.min(8, ...(hoursWithSales.length ? hoursWithSales : [8]));
  const lastHour = Math.max(20, ...(hoursWithSales.length ? hoursWithSales : [20]));
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => ({
    hour: firstHour + i,
    total: byHour.get(firstHour + i) ?? 0,
  }));
  const maxHour = Math.max(...hours.map((h) => h.total));

  // Top 10 productos (ultimos 30 dias, descontando devoluciones)
  const ranking = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const item of items) {
    const qty = Number(item.qty);
    const net = qty - Number(item.refunded_qty ?? 0);
    if (net <= 0) continue;
    const entry = ranking.get(item.description) ?? { name: item.description, qty: 0, revenue: 0 };
    entry.qty += net;
    entry.revenue += qty > 0 ? (Number(item.line_total) * net) / qty : 0;
    ranking.set(item.description, entry);
  }
  const top = [...ranking.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  const maxQty = Math.max(1, ...top.map((t) => t.qty));

  return (
    <>
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center gap-1.5">
            <BarChart3 size={15} className="text-primary" />
            <CardTitle className="text-sm">Ventas por día (últimos 7 días)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="flex items-end gap-1.5 h-28">
            {days.map((d) => (
              <div key={d.key} className="flex-1 h-full flex flex-col justify-end" title={`${d.label}: ${formatCurrency(d.total)}`}>
                <div className="w-full rounded-t bg-primary" style={{ height: `${barHeight(d.total, maxDay)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 mt-1">
            {days.map((d) => (
              <div key={d.key} className="flex-1 text-center text-[10px] text-muted-foreground">
                {d.label}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Total de la semana: {formatCurrency(days.reduce((s, d) => s + d.total, 0))}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center gap-1.5">
            <Clock size={15} className="text-primary" />
            <CardTitle className="text-sm">Ventas por hora (hoy)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="flex items-end gap-0.5 h-24">
            {hours.map((h) => (
              <div key={h.hour} className="flex-1 h-full flex flex-col justify-end" title={`${h.hour}:00 — ${formatCurrency(h.total)}`}>
                <div className="w-full rounded-t bg-primary" style={{ height: `${barHeight(h.total, maxHour)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
            <span>{firstHour}:00</span>
            <span>{lastHour}:00</span>
          </div>
          {maxHour === 0 && <p className="text-xs text-muted-foreground mt-2">Aún no hay ventas hoy.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center gap-1.5">
            <Trophy size={15} className="text-primary" />
            <CardTitle className="text-sm">Top 10 más vendidos (30 días)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {top.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay ventas registradas.</p>}
          {top.map((p, index) => (
            <div key={p.name} className="space-y-0.5">
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate">
                  {index + 1}. {p.name}
                </span>
                <span className="text-muted-foreground flex-shrink-0">
                  {p.qty} pzas. · {formatCurrency(p.revenue)}
                </span>
              </div>
              <div className="h-1.5 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${Math.round((p.qty / maxQty) * 100)}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
