import { redirect } from "next/navigation";
import { getDeviceFromCookies } from "@/lib/auth";
import { BottomNav } from "@/components/layout/BottomNav";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { PwaSetup } from "@/components/layout/PwaSetup";
import { CartProvider } from "@/contexts/CartContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const device = await getDeviceFromCookies();
  if (!device) redirect("/setup");

  return (
    <CartProvider>
      <div className="min-h-screen flex flex-col pb-20">
        <OfflineBanner />
        <PwaSetup />
        <main className="flex-1">{children}</main>
        <BottomNav />
      </div>
    </CartProvider>
  );
}
