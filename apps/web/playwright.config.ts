import { defineConfig, devices } from "@playwright/test";

// E2E: üretim derlemesi (gerçek CSP) + sahte API (e2e/mock-api.mjs). Komut: pnpm --filter @remote/web e2e
const PORT = 3217;
const REAL = "p4-real.spec.ts";
const RTC = "p5-collab.spec.ts";
export default defineConfig({
  testDir: "e2e",
  // Gerçek sunucu gerektiren entegrasyon testi ayrı config ile koşar (playwright.real.config.ts)
  testIgnore: REAL,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // P4: getDisplayMedia/WebRTC için sahte ekran kaynağı ve otomatik izin.
    // P5 QA: host adayları mDNS (.local) yerine gerçek IP — mDNS çözümü macOS "Yerel Ağ" iznine/ağa bağlı, e2e'de kararsız.
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--auto-select-desktop-capture-source=Entire screen",
        "--auto-accept-this-tab-capture",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: [REAL, RTC], grepInvert: /@perf/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: [REAL, RTC], grepInvert: /@perf/ },
    // QA P8c-1 Tur 2 #3: P5 işbirliği testleri (iki tarayıcı bağlamı + 1080p sahte yakalama + gerçek P2P DC) tam paralel
    // takımda birbirinin kodlayıcı/CPU payını yiyordu (DC 15 sn'de açılmadı, FPS "—"). Aynı iddialar, en çok 3 eşzamanlı işçi.
    { name: "desktop-rtc", use: { ...devices["Desktop Chrome"] }, testMatch: RTC, grepInvert: /@perf/, workers: 3 },
    // Ölçüm testleri (@perf, ör. AC-41 FPS ≥ 15): eşiği gevşetmeden, diğer projeler BİTTİKTEN sonra tek başına koşar.
    // Not: bağımlı projelerden biri kırmızıysa bu proje "did not run" olur (önce o hata düzeltilir).
    { name: "desktop-perf", use: { ...devices["Desktop Chrome"] }, grep: /@perf/, dependencies: ["desktop", "mobile", "desktop-rtc"] },
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
        // P5: bozuk SHA-256 kancası (globalThis.__rsCorruptSha) yalnız bu derlemede etkin (lib/dc/use-collab.ts)
        NEXT_PUBLIC_RS_E2E: "1",
      },
    },
  ],
});
