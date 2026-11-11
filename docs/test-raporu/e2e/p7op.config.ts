import { defineConfig, devices } from "@playwright/test";
// P7 test-operatoru turu: sahte API/WS (:4217) + standalone web (:3217, NEXT_PUBLIC_RS_E2E=1) önceden ayakta. webServer yok.
// Çalıştırma: bu dosya ve p7-op.spec.ts apps/web/ ve apps/web/e2e/ altına geçici kopyalanır.
export default defineConfig({
  testDir: "e2e",
  testMatch: "p7-op.spec.ts",
  workers: 4,
  fullyParallel: true,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3217",
    trace: "off",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns"] },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
