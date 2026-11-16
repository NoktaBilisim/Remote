import { configDefaults, defineConfig } from "vitest/config";

// Entegrasyon testleri gerçek MySQL ister: TEST_DATABASE_URL (app kullanıcısı). Bkz. scripts/test-db.sh
// P12b: `system_settings.whatsapp` satırını yazan dosya, her uygulama örneğinin açılışta okuduğu paylaşılan satırı
// değiştirir (env WHATSAPP_SERVICE_URL'e güvenen diğer dosyaları etkiler) → ayrı projede, diğerleri bittikten SONRA.
const WHATSAPP_SERIAL = ["test/integration/whatsapp-admin-p12b.test.ts"];
// P14a A3: `system_settings` mysql/turn satırlarını yazar (settings-p11 ve bindings-p8c ile paylaşılan satırlar) → ana
// projeyle eşzamanlı koşmaz; whatsapp dosyasıyla aynı seri projede (farklı satırlar, çakışma yok).
// P15: sistem logosu kaldırma (`system_settings.system_logo`, branding-p12 ile paylaşılan satır) → aynı seri proje.
const SYSTEM_SETTINGS_SERIAL = [
  ...WHATSAPP_SERIAL,
  "test/integration/p14a-a3-settings.test.ts",
  "test/integration/system-logo-p15.test.ts",
  // P28b: `system_settings.clamav` (avReady kapısı tüm firmaları etkiler).
  "test/integration/fsrv-p28b-settings.test.ts",
];
// P13a (B4): bindings-p8c AC-192, settings-p11 ile paylaşılan `system_settings.turn` satırında yarışıyordu → ayrı proje.
const BINDINGS_SERIAL = ["test/integration/bindings-p8c.test.ts"];
// P13a: saklama işi tüm firmalarda + global tablolarda (audit 730 g, giriş oturumları) çalışır; başka dosyalarla eşzamanlı
// koşarsa onların eski tarihli fikstürlerini anonimleştirir/siler → en sona, tek başına.
// P16 (AC-240): gece kalıcı silme aynı işin parçası (global adımlar dahil) → aynı seri proje.
// P28b: saklanan dosya mutabakatı (global; bellekte aktarımı olmayan canlı satırları iptal eder) → aynı seri proje.
const RETENTION_SERIAL = [
  "test/integration/retention-p13a-job.test.ts",
  "test/integration/retention-p16-purge.test.ts",
  "test/integration/fsrv-p28b-retention.test.ts",
];
const SERIAL = [...SYSTEM_SETTINGS_SERIAL, ...BINDINGS_SERIAL, ...RETENTION_SERIAL];

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
      { extends: true, test: { name: "serial-system-settings", include: SYSTEM_SETTINGS_SERIAL, sequence: { groupOrder: 1 } } },
      { extends: true, test: { name: "serial-bindings", include: BINDINGS_SERIAL, sequence: { groupOrder: 2 } } },
      // P16: iki saklama dosyası da global adımı (audit 730 g, iş satırları) koşar ve global `retention.run` satırı sayar →
      // proje içinde dosyalar sırayla.
      {
        extends: true,
        test: { name: "serial-retention", include: RETENTION_SERIAL, fileParallelism: false, sequence: { groupOrder: 3 } },
      },
    ],
  },
});
