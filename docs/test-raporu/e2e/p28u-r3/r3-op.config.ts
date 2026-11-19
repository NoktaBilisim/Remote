import { defineConfig, devices } from "@playwright/test";
// P28u r3 R6 test-operatoru turu: sahte API (:4217) + standalone web (:3217) önceden ayakta (webServer yok; derleme mevcut e2e
// koşusundan). Bu dosya apps/web/, zz-r3-p28u.spec.ts apps/web/e2e/ altına geçici kopyalanır, sonra silinir.
export default defineConfig({
  testDir: "e2e",
  testMatch: "zz-r3-p28u.spec.ts",
  workers: 4,
  fullyParallel: true,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3217",
    trace: "off",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
