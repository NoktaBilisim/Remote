import { defineConfig, devices } from "@playwright/test";

// E2E: üretim derlemesi (gerçek CSP) + sahte API (e2e/mock-api.mjs). Komut: pnpm --filter @remote/web e2e
const PORT = 3217;
export default defineConfig({
  testDir: "e2e",
  // Gerçek sunucu gerektiren entegrasyon testi ayrı config ile koşar (playwright.real.config.ts)
  testIgnore: "p4-real.spec.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // P4: getDisplayMedia/WebRTC için sahte ekran kaynağı ve otomatik izin
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "node e2e/mock-api.mjs", port: 4217, reuseExistingServer: false, env: { MOCK_API_PORT: "4217" } },
    {
      // Üretim imajıyla aynı yol (apps/web/Dockerfile): standalone server.js + static/public kopyası
      command:
        "./node_modules/.bin/next build && cp -R .next/static .next/standalone/apps/web/.next/ && " +
        "cp -R public .next/standalone/apps/web/ && node .next/standalone/apps/web/server.js",
      port: PORT,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        API_INTERNAL_URL: "http://127.0.0.1:4217",
        PUBLIC_BASE_URL: `http://localhost:${PORT}`,
        PORT: String(PORT),
        // Yalnız e2e: gerçek sır DEĞİL. Üretim derlemesi readEdgeSecret() ile >= 32 karakter ister (lib/edge-forward.ts)
        EDGE_PROXY_SECRET: "e2e-only-edge-secret-not-for-production-000",
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
});
