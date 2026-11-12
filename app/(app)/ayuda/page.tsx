import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const metadata = { title: "Ayuda · PuntoBase" };

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "Vender sin internet",
    items: [
      "El punto de venta sigue funcionando sin conexión. Las ventas se guardan en el dispositivo y se envían solas al volver internet.",
      "Arriba verás cuántas operaciones faltan por sincronizar. No cierres sesión ni borres los datos del navegador hasta que llegue a cero.",
      "Una venta hecha sin conexión con un precio distinto al catálogo, o sin existencias suficientes, queda marcada «Requiere revisión» para un administrador.",
    ],
  },
  {
    title: "Apartados",
    items: [
      "Crea el apartado con cliente, productos, fecha límite y anticipo: el inventario queda apartado (no se puede vender a otro).",
      "Registra abonos hasta liquidar. Al entregar se cobra el saldo restante. Los apartados necesitan internet.",
      "Un apartado vencido sigue reservando inventario hasta que un administrador lo libere (cancelación con motivo).",
      "Las transferencias de abonos quedan «por confirmar» y no cuentan como dinero cobrado hasta que las confirmes.",
    ],
  },
  {
    title: "Devoluciones",
    items: [
      "En Reportes abre la venta, marca los productos, escribe el motivo y confirma. La venta original nunca se borra.",
      "No se puede devolver más de lo vendido ni repetir una devolución. El inventario se reintegra y la caja y los reportes se ajustan.",
      "Un empleado solo puede devolver ventas del mismo día; un administrador, cualquiera.",
    ],
  },
  {
    title: "Cierre de caja",
    items: [
      "Efectivo esperado = fondo inicial + ventas en efectivo + abonos de apartados en efectivo − devoluciones y reembolsos en efectivo − gastos.",
      "Las transferencias no entran al efectivo. Solo un administrador registra el corte.",
    ],
  },
  {
    title: "Roles",
    items: [
      "Administrador: cambia precios, cancela apartados, cierra caja, ve costos y ganancias, descarga respaldos, administra dispositivos y consulta la bitácora.",
      "Empleado: vende, cobra, registra abonos y devoluciones del día, ajusta inventario y gestiona transferencias.",
      "Los dispositivos nuevos entran como empleado. Un administrador los asciende en Ajustes → Dispositivos.",
    ],
  },
  {
    title: "Respaldo y recuperación",
    items: [
      "Descarga un respaldo en Ajustes → Respaldo (administrador). Hazlo al cerrar cada semana y guárdalo fuera del teléfono.",
      "No contiene códigos de acceso ni claves. Los dispositivos restaurados quedan inactivos y deben registrarse otra vez.",
      "Para restaurar: ejecuta «node scripts/backup-to-sql.mjs respaldo.json > restaurar.sql» y corre el SQL en Supabase. Solo agrega filas que faltan; no borra ni sobrescribe. Pasos completos en docs/MANUAL-TECNICO.md.",
      "Teléfono perdido: un administrador lo desactiva en Ajustes → Dispositivos y pierde el acceso al instante.",
      "Si se borraron los datos del navegador con ventas sin sincronizar, esas ventas no se pueden recuperar desde la app; por eso conviene sincronizar antes de limpiar o cerrar sesión.",
    ],
  },
  {
    title: "Cerrar sesión",
    items: [
      "Ajustes → Cerrar sesión invalida este dispositivo en el servidor y borra los datos locales. Si hay operaciones sin sincronizar te avisa antes.",
      "El único administrador no puede cerrar sesión: primero ascende a otro dispositivo.",
    ],
  },
];

export default function AyudaPage() {
  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="flex items-center gap-2">
        <Link href="/settings" aria-label="Volver" className="p-1 -ml-1"><ChevronLeft size={22} /></Link>
        <h1 className="font-bold text-2xl tracking-tight">Ayuda</h1>
      </div>
      {SECTIONS.map((s) => (
        <section key={s.title} className="bg-card border rounded-xl p-4 space-y-2">
          <h2 className="font-semibold text-sm">{s.title}</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
            {s.items.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
