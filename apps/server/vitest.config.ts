import { defineConfig } from "vitest/config";

// Entegrasyon testleri gerçek MySQL ister: TEST_DATABASE_URL (app kullanıcısı). Bkz. scripts/test-db.sh
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000, // QA-P8b-1: yük altında (eşzamanlı e2e) DB yoğun testler 20 sn tavanını aşabiliyor
    hookTimeout: 60_000,
    // QA-P8b-1: koşullu bekleme (expect.poll) yük altında (eşzamanlı e2e) 1 sn varsayılanı aşabiliyor; koşul
    // sağlanınca hemen döner, yalnız tavan uzar.
    expect: { poll: { timeout: 10_000 } },
  },
});
