// P12b operatör koşusu: apps/web/playwright.config.ts ile aynı projeler, ancak sahte API (:4217) ve
// üretim derlemesi (:3217) elle başlatılmış olarak yeniden kullanılır (webServer yok).
// Koşu: cd apps/web && ./node_modules/.bin/playwright test -c ../../docs/test-raporu/e2e/p12b/reuse.config.ts p12b-whatsapp p11-admin
import base from "../../../../apps/web/playwright.config";
import { defineConfig } from "@playwright/test";
export default defineConfig({ ...base, testDir: "../../../../apps/web/e2e", webServer: undefined });
