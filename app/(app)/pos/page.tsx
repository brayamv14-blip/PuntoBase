
"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Banknote, Building2, ShoppingBag } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useCart } from "@/hooks/useCart";
import { apiFetch } from "@/lib/api";
import { enqueueSale, flushQueue } from "@/lib/offline-queue";
import {
  createLocalSaleSnapshot,
  markLocalSaleSynced,
} from "@/lib/local-sales";
import type {
  Customer,
  CartItem,
  DiscountType,
  CreateSaleRequest,
} from "@/types";

export default function PosPage() {
  const router = useRouter();
  const cart = useCart();
  const [checkingOut, setCheckingOut] = useState(false);

  const [customerMode, setCustomerMode] = useState<
    "none" | "search" | "new"
  >("none");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  useEffect(() => {
    let active = true;

    const syncPendingSales = () => {
      if (!navigator.onLine) return;

      void flushQueue(
        (localId, saleId) => {
          void markLocalSaleSynced(localId, saleId)
            .then(() => {
              if (active) {
                toast.success(
                  "Venta pendiente sincronizada correctamente."
                );
              }
            })
            .catch(() => {
              if (active) {
                toast.warning(
                  "La venta se sincronizó, pero no se pudo actualizar el recibo local."
                );
              }
            });
        },
        (_id: string, err: string) => {
          if (active) {
            toast.error(`Error al sincronizar la venta: ${err}`);
          }
        }
      );
    };

    window.addEventListener("online", syncPendingSales);
    syncPendingSales();

    return () => {
      active = false;
      window.removeEventListener("online", syncPendingSales);
    };
  }, []);

  useEffect(() => {
    if (customerMode !== "search" || !customerQuery.trim()) {
      setCustomerResults([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/customers?q=${encodeURIComponent(customerQuery)}`
        );

        if (res.ok) {
          setCustomerResults(await res.json());
        } else {
          setCustomerResults([]);
        }
      } catch {
        setCustomerResults([]);
        if (navigator.onLine) {
          toast.error("No se pudo realizar la búsqueda de clientes.");
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [customerQuery, customerMode]);

  async function handleCheckout() {
    if (!cart.items.length || checkingOut) return;

    setCheckingOut(true);

    const payload: CreateSaleRequest = {
      items: cart.items.map((item) => ({
        item_type: item.item_type,
        product_id: item.product_id,
        variant_id: item.variant_id,
        description: item.description,
        unit_price: item.unit_price,
        qty: item.qty,
      })),
      customer_id: cart.customer_id || undefined,
      customer_name:
        !cart.customer_id && cart.customer_name
          ? cart.customer_name
          : undefined,
      customer_phone:
        !cart.customer_id && cart.customer_phone
          ? cart.customer_phone
          : undefined,
      discount_type: cart.discount_type ?? undefined,
      discount_value: cart.discount_value,
      payment_method: cart.payment_method,
      notes: cart.notes,
    };

    const clientSaleId = `LOCAL-${crypto.randomUUID()}`;

    try {
      if (!navigator.onLine) {
        if (cart.payment_method !== "cash") {
          toast.error(
            "Las transferencias requieren conexión a internet."
          );
          return;
        }

        await createLocalSaleSnapshot(
          clientSaleId,
          payload,
          cart.subtotal,
          cart.total
        );

        await enqueueSale(payload, clientSaleId);

        cart.clear();

        toast.success(
          "Venta guardada localmente. Pendiente de sincronización."
        );

        router.push(`/pos/receipt/${clientSaleId}`);
        return;
      }

      try {
        const res = await apiFetch("/api/sales", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            client_sale_id: clientSaleId,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          toast.error(
            data.error ?? "No se pudo completar la venta."
          );
          return;
        }

        cart.clear();
        router.push(`/pos/receipt/${data.id}`);
      } catch {
        if (cart.payment_method !== "cash") {
          toast.error(
            "No se pudo confirmar el resultado de la transferencia. Verifica la venta antes de volver a cobrar."
          );
          return;
        }

        // Conserva el mismo identificador para el reintento.
        await createLocalSaleSnapshot(
          clientSaleId,
          payload,
          cart.subtotal,
          cart.total
        );

        await enqueueSale(payload, clientSaleId);

        cart.clear();

        toast.warning(
          "Venta guardada localmente. Verifica la sincronización al recuperar internet."
        );

        router.push(`/pos/receipt/${clientSaleId}`);
      }
    } catch {
      toast.error(
        "No se pudo guardar la venta localmente. El carrito se conserva."
      );
    } finally {
      setCheckingOut(false);
    }
  }

  if (cart.items.length === 0) {
    return (
      <div className="max-w-lg mx-auto w-full flex flex-col items-center justify-center h-[calc(100vh-80px)] gap-3 p-4 text-center">
        <ShoppingBag size={48} className="text-muted-foreground" />

        <p className="text-lg font-semibold">El carrito está vacío</p>

        <p className="text-sm text-muted-foreground">
          Agrega productos desde la sección de inventario.
        </p>

        <Link href="/products">
          <Button>Ver inventario</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto w-full flex flex-col h-[calc(100vh-80px)]">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h1 className="font-bold text-xl">Punto de venta</h1>

          <p className="text-xs text-muted-foreground">
            {cart.items.length}{" "}
            {cart.items.length === 1 ? "artículo" : "artículos"}
          </p>
        </div>

        <Link href="/products">
          <Button size="sm" variant="outline">
            + Agregar productos
          </Button>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-5">
          <div className="space-y-2">
            {cart.items.map((item) => (
              <CartItemRow key={item.key} item={item} />
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Cliente</p>

            {cart.customer_name ? (
              <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {cart.customer_name}
                  </p>

                  {cart.customer_phone && (
                    <p className="text-xs text-muted-foreground">
                      {cart.customer_phone}
                    </p>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    cart.setCustomer(null, "", "");
                    setCustomerMode("none");
                  }}
                >
                  Quitar
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setCustomerMode("search")}
                >
                  Buscar
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setCustomerMode("new")}
                >
                  Nuevo cliente
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCustomerMode("none")}
                >
                  Omitir
                </Button>
              </div>
            )}

            {customerMode === "search" && !cart.customer_name && (
              <div className="space-y-1">
                <Input
                  placeholder="Buscar por nombre o teléfono..."
                  value={customerQuery}
                  onChange={(event) =>
                    setCustomerQuery(event.target.value)
                  }
                />

                {customerResults.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    className="w-full text-left p-2 rounded-lg bg-muted/50 text-sm cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => {
                      cart.setCustomer(
                        customer.id,
                        customer.name,
                        customer.phone ?? ""
                      );
                      setCustomerMode("none");
                      setCustomerQuery("");
                    }}
                  >
                    {customer.name}
                    {customer.phone && (
                      <span className="text-muted-foreground">
                        {" "}· {customer.phone}
                      </span>
                    )}
                  </button>
                ))}

                {customerQuery.trim() &&
                  customerResults.length === 0 && (
                    <p className="text-xs text-muted-foreground p-2">
                      No se encontraron clientes.
                    </p>
                  )}
              </div>
            )}

            {customerMode === "new" && !cart.customer_name && (
              <div className="space-y-2">
                <Input
                  placeholder="Nombre del cliente *"
                  value={newCustomerName}
                  onChange={(event) =>
                    setNewCustomerName(event.target.value)
                  }
                  maxLength={150}
                />

                <Input
                  placeholder="Teléfono (opcional)"
                  value={newCustomerPhone}
                  onChange={(event) =>
                    setNewCustomerPhone(event.target.value)
                  }
                  type="tel"
                />

                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    if (!newCustomerName.trim()) {
                      toast.error("Ingresa el nombre del cliente.");
                      return;
                    }

                    cart.setCustomer(
                      null,
                      newCustomerName.trim(),
                      newCustomerPhone.trim()
                    );

                    setCustomerMode("none");
                    setNewCustomerName("");
                    setNewCustomerPhone("");
                  }}
                >
                  Confirmar cliente
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Descuento</p>

            <div className="flex gap-2">
              <Select
                value={cart.discount_type ?? "none"}
                onValueChange={(value) =>
                  cart.setDiscount(
                    value === "none"
                      ? null
                      : (value as DiscountType),
                    cart.discount_value
                  )
                }
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="none">Sin descuento</SelectItem>
                  <SelectItem value="flat">
                    Cantidad fija (MXN)
                  </SelectItem>
                  <SelectItem value="percent">
                    Porcentaje (%)
                  </SelectItem>
                </SelectContent>
              </Select>

              {cart.discount_type && (
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={
                    cart.discount_type === "percent"
                      ? "Porcentaje"
                      : "Importe"
                  }
                  value={cart.discount_value || ""}
                  onChange={(event) =>
                    cart.setDiscount(
                      cart.discount_type,
                      Number(event.target.value)
                    )
                  }
                  className="flex-1"
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Forma de pago</p>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant={
                  cart.payment_method === "cash"
                    ? "default"
                    : "outline"
                }
                className="flex-1 gap-1.5"
                onClick={() => cart.setPayment("cash")}
              >
                <Banknote size={14} /> Efectivo
              </Button>

              <Button
                size="sm"
                variant={
                  cart.payment_method === "bank_transfer"
                    ? "default"
                    : "outline"
                }
                className="flex-1 gap-1.5"
                onClick={() => cart.setPayment("bank_transfer")}
              >
                <Building2 size={14} /> Transferencia
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">Observaciones</p>

            <Input
              placeholder="Nota opcional sobre la venta..."
              value={cart.notes}
              onChange={(event) => cart.setNotes(event.target.value)}
            />
          </div>

          <div className="bg-muted rounded-xl p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{formatCurrency(cart.subtotal)}</span>
            </div>

            {cart.discountAmount > 0 && (
              <div className="flex justify-between text-sm text-red-500">
                <span>Descuento</span>
                <span>−{formatCurrency(cart.discountAmount)}</span>
              </div>
            )}

            <div className="flex justify-between font-bold text-lg border-t pt-1">
              <span>Total a pagar</span>
              <span>{formatCurrency(cart.total)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 border-t bg-background">
        <Button
          className="w-full h-12 text-base"
          onClick={handleCheckout}
          disabled={checkingOut}
        >
          {checkingOut
            ? "Procesando venta..."
            : `Completar venta · ${formatCurrency(cart.total)}`}
        </Button>
      </div>
    </div>
  );
}

function CartItemRow({ item }: { item: CartItem }) {
  const cart = useCart();
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setPriceInput(item.unit_price.toString());
    setEditingPrice(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const value = Number(priceInput);

    if (priceInput.trim() !== "" && Number.isFinite(value) && value >= 0) {
      cart.setPrice(item.key, value);
    }

    setEditingPrice(false);
  }

  return (
    <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {item.description}
        </p>

        {item.category_name === "Pakan" ? (
          editingPrice ? (
            <input
              ref={inputRef}
              type="number"
              min="0"
              step="0.01"
              value={priceInput}
              onChange={(event) =>
                setPriceInput(event.target.value)
              }
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitEdit();
                if (event.key === "Escape") setEditingPrice(false);
              }}
              className="text-xs border rounded px-1 py-0.5 w-28 mt-0.5"
              aria-label={`Precio de ${item.description}`}
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="text-xs text-muted-foreground underline decoration-dashed underline-offset-2 text-left"
              aria-label={`Modificar precio de ${item.description}`}
            >
              {formatCurrency(item.unit_price)}
            </button>
          )
        ) : (
          <span className="text-xs text-muted-foreground">
            {formatCurrency(item.unit_price)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 text-base"
          aria-label={`Disminuir cantidad de ${item.description}`}
          onClick={() => cart.setQty(item.key, item.qty - 1)}
        >
          −
        </Button>

        <span className="w-6 text-center text-sm">{item.qty}</span>

        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 text-base"
          aria-label={`Aumentar cantidad de ${item.description}`}
          onClick={() => cart.setQty(item.key, item.qty + 1)}
        >
          +
        </Button>
      </div>

      <p className="text-sm font-bold w-20 text-right">
        {formatCurrency(item.unit_price * item.qty)}
      </p>

      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-red-500"
        aria-label={`Eliminar ${item.description} del carrito`}
        onClick={() => cart.removeItem(item.key)}
      >
        ×
      </Button>
    </div>
  );
}
