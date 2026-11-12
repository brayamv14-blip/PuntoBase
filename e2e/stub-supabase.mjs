// Servidor falso con la forma minima de la API REST de Supabase (PostgREST).
// Solo sirve para las pruebas del navegador: permite abrir la app SIN una base real.
// - Tabla "devices": devuelve un dispositivo administrador activo.
// - Cualquier otra tabla: lista vacia. Escrituras: aceptadas sin guardar nada.
import http from "node:http";

const DEVICE = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Caja E2E",
  role: "admin",
  is_active: true,
  device_token: "e2e-token",
  last_seen_at: null,
  created_at: new Date().toISOString(),
};

export function startStub(port = 54321) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const table = url.pathname.replace("/rest/v1/", "").split("/")[0];
    const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    req.resume();
    req.on("end", () => {
      if (req.method !== "GET" && req.method !== "HEAD") return send(req.method === "POST" ? 201 : 204);
      if (table === "devices") return wantsObject ? send(200, DEVICE) : send(200, [DEVICE]);
      if (wantsObject) return send(406, { code: "PGRST116", message: "no rows", details: null, hint: null });
      return send(200, []);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startStub(Number(process.env.STUB_PORT ?? 54321));
  console.log("Stub de Supabase en http://127.0.0.1:" + (process.env.STUB_PORT ?? 54321));
}
