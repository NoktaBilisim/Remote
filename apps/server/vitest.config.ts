import { defineConfig } from "vitest/config";

// Entegrasyon testleri gerçek MySQL ister: TEST_DATABASE_URL (app kullanıcısı). Bkz. scripts/test-db.sh
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
