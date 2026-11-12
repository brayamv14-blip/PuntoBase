"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Printer, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useIsAdmin } from "@/contexts/RoleContext";
import { addDays, formatCurrency, todayDateString } from "@/lib/utils";

interface Result {
  grossSales: number; returnsTotal: number; returnsCount: number; netSales: number;
  cashSales: number; transferSales: number; pendingTransfers: number; pendingTransfersCount: number;
  rejectedCount: number; rejectedTotal: number; expenses: number; layawayCollected: number; layawayPending: number;
  netCashFlow: number; transactionCount: number; averageTicket: number; estimatedProfit: number; estimatedCost: number;
  costCoverage: number; byDay: { day: string; total: number }[]; byHour: { hour: number; total: number }[];
  topProducts: { name: string; qty: number; revenue: number; profit: number | null }[];
}
interface Payload {
  from: string; to: string; current: Result; previous: (Result & { period: { from: string; to: string } }) | null;
  comparison: Record<string, number | null> | null;
  restock: { variant_id: string; name: string; stock: number; sold: number; perDay: number; daysLeft: number | null; suggested: number }[];
}

type Preset = "today" | "7d" | "30d" | "month" | "custom";

function range(preset: Preset, custom: { from: string; to: string }) {
  const today = todayDateString();
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: addDays(today, -6), to: today };
  if (preset === "30d") return { from: addDays(today, -29), to: today };
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return custom;
}

