import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Archivos generados por next-pwa en cada build (no se editan a mano).
    "public/sw.js",
    "public/swe-worker-*.js",
    "public/workbox-*.js",
    "public/worker-*.js",
  ]),
]);

export default eslintConfig;
