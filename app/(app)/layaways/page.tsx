"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Plus, Trash2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useIsAdmin } from "@/contexts/RoleContext";
import { formatCurrency, formatDateTime, todayDateString, addDays } from "@/lib/utils";

type View = "active" | "expired" | "delivered" | "cancelled";
type Method = "cash" | "bank_transfer";

interface Payment { id: string; kind: "payment" | "refund"; method: Method; amount: number; payment_status: "paid" | "pending" | "rejected"; created_at: string }
interface Item { id: string; description: string; qty: number; unit_price: number; line_total: number }
interface Layaway {
  id: string; folio: string; customer_name: string; customer_phone: string | null; status: string; view: View;
  total: number; due_date: string; notes: string | null; cancel_reason: string | null; created_at: string;
  items: Item[]; payments: Payment[]; paid: number; pending: number; balance: number; dueNow: number;
}
interface Variant { id: string; size_label: string; price: number; stock_qty: number }
interface Product { id: string; name: string; track_stock: boolean; variants: Variant[] }

const TABS: { key: View; label: string }[] = [
  { key: "active", label: "Activos" }, { key: "expired", label: "Vencidos" },
  { key: "delivered", label: "Entregados" }, { key: "cancelled", label: "Cancelados" },
];
const METHOD_LABEL: Record<Method, string> = { cash: "Efectivo", bank_transfer: "Transferencia" };

