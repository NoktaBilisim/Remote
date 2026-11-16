import { defineConfig, devices } from "@playwright/test";
// P28c K5 test-operatoru turu: sahte API (:4217), history-proxy (:4219), standalone web (:3217) önceden ayakta. webServer yok.
// Çalıştırma: bu dosya apps/web/, zz-k5-p28c.spec.ts apps/web/e2e/ altına geçici kopyalanır, sonra silinir.
export default defineConfig({
  testDir: "e2e",
  testMatch: "zz-k5-p28c.spec.ts",
  workers: 4,
  fullyParallel: true,
  timeout: 120_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3217", trace: "off" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
