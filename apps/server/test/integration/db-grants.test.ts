import { describe, expect, it } from "vitest";
import { testDb } from "../helpers/app.ts";

// Testler uygulamanın kullandığı `app` DB kullanıcısıyla (TEST_DATABASE_URL) çalışır.
describe("app DB kullanıcısı yetki sınırı", () => {
  it("AC-123: app kullanıcısı audit_logs'ta UPDATE, DDL ve tetikleyici işlemi yapamaz", async () => {
    const db = testDb();
    const denied = [
      "UPDATE audit_logs SET action = 'x' WHERE id = 0",
      "ALTER TABLE audit_logs ADD COLUMN x INT",
      "DROP TRIGGER IF EXISTS audit_logs_no_update",
      "CREATE TRIGGER t_x BEFORE INSERT ON audit_logs FOR EACH ROW SET NEW.action = NEW.action",
      "DROP TABLE audit_logs",
      "CREATE TABLE x_yetki_testi (id INT)",
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('x','x','x',NOW(),0)",
    ];
    for (const sql of denied) await expect(db.$executeRawUnsafe(sql), sql).rejects.toThrow();
    await expect(db.$queryRawUnsafe("SELECT COUNT(*) FROM audit_logs")).resolves.toBeDefined();
  });
});
