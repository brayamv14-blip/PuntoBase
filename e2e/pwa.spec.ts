import { test, expect, type BrowserContext } from "@playwright/test";

async function login(context: BrowserContext) {
  await context.addCookies([{ name: "pos_device_token", value: "e2e-token", url: "http://localhost:3100" }]);
}

test("manifest instalable y iconos disponibles", async ({ request }) => {
  const res = await request.get("/manifest.json");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBeTruthy();
  const sizes = (m.icons as { sizes: string; purpose?: string }[]).map((i) => `${i.sizes}/${i.purpose ?? "any"}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192/any", "512x512/any", "512x512/maskable"]));
  for (const icon of m.icons as { src: string }[]) expect((await request.get(icon.src)).ok()).toBe(true);
});

test("el service worker no se guarda en cache HTTP y las rutas protegidas piden sesion", async ({ request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");
  expect(sw.headers()["x-content-type-options"]).toBe("nosniff");
  const denied = await request.post("/api/stock/adjust", { data: {} });
  expect([401, 403]).toContain(denied.status());
  const cron = await request.get("/api/cron/layaways");
  expect(cron.status()).toBe(401);
  const cronOk = await request.get("/api/cron/layaways", { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
  expect(cronOk.status()).toBe(200);
});

test("funciona sin conexion: pantalla visitada desde cache y pantalla nueva con aviso amable", async ({ page, context }) => {
  await login(context);
  await page.goto("/pos");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Recarga para que el service worker controle la pagina y guarde la navegacion.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.goto("/dashboard");
  await expect(page.locator("body")).not.toBeEmpty();
  await page.goto("/pos");
  // Espera a que el service worker termine de guardar la pantalla de ayuda sin conexion (precache).
  await page.waitForFunction(async () => {
    for (const name of await caches.keys()) {
      if (await (await caches.open(name)).match("/offline-ayuda")) return true;
    }
    return false;
  });
  await page.waitForTimeout(1500);

  await context.setOffline(true);

  // 1) Pantalla ya visitada: se muestra desde la cache del service worker.
  await page.goto("/pos");
  await expect(page.locator("nav, main, #__next, body").first()).toBeVisible();
  await expect(page.getByText("Sin conexión a internet")).toHaveCount(0);

  // 2) Pantalla nunca abierta: pantalla de ayuda sin conexion (no el dinosaurio del navegador).
  await page.goto("/reports/inventory");
  await expect(page.getByRole("heading", { name: "Sin conexión a internet" })).toBeVisible();

  await context.setOffline(false);
});

test("Ajustes muestra el panel de almacenamiento y sincronizacion del dispositivo", async ({ page, context }) => {
  await login(context);
  await page.goto("/settings");
  await expect(page.getByText("Almacenamiento y sincronización")).toBeVisible();
  await expect(page.getByText("Pendientes de sincronizar")).toBeVisible();
  await expect(page.getByRole("button", { name: /Descargar pendientes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sincronizar ahora/ })).toBeVisible();
});
