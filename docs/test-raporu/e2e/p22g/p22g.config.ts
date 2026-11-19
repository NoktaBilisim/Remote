import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "p22g-live.spec.ts",
  workers: 1,
  timeout: 300_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3484",
    trace: "off",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns"] },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
