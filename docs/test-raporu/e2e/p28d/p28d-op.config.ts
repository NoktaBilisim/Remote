import { defineConfig, devices } from "@playwright/test";
// P28d test-operatoru turu: sahte API (:4217) ve standalone web (:3217) önceden ayakta (webServer yok).
// Çalıştırma: bu dosya apps/web/, zz-p28d-op.spec.ts apps/web/e2e/ altına geçici kopyalanır, sonra silinir.
export default defineConfig({
  testDir: "e2e",
  testMatch: "zz-p28d-op.spec.ts",
  workers: 3,
  fullyParallel: true,
  timeout: 150_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3217",
    trace: "off",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
