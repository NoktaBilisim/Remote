import { configDefaults, defineConfig } from "vitest/config";

// Entegrasyon testleri gerçek MySQL ister: TEST_DATABASE_URL (app kullanıcısı). Bkz. scripts/test-db.sh
// P12b: `system_settings.whatsapp` satırını yazan dosya, her uygulama örneğinin açılışta okuduğu paylaşılan satırı
// değiştirir (env WHATSAPP_SERVICE_URL'e güvenen diğer dosyaları etkiler) → ayrı projede, diğerleri bittikten SONRA.
const SERIAL = ["test/integration/whatsapp-admin-p12b.test.ts"];

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000, // QA-P8b-1: yük altında (eşzamanlı e2e) DB yoğun testler 20 sn tavanını aşabiliyor
    hookTimeout: 60_000,
    // QA-P8b-1: koşullu bekleme (expect.poll) yük altında (eşzamanlı e2e) 1 sn varsayılanı aşabiliyor; koşul
    // sağlanınca hemen döner, yalnız tavan uzar.
    expect: { poll: { timeout: 10_000 } },
    projects: [
      { extends: true, test: { name: "main", include: ["test/**/*.test.ts"], exclude: [...configDefaults.exclude, ...SERIAL], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "serial-system-settings", include: SERIAL, sequence: { groupOrder: 1 } } },
    ],
  },
});
