
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  fallbacks: {},

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
        urlPattern:
          /\/api\/(products|categories|customers)(?:\/|$|\?)/,
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
};

export default withPWA(nextConfig);
