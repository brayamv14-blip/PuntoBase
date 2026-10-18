"use client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link2, ShoppingCart } from "lucide-react";

async function shareOrCopy(title: string, text: string, okMessage: string) {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch (error) {
    // El usuario cancelo el cuadro de compartir: no es un error.
    if (error instanceof DOMException && error.name === "AbortError") return;
    toast.error("No se pudo compartir. Copia el texto manualmente.");
  }
}

export function ShoppingListButton({ items }: { items: { name: string; stock_qty: number }[] }) {
  function handleClick() {
    const date = new Date().toLocaleDateString("es-MX");
    const lines = items.map((i) => `• ${i.name} — ${i.stock_qty === 0 ? "AGOTADO" : `quedan ${i.stock_qty}`}`);
    void shareOrCopy(
      "Lista de compras",
      `Lista de compras (${date})\n${lines.join("\n")}`,
      "Lista de compras copiada."
    );
  }

  return (
    <Card>
      <CardContent className="px-3 py-3 flex items-center justify-between gap-3">
        <p className="text-sm">
          {items.length} producto{items.length === 1 ? "" : "s"} por resurtir
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleClick}>
          <ShoppingCart size={14} /> Lista de compras
        </Button>
      </CardContent>
    </Card>
  );
}

export function CatalogLinkButton() {
  function handleClick() {
    const url = `${window.location.origin}/catalogo`;
    void shareOrCopy("Catálogo", `Mira nuestro catálogo: ${url}`, "Enlace del catálogo copiado.");
  }

  return (
    <Card>
      <CardContent className="px-3 py-3 flex items-center justify-between gap-3">
        <p className="text-sm">Catálogo web para tus clientes</p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleClick}>
          <Link2 size={14} /> Compartir enlace
        </Button>
      </CardContent>
    </Card>
  );
}
