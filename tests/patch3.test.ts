import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "./helpers/fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-supabase").FakeDb,
  sent: [] as { payload: Record<string, unknown>; options: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/server", () => ({ supabase: { from: (t: string) => h.db.from(t) } }));
vi.mock("@/lib/push", async (orig) => {
  const actual = await orig<typeof import("@/lib/push")>();
  return {
    ...actual,
    sendPush: async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
      h.sent.push({ payload, options });
      return { configured: true, skippedDuplicate: false, attempted: 1, accepted: 1, expired: 0, failed: 0, errors: [] };
    },
  };
});

import { buildLayawayReminder } from "@/lib/layaway-reminders";

const TODAY = "2026-10-22";
const lay = (folio: string, due_date: string, customer_name = "Ana") => ({ folio, customer_name, due_date });

beforeEach(() => {
  h.db = new FakeDb();
  h.sent = [];
  vi.unstubAllEnvs();
});

describe("Aviso de apartados vencidos", () => {
  it("no avisa si nada vence pronto", () => {
    expect(buildLayawayReminder([lay("A-1", "2026-11-30")], TODAY)).toBeNull();
    expect(buildLayawayReminder([], TODAY)).toBeNull();
  });

  it("cuenta vencidos y por vencer (hoy y manana, incluso cambio de mes)", () => {
    const r = buildLayawayReminder(
      [lay("A-1", "2026-10-20"), lay("A-2", TODAY), lay("A-3", "2026-10-23"), lay("A-4", "2026-10-24")],
      TODAY
    )!;
    expect(r.overdue).toBe(1);
    expect(r.dueSoon).toBe(2);
    expect(r.body).toContain("1 vencido y 2 por vencer");
    const eom = buildLayawayReminder([lay("A-9", "2026-11-01")], "2026-10-31")!;
    expect(eom.dueSoon).toBe(1);
  });
});

describe("GET /api/cron/layaways", () => {
  const call = async (auth?: string) => {
    const { GET } = await import("@/app/api/cron/layaways/route");
    return GET(new NextRequest("http://localhost/api/cron/layaways", { headers: auth ? { authorization: auth } : {} }));
  };

  it("sin CRON_SECRET responde 503 y con secreto incorrecto 401", async () => {
    expect((await call()).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "x".repeat(32));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(h.sent).toHaveLength(0);
  });

  it("con secreto correcto avisa una vez por dia, solo de activos, y no toca inventario ni apartados", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    const d = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);
    h.db.seed("layaways", [
      { folio: "A-1", customer_name: "Ana", status: "active", due_date: "2020-01-01" },
      { folio: "A-2", customer_name: "Beto", status: "cancelled", due_date: "2020-01-01" },
      { folio: "A-3", customer_name: "Cris", status: "delivered", due_date: "2020-01-01" },
      { folio: "A-4", customer_name: "Dani", status: "active", due_date: "2099-01-01" },
    ]);
    const before = JSON.stringify(h.db.rows("layaways"));
    const res = await call(`Bearer ${"s".repeat(32)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overdue).toBe(1);
    expect(body.sent).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].options).toMatchObject({ category: "sales", dedupeKey: `layaway-due:${today}` });
    expect(String(h.sent[0].payload.body)).toContain("A-1");
    expect(String(h.sent[0].payload.body)).not.toContain("A-2");
    expect(JSON.stringify(h.db.rows("layaways"))).toBe(before);
  });
});
