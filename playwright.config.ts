import { defineConfig } from "@playwright/test";

// Pruebas en navegador real (Chromium) sobre la build de produccion.
// Uso:  npm run build && npm run test:e2e
// No necesita Supabase real: levanta un servidor falso (e2e/stub-supabase.mjs).
const PORT = 3100;
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, serviceWorkers: "allow" },
  webServer: [
    { command: "node e2e/stub-supabase.mjs", url: "http://127.0.0.1:54321/rest/v1/devices", reuseExistingServer: true },
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/setup`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-e2e",
        SUPABASE_SERVICE_ROLE_KEY: "service-e2e",
        CRON_SECRET: "e2e-cron-secret-0123456789",
      },
    },
  ],
});
