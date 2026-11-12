"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-center justify-center h-[calc(100vh-80px)] p-8 text-center gap-4 max-w-sm mx-auto">
      <h2 className="font-bold text-xl">Algo salió mal</h2>
      <p className="text-sm text-muted-foreground">
        Ocurrió un error inesperado en esta pantalla. Tus ventas guardadas sin conexión no se pierden.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.push("/dashboard")}>Ir al inicio</Button>
        <Button onClick={reset}>Reintentar</Button>
      </div>
    </div>
  );
}