export default function AnalyticsPage() {
  const isAdmin = useIsAdmin();
  const [preset, setPreset] = useState<Preset>("7d");
  const [custom, setCustom] = useState(() => ({ from: addDays(todayDateString(), -6), to: todayDateString() }));
  const [compare, setCompare] = useState(true);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const r = range(preset, custom);

  const load = useCallback(async () => {
    if (r.from > r.to) { setError("La fecha inicial no puede ser posterior a la final."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/reports/analytics?from=${r.from}&to=${r.to}${compare ? "&compare=1" : ""}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "No se pudo calcular el análisis."); return; }
      setData(json);
    } catch {
      setError("Sin conexión: el análisis necesita internet.");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.from, r.to, compare]);

  useEffect(() => { if (isAdmin) void load(); }, [load, isAdmin]);

  if (!isAdmin) {
    return <div role="alert" className="p-4 max-w-lg mx-auto text-sm text-muted-foreground">El análisis (costos y ganancias) es solo para administradores.</div>;
  }

  const c = data?.current;
  const maxDay = Math.max(1, ...(c?.byDay.map((d) => Math.abs(d.total)) ?? [1]));
  const maxHour = Math.max(1, ...(c?.byHour.map((h) => h.total) ?? [1]));
  const qs = `from=${r.from}&to=${r.to}`;

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto print:max-w-none">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-bold text-2xl tracking-tight">Análisis</h1>
        <div className="flex gap-1 print:hidden">
          <Button size="sm" variant="outline" onClick={() => window.print()} aria-label="Imprimir o guardar como PDF"><Printer size={15} className="mr-1" aria-hidden />PDF</Button>
        </div>
      </div>

      <div className="space-y-2 print:hidden">
        <div role="group" aria-label="Periodo" className="grid grid-cols-5 gap-1 bg-muted rounded-xl p-1">
          {([["today", "Hoy"], ["7d", "7 días"], ["30d", "30 días"], ["month", "Mes"], ["custom", "Otro"]] as [Preset, string][]).map(([k, label]) => (
            <button key={k} aria-pressed={preset === k} onClick={() => setPreset(k)}
              className={`text-xs py-2 rounded-lg font-medium ${preset === k ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="an-from" className="text-xs">Desde</Label>
              <Input id="an-from" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c0) => ({ ...c0, from: e.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="an-to" className="text-xs">Hasta</Label>
              <Input id="an-to" type="date" value={custom.to} min={custom.from} max={todayDateString()} onChange={(e) => setCustom((c0) => ({ ...c0, to: e.target.value }))} /></div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Comparar con el periodo anterior</label>
      </div>

      <p className="text-xs text-muted-foreground">Periodo: {r.from} a {r.to}{data?.previous ? ` · comparado con ${data.previous.period.from} a ${data.previous.period.to}` : ""}</p>

      {error && (
        <div role="alert" className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-sm flex items-center justify-between gap-2">
          <span>{error}</span><Button size="sm" variant="outline" onClick={load}>Reintentar</Button>
        </div>
      )}
      {loading && !c && <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Calculando"><div className="h-24 bg-muted rounded-xl" /><div className="h-24 bg-muted rounded-xl" /></div>}

      {c && (
        <div className={loading ? "opacity-60" : ""} aria-busy={loading}>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Ventas netas" value={formatCurrency(c.netSales)} delta={data!.comparison?.netSales} />
            <Kpi label="Ganancia estimada" value={formatCurrency(c.estimatedProfit)} delta={data!.comparison?.estimatedProfit} sub={`Costos en ${c.costCoverage}% de lo vendido`} />
            <Kpi label="Ventas cobradas" value={String(c.transactionCount)} delta={data!.comparison?.transactionCount} sub={`Ticket prom. ${formatCurrency(c.averageTicket)}`} />
            <Kpi label="Gastos" value={formatCurrency(c.expenses)} delta={data!.comparison?.expenses} invert />
          </div>
          {c.costCoverage < 100 && (
            <p role="note" className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
              La ganancia solo considera productos con costo registrado ({c.costCoverage}% de las piezas). Captura el costo en Inventario → editar producto para que sea completa.
            </p>
          )}

          <Section title="Dinero cobrado vs. pendiente">
            <Row l="Ventas cobradas (brutas)" v={c.grossSales} />
            <Row l="− Devoluciones" v={-c.returnsTotal} note={`${c.returnsCount}`} />
            <Row l="= Ventas netas" v={c.netSales} bold />
            <Row l="En efectivo (neto)" v={c.cashSales} />
            <Row l="Por transferencia (neto)" v={c.transferSales} />
            <Row l="Apartados cobrados (neto)" v={c.layawayCollected} />
            <Row l="− Gastos" v={-c.expenses} />
            <Row l="= Flujo neto cobrado" v={c.netCashFlow} bold />
            <div className="border-t pt-2 mt-1 space-y-1">
              <Row l="Transferencias por confirmar (no cobradas)" v={c.pendingTransfers} note={`${c.pendingTransfersCount}`} muted />
              <Row l="Abonos de apartado por confirmar" v={c.layawayPending} muted />
              <Row l="Transferencias rechazadas (no cuentan)" v={c.rejectedTotal} note={`${c.rejectedCount}`} muted />
            </div>
          </Section>

          <Section title="Ventas por día (netas)">
            {c.byDay.length === 0 ? <Empty /> : (
              <ul className="space-y-1" aria-label="Ventas por día">
                {c.byDay.map((d) => (
                  <li key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-muted-foreground">{d.day.slice(5)}</span>
                    <span className="flex-1 h-3 bg-muted rounded"><span className="block h-3 rounded bg-primary" style={{ width: `${(Math.max(0, d.total) / maxDay) * 100}%` }} /></span>
                    <span className="w-20 text-right">{formatCurrency(d.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Ventas por hora">
            {c.byHour.length === 0 ? <Empty /> : (
              <ul className="space-y-1" aria-label="Ventas por hora">
                {c.byHour.map((h) => (
                  <li key={h.hour} className="flex items-center gap-2 text-xs">
                    <span className="w-12 shrink-0 text-muted-foreground">{String(h.hour).padStart(2, "0")}:00</span>
                    <span className="flex-1 h-3 bg-muted rounded"><span className="block h-3 rounded bg-primary/70" style={{ width: `${(h.total / maxHour) * 100}%` }} /></span>
                    <span className="w-20 text-right">{formatCurrency(h.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Productos más vendidos">
            {c.topProducts.length === 0 ? <Empty /> : (
              <ol className="space-y-1.5">
                {c.topProducts.map((p, i) => (
                  <li key={p.name} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-muted-foreground">{i + 1}.</span>
                    <span className="flex-1 min-w-0 truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.qty} pzas</span>
                    <span className="w-20 text-right text-xs">{formatCurrency(p.revenue)}</span>
                    <span className="w-16 text-right text-xs text-green-700">{p.profit === null ? "s/costo" : formatCurrency(p.profit)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Sugerencia de resurtido">
            {data!.restock.length === 0 ? <p className="text-sm text-muted-foreground">Nada urgente por resurtir con las ventas de este periodo.</p> : (
              <ul className="space-y-1.5">
                {data!.restock.map((s) => (
                  <li key={s.variant_id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{s.stock} en stock{s.daysLeft !== null ? ` · ~${s.daysLeft} d` : ""}</span>
                    <span className="font-semibold">+{s.suggested}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-2">Estimación para cubrir 14 días al ritmo de venta del periodo; no sustituye tu criterio.</p>
          </Section>

          <Section title="Exportar" className="print:hidden">
            <div className="grid grid-cols-2 gap-2">
              {[["summary", "Resumen"], ["sales", "Ventas"], ["returns", "Devoluciones"], ["layaways", "Apartados"]].map(([t, label]) => (
                <a key={t} href={`/api/reports/export?type=${t}&${qs}`} download
                  className="inline-flex items-center justify-center gap-1.5 border rounded-md h-9 text-sm font-medium hover:bg-muted/50">
                  <Download size={14} aria-hidden /> {label} (CSV)
                </a>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Los CSV se abren directamente en Excel. Para PDF usa «PDF» arriba y elige «Guardar como PDF».</p>
          </Section>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, delta, sub, invert }: { label: string; value: string; delta?: number | null; sub?: string; invert?: boolean }) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className="bg-card border rounded-xl p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {delta != null && (
        <p className={`text-xs flex items-center gap-1 ${good ? "text-green-700" : "text-red-600"}`}>
          {delta >= 0 ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
          {delta > 0 ? "+" : ""}{delta}% <span className="sr-only">frente al periodo anterior</span>
        </p>
      )}
      {delta === null && <p className="text-xs text-muted-foreground">Sin base de comparación</p>}
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-card border rounded-xl p-3 mt-3 space-y-2 break-inside-avoid ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Row({ l, v, bold, muted, note }: { l: string; v: number; bold?: boolean; muted?: boolean; note?: string }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${bold ? "font-bold border-t pt-1" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{l}{note ? ` (${note})` : ""}</span><span>{formatCurrency(v)}</span>
    </div>
  );
}
const Empty = () => <p className="text-sm text-muted-foreground">Sin ventas en este periodo.</p>;
