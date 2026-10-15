import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center gap-4">
      <h2 className="font-bold text-xl">Page not found</h2>
      <p className="text-sm text-muted-foreground">This page doesn&apos;t exist.</p>
      <Link href="/dashboard">
        <Button>Ir a la pagina de inicio</Button>
      </Link>
    </div>
  );
}
