// P11 veri katmanı (dba): audit_logs tetikleyicileri (mimari §3.3, AC-123) + system_settings CHECK'leri (AC-77, 78).
// Migration 20261113090000_p11_system_settings_audit. İki DB kimliği kullanılır:
//   app      → TEST_DATABASE_URL (uygulama; yetki sınırı)
//   migrator → TEST_MIGRATE_DATABASE_URL (scripts/test-db.sh up export eder; tetikleyiciler yetkiden bağımsız çalışmalı)
// Test DB binlog AÇIK + --log-bin-trust-function-creators=1 (compose ile aynı) — tetikleyici migration'ı bu koşulda geçer.
import { afterAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../src/lib/db.ts";
import { newId } from "../../src/lib/ids.ts";
import { testDb } from "../helpers/app.ts";
import { textQuery } from "../helpers/text-sql.ts";

const migratorUrl = process.env.TEST_MIGRATE_DATABASE_URL;
if (!migratorUrl) throw new Error("TEST_MIGRATE_DATABASE_URL tanımlı değil (scripts/test-db.sh up)");
let mig: Db | undefined;
const migrator = () => (mig ??= createDb(migratorUrl));
const app = () => testDb();
afterAll(async () => { await mig?.$disconnect(); });

async function errorText(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "reddedilmeliydi").toBeInstanceOf(Error);
  return `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
}
/** Metin protokolüyle tek ifade (app) — ortak yardımcı `test/helpers/text-sql.ts` (prepared statement'ta 1295 sorunu). */
const appText = (sql: string): Promise<unknown> => textQuery(process.env.TEST_DATABASE_URL, sql);

const rejectsWith = async (p: Promise<unknown>, needle: RegExp) => expect(await errorText(p)).toMatch(needle);

/** migrator ile audit satırı; `ageHours` saat önce oluşturulmuş (UTC). id döner. */
async function auditRowHours(ageHours: number): Promise<bigint> {
  const tag = `p11.test.${newId()}`;
  await migrator().$executeRawUnsafe(
    "INSERT INTO audit_logs (created_at, action, entity, result) VALUES (UTC_TIMESTAMP(3) - INTERVAL ? HOUR, ?, 'audit_logs', 'success')",
    ageHours, tag,
  );
  const rows = await migrator().$queryRawUnsafe<{ id: bigint }[]>("SELECT id FROM audit_logs WHERE action = ?", tag);
  const row = rows[0];
  if (!row) throw new Error("audit satırı bulunamadı");
  return row.id;
}
const auditRow = (ageDays: number) => auditRowHours(ageDays * 24);

/** Tek bağlantıda (etkileşimli TX) çalıştırır ve her durumda geri alır; oturum değişkenleri sıfırlanır. */
async function inRolledBackTx(db: Db, fn: (tx: Pick<Db, "$executeRawUnsafe" | "$queryRawUnsafe">) => Promise<void>) {
  const ROLLBACK = new Error("rollback");
  await db.$transaction(async (tx) => {
    try { await fn(tx); } finally { await tx.$executeRawUnsafe("SET TIMESTAMP = DEFAULT, time_zone = DEFAULT"); }
    throw ROLLBACK;
  }).catch((e: unknown) => { if (e !== ROLLBACK) throw e; });
}

const APPEND_ONLY = /append-only: UPDATE denied/;
const RETENTION = /older than 730 days/;
const DENIED = /command denied|access denied|1142|1227|1044|1370|1410/i;

describe("P11 audit_logs tetikleyicileri (mimari §3.3)", () => {
  it("tetikleyiciler var ve tanımlayıcısı migrator", async () => {
    const rows = await migrator().$queryRawUnsafe<{ n: string; e: string; t: string; d: string }[]>(
      "SELECT TRIGGER_NAME n, EVENT_MANIPULATION e, ACTION_TIMING t, DEFINER d FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'audit_logs' ORDER BY n",
    );
    expect(rows).toEqual([
      { n: "audit_logs_force_created_at", e: "INSERT", t: "BEFORE", d: "migrator@%" }, // P13a (K-P13-4)
      { n: "audit_logs_no_update", e: "UPDATE", t: "BEFORE", d: "migrator@%" },
      { n: "audit_logs_retention_only_delete", e: "DELETE", t: "BEFORE", d: "migrator@%" },
    ]);
  });

  it("migrator ile bile UPDATE → SIGNAL (yeni ve eski satır)", async () => {
    const fresh = await auditRow(0);
    const old = await auditRow(800);
    await rejectsWith(migrator().$executeRawUnsafe("UPDATE audit_logs SET result = 'fail' WHERE id = ?", fresh), APPEND_ONLY);
    await rejectsWith(migrator().$executeRawUnsafe("UPDATE audit_logs SET action = 'x' WHERE id = ?", old), APPEND_ONLY);
    await rejectsWith(migrator().$executeRawUnsafe("INSERT INTO audit_logs (id, action, entity, result) VALUES (?, 'x', 'x', 'success') ON DUPLICATE KEY UPDATE result = 'fail'", fresh), APPEND_ONLY);
  });

  it("730 günden yeni satır DELETE → SIGNAL (migrator); 729 gün sınırın içinde", async () => {
    for (const age of [0, 365, 729]) {
      const id = await auditRow(age);
      await rejectsWith(migrator().$executeRawUnsafe("DELETE FROM audit_logs WHERE id = ?", id), RETENTION);
    }
  });

  it("SET TIMESTAMP / time_zone ile saat ileri alınsa da yeni satır silinemez (SYSDATE + UTC)", async () => {
    const id = await auditRow(1);
    const edge = await auditRowHours(730 * 24 - 10); // 730 güne 10 saat var: +14:00 oturumunda yerel saatle "eski" görünür
    await inRolledBackTx(migrator(), async (tx) => {
      await tx.$executeRawUnsafe("SET TIMESTAMP = UNIX_TIMESTAMP('2035-01-01 00:00:00')");
      await rejectsWith(tx.$executeRawUnsafe("DELETE FROM audit_logs WHERE id = ?", id), RETENTION);
      await tx.$executeRawUnsafe("SET time_zone = '+14:00'");
      await rejectsWith(tx.$executeRawUnsafe("DELETE FROM audit_logs WHERE id = ?", id), RETENTION);
      await rejectsWith(tx.$executeRawUnsafe("DELETE FROM audit_logs WHERE id = ?", edge), RETENTION);
    });
  });

  it("730 günden eski satır silinebilir (retention yolu; migrator ile)", async () => {
    const id = await auditRow(731);
    await expect(migrator().$executeRawUnsafe("DELETE FROM audit_logs WHERE id = ?", id)).resolves.toBe(1);
  });

  it("AC-123: app kullanıcısı UPDATE yapamaz, tetikleyiciyi düşüremez/değiştiremez, tabloyu değiştiremez", async () => {
    const old = await auditRow(800);
    const denied = [
      `UPDATE audit_logs SET result = 'fail' WHERE id = ${old}`,
      // P13a: DELETE yetkisi var (retention, AC-198); 730 gün sınırı tetikleyicide → retention-p13a.test.ts
      "DROP TRIGGER audit_logs_no_update",
      "DROP TRIGGER audit_logs_force_created_at",
      "DROP TRIGGER audit_logs_retention_only_delete",
      "CREATE TRIGGER audit_logs_p11_x BEFORE DELETE ON audit_logs FOR EACH ROW SET @x = 1",
      "ALTER TABLE audit_logs ADD COLUMN x INT",
      "ALTER TABLE audit_logs DISABLE KEYS",
      "TRUNCATE TABLE audit_logs",
      "DROP TABLE audit_logs",
      "RENAME TABLE audit_logs TO audit_logs_x",
      "GRANT DELETE ON audit_logs TO 'app'@'%'",
    ];
    for (const sql of denied) await rejectsWith(appText(sql), DENIED);
    // app tetikleyici listesini göremez (TRIGGER yetkisi yok) ama tetikleyiciler hâlâ yerinde
    const seen = await app().$queryRawUnsafe<unknown[]>("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = DATABASE()");
    expect(seen).toHaveLength(0);
    const still = await migrator().$queryRawUnsafe<{ c: bigint }[]>("SELECT COUNT(*) c FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'audit_logs'");
    expect(Number(still[0]?.c)).toBe(3); // P11 iki + P13a audit_logs_force_created_at
    // INSERT/SELECT sürer
    await inRolledBackTx(app(), async (tx) => {
      await expect(tx.$executeRawUnsafe("INSERT INTO audit_logs (action, entity, result) VALUES ('p11.test', 'audit_logs', 'success')")).resolves.toBe(1);
    });
  });
});

// system_settings: tüm denemeler app kullanıcısıyla, geri alınan TX içinde (paylaşılan anahtar satırı kalıcı değişmez).
const UPSERT = "INSERT INTO system_settings (`key`, value_json, secret_enc, updated_at) VALUES (?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), secret_enc = VALUES(secret_enc), updated_at = NOW(3)";
const SECRET = Buffer.alloc(61, 7);
const MYSQL_OK = { host: "db.internal", port: 3306, database: "remote_prod", user: "rapor" };

async function upsert(key: string, value: unknown, secret: Buffer | null = null) {
  let out: unknown = null;
  await inRolledBackTx(app(), async (tx) => {
    out = await tx.$executeRawUnsafe(UPSERT, key, value === null ? null : JSON.stringify(value), secret);
  });
  return out;
}
const ok = async (key: string, value: unknown, secret: Buffer | null = null) => expect(await upsert(key, value, secret)).toBeGreaterThanOrEqual(1);
const bad = (key: string, value: unknown, chk: string, secret: Buffer | null = null) => rejectsWith(upsert(key, value, secret), new RegExp(chk));

describe("P11 system_settings CHECK'leri ve yetki (AC-77, 78)", () => {
  it("geçerli mysql ve turn kayıtları", async () => {
    await ok("mysql", MYSQL_OK, SECRET);
    await ok("mysql", { ...MYSQL_OK, host: "10.0.0.5" }); // şifresiz kullanıcı
    await ok("mysql", { ...MYSQL_OK, host: "[2001:db8::5]", database: "nokta-db_1$" });
    await ok("turn", { urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"] }, SECRET);
    await ok("turn", { urls: ["stun:stun.example.com:3478"] }); // yalnız STUN → secret gerekmez
    await ok("turn", { urls: [] });
  });

  it("anahtar kümesi ikili (ADR-0014)", async () => {
    for (const k of ["MYSQL", "mysql ", "Turn", "smtp", "SYSTEM_LOGO", "WHATSAPP", "WhatsApp"]) await bad(k, MYSQL_OK, "system_settings_key_chk");
  });

  it("value_json nesne ≤ 4 KB, secret_enc ≥ 30 bayt", async () => {
    // Dizi: genel CHECK'in yanında anahtar şeması da düşer; MySQL hangisini önce raporlarsa.
    await bad("mysql", [MYSQL_OK], "system_settings_(value_json|mysql)_chk");
    await bad("turn", { urls: ["stun:a.example"], pad: "x".repeat(5000) }, "system_settings_(value_json|turn)_chk");
    await bad("mysql", MYSQL_OK, "system_settings_secret_enc_chk", Buffer.from("düz-şifre"));
  });

  it("mysql şeması: zorunlu alanlar, gizli alan yok, port/host/database/user biçimi", async () => {
    const C = "system_settings_mysql_chk";
    await bad("mysql", null, C);
    await bad("mysql", { host: "db", port: 3306, database: "x" }, C);
    await bad("mysql", { ...MYSQL_OK, password: "açık-şifre" }, C); // gizli değer value_json'a yazılamaz
    await bad("mysql", { ...MYSQL_OK, port: 0 }, C);
    await bad("mysql", { ...MYSQL_OK, port: 65536 }, C);
    await bad("mysql", { ...MYSQL_OK, port: "3306" }, C);
    await bad("mysql", { ...MYSQL_OK, host: "db.internal\n" }, C);
    await bad("mysql", { ...MYSQL_OK, host: "db internal" }, C);
    await bad("mysql", { ...MYSQL_OK, host: "" }, C);
    await bad("mysql", { ...MYSQL_OK, database: "remote;DROP" }, C);
    await bad("mysql", { ...MYSQL_OK, database: "a".repeat(65) }, C);
    await bad("mysql", { ...MYSQL_OK, user: "a".repeat(33) }, C);
    await bad("mysql", { ...MYSQL_OK, user: "rapor\r\n" }, C);
    await bad("mysql", { ...MYSQL_OK, user: "rap​or" }, C);
  });

  it("turn şeması: URL biçimi, en çok 10 tekil, turn:/turns: varken secret zorunlu", async () => {
    const C = "system_settings_turn_chk";
    await bad("turn", null, C);
    await bad("turn", { urls: ["turn:turn.example.com:3478"] }, C); // secret yok
    await bad("turn", { urls: ["stun:a.example", "turns:b.example:5349"] }, C);
    await bad("turn", { urls: ["http://turn.example.com"] }, C, SECRET);
    await bad("turn", { urls: ["turn:turn example.com"] }, C, SECRET);
    await bad("turn", { urls: ["turn:a.example", "turn:a.example"] }, C, SECRET);
    await bad("turn", { urls: Array.from({ length: 11 }, (_, i) => `turn:t${i}.example`) }, C, SECRET);
    await bad("turn", { urls: ["turn:a.example"], secret: "açık" }, C, SECRET);
  });

  it("app: SELECT/INSERT/UPDATE var; DELETE ve DDL yok", async () => {
    await expect(app().$queryRawUnsafe("SELECT `key` FROM system_settings")).resolves.toBeDefined();
    for (const sql of ["DELETE FROM system_settings WHERE `key` = 'mysql'", "ALTER TABLE system_settings ADD COLUMN x INT", "DROP TABLE system_settings", "CREATE TRIGGER ss_x BEFORE UPDATE ON system_settings FOR EACH ROW SET @x = 1"]) {
      await rejectsWith(appText(sql), DENIED);
    }
  });
});
