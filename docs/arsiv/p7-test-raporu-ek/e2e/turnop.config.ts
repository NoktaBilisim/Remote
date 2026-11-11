import { defineConfig, devices } from "@playwright/test";
// test-operatoru NAT sonrası TURN ölçümü: gerçek server (:3322, TURN=staging coturn) + standalone web (:3238) önceden ayakta.
export default defineConfig({
  testDir: "e2e",
  testMatch: "turn-olcum.spec.ts",
  workers: 1,
  timeout: 1_200_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3238",
    trace: "off",
    // TURNOP_SPKI: staging TURN-TLS yaprak sertifikasının SPKI sha256'sı (genel anahtar özeti, gizli değil). Staging CA
    // sistem köküne kurulmadan (runbook §9.4) yalnız bu anahtarın sertifikasına güvenilir (AC-23 koşusu için).
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns",
        ...(process.env.TURNOP_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.TURNOP_SPKI}`] : []),
      ],
    },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
