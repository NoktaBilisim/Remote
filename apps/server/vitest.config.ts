import { configDefaults, defineConfig } from "vitest/config";

// Entegrasyon testleri gerçek MySQL ister: TEST_DATABASE_URL (app kullanıcısı). Bkz. scripts/test-db.sh
// P12b: `system_settings.whatsapp` satırını yazan dosya, her uygulama örneğinin açılışta okuduğu paylaşılan satırı
// değiştirir (env WHATSAPP_SERVICE_URL'e güvenen diğer dosyaları etkiler) → ayrı projede, diğerleri bittikten SONRA.
const WHATSAPP_SERIAL = ["test/integration/whatsapp-admin-p12b.test.ts"];
// P13a (B4): bindings-p8c AC-192, settings-p11 ile paylaşılan `system_settings.turn` satırında yarışıyordu → ayrı proje.
const BINDINGS_SERIAL = ["test/integration/bindings-p8c.test.ts"];
// P13a: saklama işi tüm firmalarda + global tablolarda (audit 730 g, giriş oturumları) çalışır; başka dosyalarla eşzamanlı
// koşarsa onların eski tarihli fikstürlerini anonimleştirir/siler → en sona, tek başına.
const RETENTION_SERIAL = ["test/integration/retention-p13a-job.test.ts"];
const SERIAL = [...WHATSAPP_SERIAL, ...BINDINGS_SERIAL, ...RETENTION_SERIAL];

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000, // QA-P8b-1: yük altında (eşzamanlı e2e) DB yoğun testler 20 sn tavanını aşabiliyor
    hookTimeout: 60_000,
    // QA-P8b-1: koşullu bekleme (expect.poll) yük altında (eşzamanlı e2e) 1 sn varsayılanı aşabiliyor; koşul
    // sağlanınca hemen döner, yalnız tavan uzar.
    expect: { poll: { timeout: 10_000 } },
    projects: [
      {
        extends: true,
        test: {
          name: "main",
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...SERIAL],
          sequence: { groupOrder: 0 },
        },
      },
      { extends: true, test: { name: "serial-system-settings", include: WHATSAPP_SERIAL, sequence: { groupOrder: 1 } } },
      { extends: true, test: { name: "serial-bindings", include: BINDINGS_SERIAL, sequence: { groupOrder: 2 } } },
      { extends: true, test: { name: "serial-retention", include: RETENTION_SERIAL, sequence: { groupOrder: 3 } } },
    ],
  },
});
