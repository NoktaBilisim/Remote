import { defineConfig, devices } from "@playwright/test";

// P4 gerçek sunucu entegrasyonu (e2e/p4-real.spec.ts). Sahte API/WS YOK: web standalone derlemesi /api ve /ws'yi
// gerçek apps/server'a (E2E_REAL_API, varsayılan http://127.0.0.1:3302) yönlendirir. Server + DB + kullanıcılar
// önceden hazır olmalı (docs/implementation.md "Frontend (P4) — Gerçek sunucu entegrasyonu").
// Kurulum: pnpm --filter @remote/web e2e:real:users (DATABASE_URL + E2E_REAL_LOGIN/LOGIN2/PASSWORD; iki ADMIN).
// Script E2E_REAL_ALLOW=1 açık izin bayrağını kendisi geçer; NODE_ENV=production iken veya bayraksız çalışmaz (S-P4-T2-2).
// DATABASE_URL yalnız yerel/staging test DB'sini göstermeli — demo tenant ADMIN parolaları sıfırlanır.
// Komut: E2E_REAL_LOGIN=… E2E_REAL_PASSWORD=… E2E_REAL_LOGIN2=… pnpm --filter @remote/web e2e:real
// Server'ın PUBLIC_BASE_URL'i http://localhost:3218 olmalı (Origin kontrolü + müşteri linki).
const PORT = 3218;
export default defineConfig({
  testDir: "e2e",
  testMatch: "p4-real.spec.ts",
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture"],
    },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_REAL
    ? {
        command:
          "./node_modules/.bin/next build && cp -R .next/static .next/standalone/apps/web/.next/ && " +
          "cp -R public .next/standalone/apps/web/ && node .next/standalone/apps/web/server.js",
        port: PORT,
        timeout: 240_000,
        reuseExistingServer: false,
        env: {
          API_INTERNAL_URL: process.env.E2E_REAL_API ?? "http://127.0.0.1:3302",
          PUBLIC_BASE_URL: `http://localhost:${PORT}`,
          PORT: String(PORT),
          EDGE_PROXY_SECRET: "e2e-only-edge-secret-not-for-production-000",
          HOSTNAME: "0.0.0.0",
        },
      }
    : undefined,
});