async function post(path: string, body: unknown) {
  const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export default function LayawaysPage() {
  const [view, setView] = useState<View>("active");
  const [rows, setRows] = useState<Layaway[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/layaways?view=${view}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setError(json.error ?? "No se pudieron cargar los apartados."); return; }
        setError(null);
        setRows(json.data);
      } catch {
        if (!cancelled) setError("Sin conexión: los apartados necesitan internet.");
      }
    })();
    return () => { cancelled = true; };
  }, [view, reloadKey]);

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-bold text-2xl tracking-tight">Apartados</h1>
        <Button size="sm" onClick={() => setCreating((v) => !v)} disabled={!online} aria-expanded={creating}>
          <Plus size={16} className="mr-1" aria-hidden /> Nuevo
        </Button>
      </div>

      {!online && (
        <div role="status" className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">
          <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>Sin conexión. Los apartados se crean y cobran solo en línea para no reservar el mismo inventario dos veces.</span>
        </div>
      )}

      {creating && online && (
        <NewLayaway onDone={() => { setCreating(false); setView("active"); void load(); }} onCancel={() => setCreating(false)} />
      )}

      <div role="tablist" aria-label="Estado del apartado" className="grid grid-cols-4 gap-1 bg-muted rounded-xl p-1">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={view === t.key} onClick={() => { setRows(null); setError(null); setView(t.key); }}
            className={`text-xs py-2 rounded-lg font-medium ${view === t.key ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-sm flex items-center justify-between gap-2">
          <span>{error}</span><Button size="sm" variant="outline" onClick={() => { setError(null); load(); }}>Reintentar</Button>
        </div>
      )}
      {!rows && !error && (
        <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Cargando apartados">
          {[0, 1].map((i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className="text-center py-10 text-muted-foreground space-y-2">
          <CalendarClock size={28} className="mx-auto" aria-hidden />
          <p className="text-sm">No hay apartados {TABS.find((t) => t.key === view)!.label.toLowerCase()}.</p>
        </div>
      )}
      <ul className="space-y-3">
        {rows?.map((l) => <LayawayCard key={l.id} l={l} online={online} onChanged={load} />)}
      </ul>
    </div>
  );
}

// ── Nuevo apartado ───────────────────────────────────────────────────────────
function NewLayaway({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<{ variant: Variant; name: string; track: boolean; qty: number }[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [due, setDue] = useState(() => addDays(todayDateString(), 14));
  const [deposit, setDeposit] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [opId] = useState(() => `lay-${crypto.randomUUID()}`);

  useEffect(() => {
    apiFetch("/api/products").then((r) => r.json()).then(setProducts).catch(() => toast.error("No se pudo cargar el catálogo."));
  }, []);

  const total = useMemo(() => lines.reduce((s, l) => s + l.variant.price * l.qty, 0), [lines]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !products) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [products, search]);

  function add(p: Product, v: Variant) {
    setLines((cur) => cur.some((l) => l.variant.id === v.id) ? cur
      : [...cur, { variant: v, name: v.size_label ? `${p.name} (${v.size_label})` : p.name, track: p.track_stock, qty: 1 }]);
    setSearch("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const dep = Number(deposit);
    if (!name.trim()) return toast.error("Indica el nombre del cliente.");
    if (lines.length === 0) return toast.error("Agrega al menos un producto.");
    if (!(dep > 0)) return toast.error("El anticipo debe ser mayor a 0.");
    if (dep > total) return toast.error("El anticipo no puede ser mayor al total.");
    if (lines.some((l) => l.track && l.qty > l.variant.stock_qty)) return toast.error("Hay productos sin existencias suficientes.");
    if (!window.confirm(`Crear apartado por ${formatCurrency(total)} con anticipo de ${formatCurrency(dep)}? El inventario quedará apartado.`)) return;
    setSaving(true);
    try {
      const { ok, json } = await post("/api/layaways", {
        customer_name: name.trim(), customer_phone: phone.trim() || undefined, due_date: due, notes: notes.trim() || undefined,
        deposit: dep, deposit_method: method, client_op_id: opId,
        items: lines.map((l) => ({ variant_id: l.variant.id, qty: l.qty })),
      });
      if (!ok) { toast.error(json.error ?? "No se pudo crear el apartado."); return; }
      toast.success(`Apartado ${json.folio} creado.`);
      onDone();
    } catch {
      toast.error("Sin conexión. Inténtalo de nuevo cuando vuelva internet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-card border rounded-xl p-3 space-y-3" aria-label="Nuevo apartado">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label htmlFor="l-name" className="text-xs">Cliente *</Label>
          <Input id="l-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="l-phone" className="text-xs">Teléfono</Label>
          <Input id="l-phone" type="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>

      <div className="space-y-1 relative">
        <Label htmlFor="l-search" className="text-xs">Producto</Label>
        <Input id="l-search" placeholder="Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        {!products && <p className="text-xs text-muted-foreground">Cargando catálogo…</p>}
        {matches.length > 0 && (
          <ul className="border rounded-lg divide-y bg-background max-h-56 overflow-auto">
            {matches.flatMap((p) => p.variants.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => add(p, v)} disabled={p.track_stock && v.stock_qty <= 0}
                  className="w-full text-left p-2 text-sm flex justify-between gap-2 disabled:opacity-50">
                  <span className="truncate">{p.name}{v.size_label ? ` (${v.size_label})` : ""}</span>
                  <span className="text-muted-foreground shrink-0">{formatCurrency(v.price)}{p.track_stock ? ` · ${v.stock_qty} disp.` : ""}</span>
                </button>
              </li>
            )))}
          </ul>
        )}
      </div>

      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((l) => (
            <li key={l.variant.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate">{l.name}</span>
              <Input type="number" min={1} max={l.track ? l.variant.stock_qty : 9999} value={l.qty} className="w-16 h-8" aria-label={`Cantidad de ${l.name}`}
                onChange={(e) => setLines((cur) => cur.map((x) => x.variant.id === l.variant.id ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x))} />
              <span className="w-20 text-right">{formatCurrency(l.variant.price * l.qty)}</span>
              <button type="button" aria-label={`Quitar ${l.name}`} className="p-1 text-muted-foreground"
                onClick={() => setLines((cur) => cur.filter((x) => x.variant.id !== l.variant.id))}><Trash2 size={15} /></button>
            </li>
          ))}
          <li className="flex justify-between font-bold text-sm border-t pt-1.5"><span>Total</span><span>{formatCurrency(total)}</span></li>
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label htmlFor="l-due" className="text-xs">Fecha límite *</Label>
          <Input id="l-due" type="date" min={todayDateString()} max={addDays(todayDateString(), 180)} value={due} onChange={(e) => setDue(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="l-dep" className="text-xs">Anticipo *</Label>
          <Input id="l-dep" type="number" inputMode="decimal" min="0.01" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} required /></div>
      </div>
      <div className="space-y-1"><Label htmlFor="l-method" className="text-xs">Pago del anticipo</Label>
        <select id="l-method" value={method} onChange={(e) => setMethod(e.target.value as Method)} className="w-full h-10 rounded-md border bg-background px-3 text-sm">
          <option value="cash">Efectivo</option><option value="bank_transfer">Transferencia (queda pendiente de confirmar)</option>
        </select></div>
      <div className="space-y-1"><Label htmlFor="l-notes" className="text-xs">Notas</Label>
        <Input id="l-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" className="flex-1" disabled={saving}>{saving ? "Guardando…" : "Crear apartado"}</Button>
      </div>
    </form>
  );
}

// ── Tarjeta de apartado ──────────────────────────────────────────────────────
function LayawayCard({ l, online, onChanged }: { l: Layaway; online: boolean; onChanged: () => void }) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<null | "pay" | "deliver" | "cancel">(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  const [opId] = useState(() => `lp-${crypto.randomUUID()}`);

  const actionable = l.status === "active";
  const badge = l.view === "expired" ? <Badge variant="destructive">Vencido</Badge>
    : l.view === "delivered" ? <Badge variant="secondary">Entregado</Badge>
    : l.view === "cancelled" ? <Badge variant="outline">Cancelado</Badge> : <Badge>Activo</Badge>;

  async function run(fn: () => Promise<{ ok: boolean; json: { error?: string } }>, okMsg: string) {
    setBusy(true);
    try {
      const { ok, json } = await fn();
      if (!ok) { toast.error(json.error ?? "No se pudo completar la acción."); if (json.error) onChanged(); return; }
      toast.success(okMsg);
      setMode(null); setAmount(""); setReason("");
      onChanged();
    } catch {
      toast.error("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const pay = () => {
    const a = Number(amount);
    if (!(a > 0)) return toast.error("Indica el monto del abono.");
    if (a > l.balance) return toast.error(`El abono excede el saldo (${formatCurrency(l.balance)}).`);
    if (!window.confirm(`Registrar abono de ${formatCurrency(a)} en ${METHOD_LABEL[method].toLowerCase()}?`)) return;
    void run(() => post("/api/layaways/pay", { layaway_id: l.id, amount: a, method, client_op_id: `${opId}-pay` }), "Abono registrado.");
  };
  const deliver = () => {
    const txt = l.dueNow > 0 ? `Se cobrarán ${formatCurrency(l.dueNow)} y se entregará el apartado.` : "El apartado está liquidado. ¿Entregar?";
    if (!window.confirm(txt)) return;
    void run(() => post("/api/layaways/deliver", { layaway_id: l.id, final_method: l.dueNow > 0 ? method : undefined, client_op_id: `${opId}-del` }), "Apartado entregado.");
  };
  const cancel = () => {
    if (reason.trim().length < 3) return toast.error("Indica el motivo.");
    if (!window.confirm(`Cancelar ${l.folio}? El inventario se libera${refund && l.paid > 0 ? ` y se reembolsan ${formatCurrency(l.paid)}` : l.paid > 0 ? `; el cliente pierde ${formatCurrency(l.paid)} de abonos` : ""}.`)) return;
    void run(() => post("/api/layaways/cancel", { layaway_id: l.id, reason: reason.trim(), refund, refund_method: method, client_op_id: `${opId}-can` }), "Apartado cancelado e inventario liberado.");
  };
  const resolve = (paymentId: string, action: "confirm" | "reject") => {
    if (!window.confirm(action === "confirm" ? "¿Ya viste el depósito en tu banco?" : "¿Rechazar esta transferencia?")) return;
    void run(() => post("/api/layaways/confirm", { payment_id: paymentId, action }), action === "confirm" ? "Transferencia confirmada." : "Transferencia rechazada.");
  };

  return (
    <li className="bg-card border rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full p-3 text-left space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm flex-1">{l.folio} · {l.customer_name}</span>{badge}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Vence {l.due_date}</span><span>Total {formatCurrency(l.total)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-green-700">Abonado {formatCurrency(l.paid)}{l.pending > 0 ? ` (+${formatCurrency(l.pending)} por confirmar)` : ""}</span>
          <span className="font-semibold">Falta {formatCurrency(l.dueNow)}</span>
        </div>
      </button>

      {open && (
        <div className="border-t p-3 space-y-3 text-sm">
          {l.customer_phone && <p className="text-xs text-muted-foreground">Tel. {l.customer_phone}</p>}
          {l.notes && <p className="text-xs text-muted-foreground">Nota: {l.notes}</p>}
          {l.cancel_reason && <p className="text-xs text-muted-foreground">Motivo de cancelación: {l.cancel_reason}</p>}
          <ul className="space-y-1">
            {l.items.map((i) => <li key={i.id} className="flex justify-between"><span>{i.qty} × {i.description}</span><span>{formatCurrency(i.line_total)}</span></li>)}
          </ul>
          <div>
            <p className="text-xs font-medium mb-1">Pagos</p>
            <ul className="space-y-1">
              {l.payments.length === 0 && <li className="text-xs text-muted-foreground">Sin pagos.</li>}
              {l.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="flex-1">{p.kind === "refund" ? "Reembolso" : "Abono"} · {METHOD_LABEL[p.method]} · {formatDateTime(p.created_at)}</span>
                  <span className={p.kind === "refund" ? "text-red-600" : ""}>{p.kind === "refund" ? "−" : ""}{formatCurrency(p.amount)}</span>
                  {p.payment_status === "pending" && actionable && (
                    <span className="flex gap-1">
                      <Button size="sm" className="h-7 px-2" disabled={busy || !online} onClick={() => resolve(p.id, "confirm")}>Confirmar</Button>
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy || !online} onClick={() => resolve(p.id, "reject")}>Rechazar</Button>
                    </span>
                  )}
                  {p.payment_status === "pending" && !actionable && <Badge variant="outline">Pendiente</Badge>}
                  {p.payment_status === "rejected" && <Badge variant="outline">Rechazado</Badge>}
                </li>
              ))}
            </ul>
          </div>

          {actionable && !mode && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" disabled={!online || l.balance <= 0} onClick={() => setMode("pay")}>Abonar</Button>
              <Button size="sm" disabled={!online} onClick={() => setMode("deliver")}>Entregar</Button>
              {isAdmin && <Button size="sm" variant="destructive" disabled={!online} onClick={() => setMode("cancel")}>{l.view === "expired" ? "Liberar" : "Cancelar"}</Button>}
            </div>
          )}

          {mode === "pay" && (
            <div className="space-y-2">
              <Label htmlFor={`amt-${l.id}`} className="text-xs">Monto (máx. {formatCurrency(l.balance)})</Label>
              <Input id={`amt-${l.id}`} type="number" inputMode="decimal" min="0.01" step="0.01" max={l.balance} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <MethodSelect id={`m-${l.id}`} value={method} onChange={setMethod} />
              <Buttons busy={busy} onCancel={() => setMode(null)} onOk={pay} label="Registrar abono" />
            </div>
          )}
          {mode === "deliver" && (
            <div className="space-y-2">
              {l.pending > 0 && l.dueNow > 0 && <p role="note" className="text-xs text-amber-700">Hay una transferencia pendiente de confirmar: confírmala antes de entregar.</p>}
              {l.dueNow > 0 && <>
                <p className="text-xs">Saldo a cobrar ahora: <b>{formatCurrency(l.dueNow)}</b></p>
                <MethodSelect id={`d-${l.id}`} value={method} onChange={setMethod} />
                {method === "bank_transfer" && <p className="text-xs text-muted-foreground">Con transferencia el saldo queda pendiente; entrega cuando la confirmes.</p>}
              </>}
              <Buttons busy={busy} onCancel={() => setMode(null)} onOk={deliver} label="Entregar" />
            </div>
          )}
          {mode === "cancel" && (
            <div className="space-y-2">
              <Label htmlFor={`r-${l.id}`} className="text-xs">Motivo *</Label>
              <Input id={`r-${l.id}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={l.view === "expired" ? "Vencido, el cliente no regresó" : "Motivo de la cancelación"} />
              {l.paid > 0 && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
                  Reembolsar {formatCurrency(l.paid)} al cliente (si no, se conservan los abonos)
                </label>
              )}
              {refund && l.paid > 0 && <MethodSelect id={`c-${l.id}`} value={method} onChange={setMethod} />}
              <Buttons busy={busy} onCancel={() => setMode(null)} onOk={cancel} label="Confirmar cancelación" destructive />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function MethodSelect({ id, value, onChange }: { id: string; value: Method; onChange: (m: Method) => void }) {
  return (
    <select id={id} aria-label="Método de pago" value={value} onChange={(e) => onChange(e.target.value as Method)} className="w-full h-10 rounded-md border bg-background px-3 text-sm">
      <option value="cash">Efectivo</option><option value="bank_transfer">Transferencia</option>
    </select>
  );
}
function Buttons({ busy, onCancel, onOk, label, destructive }: { busy: boolean; onCancel: () => void; onOk: () => void; label: string; destructive?: boolean }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>Volver</Button>
      <Button size="sm" variant={destructive ? "destructive" : "default"} className="flex-1" onClick={onOk} disabled={busy}>{busy ? "Procesando…" : label}</Button>
    </div>
  );
}
