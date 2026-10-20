
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  fallbacks: {},
  customWorkerSrc: "worker",

  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  extendDefaultRuntimeCaching: true,

  // No forzar una pantalla única cuando falla una navegación.
  // Las rutas que no estén guardadas localmente todavía
  // necesitarán una implementación offline específica.

  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        // Fotos de productos (Cloudinary): visibles sin conexion tras la primera carga.
        urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "product-images",
          expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        urlPattern:
          /\/api\/(products|categories)(?:\/|$|\?)/,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "api-cache",
          expiration: {
            maxAgeSeconds: 60 * 60 * 24,
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  turbopack: {},
  allowedDevOrigins: ["192.168.1.89"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // La camara (escaner) solo para este origen.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        // El Service Worker nunca debe quedar en la cache HTTP: asi las versiones nuevas se instalan.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default withPWA(nextConfig);
