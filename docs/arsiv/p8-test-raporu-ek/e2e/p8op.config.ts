import { defineConfig, devices } from "@playwright/test";
// P8 test-operatoru turu: sahte API (:4217) + standalone web (:3217, NEXT_PUBLIC_RS_E2E=1) önceden ayakta. webServer yok.
// Çalıştırma: bu dosya ve p8-op.spec.ts apps/web/ ve apps/web/e2e/ altına geçici kopyalanır.
export default defineConfig({
  testDir: "e2e",
  testMatch: "p8-op.spec.ts",
  workers: 4,
  fullyParallel: true,
  timeout: 240_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3217", trace: "off" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
