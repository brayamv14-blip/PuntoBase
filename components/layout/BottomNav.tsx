"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCart } from "@/hooks/useCart";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wallet,
  Banknote,
  BarChart2,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/pos", label: "Punto de venta", icon: ShoppingCart },
  { href: "/products", label: "Inventario", icon: Package },
  { href: "/expenses", label: "Gastos", icon: Wallet },
  { href: "/transfers", label: "Transferencias", icon: ArrowLeftRight },
  { href: "/eod", label: "Cierre de caja", icon: Banknote },
  { href: "/reports", label: "Reportes", icon: BarChart2 },
];

export function BottomNav() {
  const pathname = usePathname();
  const cart = useCart();
  const cartCount = cart.items.length;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border safe-area-inset-bottom">
      <div className="flex overflow-x-auto scrollbar-hide px-1 py-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          const isPOS = item.href === "/pos";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center flex-1 min-w-[50px] py-1.5 px-1 text-[10px] gap-0.5 rounded-xl transition-colors",
                active
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="relative">
                <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
                {isPOS && cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-destructive text-destructive-foreground rounded-full min-w-[14px] h-[14px] text-[9px] flex items-center justify-center font-bold px-0.5">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </div>
              <span className="leading-none">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
