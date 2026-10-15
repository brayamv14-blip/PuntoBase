"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export default function SetupPage() {
  const router = useRouter();
  const [isFirstSetup, setIsFirstSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch("/api/setup")
      .then((r) => r.json())
      .then((d) => setIsFirstSetup(!d.setup_complete));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !accessCode.trim()) return toast.error("All fields are required");

    setLoading(true);
    try {
      const res = await apiFetch("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          access_code: accessCode,
          name: name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? "Setup failed");

      toast.success("Device registered!");
      router.replace("/dashboard");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (isFirstSetup === null) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading…</p></div>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">PuntoBase</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isFirstSetup ? "First-time store configuration" : "Register this device"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Your Name</Label>
            <Input
              id="name"
              placeholder="e.g. Ahmad"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="access_code">{isFirstSetup ? "Set Access Code" : "Access Code"}</Label>
            <Input
              id="access_code"
              type="password"
              placeholder={isFirstSetup ? "Create a store access code" : "Enter store access code"}
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Setting up…" : isFirstSetup ? "Set Up Store" : "Register Device"}
          </Button>
        </form>
      </div>
    </div>
  );
}
