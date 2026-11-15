// P28a K9 sayfa testi (test-operatoru, geçici; kod değil). Sahte yığın elle açık olmalı: mock-api :4217 + standalone :3217.
// Koşu: betikleri apps/web altına geçici kopyala → `pnpm exec playwright test -c <kopya>/k9.config.ts` → kopyayı sil.
import { defineConfig, devices } from "@playwright/test";
const args = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen",
  "--auto-accept-this-tab-capture",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  timeout: 90_000,
  use: { baseURL: "http://localhost:3217", trace: "off", launchOptions: { args } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args } } },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        launchOptions: { args },
      },
    },
  ],
});
