import { defineConfig, devices } from "@playwright/test";
// P5 test-operatoru turu: gerçek server (:3312) + standalone web (:3228) önceden ayakta. webServer yok.
export default defineConfig({
  testDir: "e2e",
  testMatch: "p5-op.spec.ts",
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3228",
    trace: "off",
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns"] },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});
