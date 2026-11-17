import { defineConfig, devices } from "@playwright/test";
// P28f test-operatoru turu: sahte API (:4217) + standalone web (:3217) ve audit için os enjekte eden vekil (:4218) + ikinci web
// (:3218, API_INTERNAL_URL=:4218) önceden ayakta (webServer yok). Bu dosya apps/web/, zz-p28f-op.spec.ts apps/web/e2e/
// altına geçici kopyalanır, sonra silinir. Vekil: scratchpad audit-os-proxy.mjs (kopyası bu klasörde).
export default defineConfig({
  testDir: "e2e",
  testMatch: "zz-p28f-op.spec.ts",
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
