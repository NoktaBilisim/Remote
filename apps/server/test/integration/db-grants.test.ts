import { describe, expect, it } from "vitest";
import { testDb } from "../helpers/app.ts";
import { PRIVILEGE_DENIED, rejectionText, textQuery } from "../helpers/text-sql.ts";

// Testler uygulamanın kullandığı `app` DB kullanıcısıyla (TEST_DATABASE_URL) çalışır.
// P11 (dba bulgusu): CREATE/DROP TRIGGER prepared statement protokolünde 1295 döndüğünden `$executeRawUnsafe` yetkiyi
// gerçekte sınamıyordu (yanlış pozitif). Tüm ifadeler metin protokolüyle çalıştırılır ve hata YETKİ reddi olmalıdır.
describe("app DB kullanıcısı yetki sınırı", () => {
  it("AC-123: app kullanıcısı audit_logs'ta UPDATE, DDL ve tetikleyici işlemi yapamaz (yetki reddi, 1295 değil)", async () => {
    const denied = [
      "UPDATE audit_logs SET action = 'x' WHERE id = 0",
      "ALTER TABLE audit_logs ADD COLUMN x INT",
      "DROP TRIGGER IF EXISTS audit_logs_no_update",
      "DROP TRIGGER audit_logs_retention_only_delete",
      "CREATE TRIGGER t_x BEFORE INSERT ON audit_logs FOR EACH ROW SET NEW.action = NEW.action",
      "DROP TABLE audit_logs",
      "CREATE TABLE x_yetki_testi (id INT)",
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('x','x','x',NOW(),0)",
    ];
    for (const sql of denied) {
      const text = await rejectionText(textQuery(process.env.TEST_DATABASE_URL, sql));
      expect(text, sql).not.toMatch(/1295|not supported in the prepared statement/i);
      expect(text, sql).toMatch(PRIVILEGE_DENIED);
    }
    await expect(testDb().$queryRawUnsafe("SELECT COUNT(*) FROM audit_logs")).resolves.toBeDefined();
  });
});
