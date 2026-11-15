// P13a veri katmanı (dba): migration 20261114120000_p13a_retention + grants.sql P13a satırları (mimari-p13 §2, K-P13-1..4;
// AC-197, AC-198). İki DB kimliği: app (TEST_DATABASE_URL, uygulama) ve migrator (TEST_MIGRATE_DATABASE_URL; geçmiş
// tarihli fikstür — tetikleyici muafiyeti). Paylaşılan satırlara dokunan denemeler geri alınan TX içinde.
import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb, testFixtureDb } from "../helpers/app.ts";
import { PRIVILEGE_DENIED } from "../helpers/text-sql.ts";

const app = () => testDb();
const migrator = () => testFixtureDb();
afterAll(async () => {
  await testFixtureDb().$disconnect();
});

async function errorText(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "reddedilmeliydi").toBeInstanceOf(Error);
  return `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
}
const rejectsWith = async (p: Promise<unknown>, needle: RegExp) => expect(await errorText(p)).toMatch(needle);
const RETENTION = /older than 730 days/;
const COLUMN_DENIED = /command denied.*column|1143/i;

/** Tek bağlantıda çalıştırır ve her durumda geri alır; oturum değişkenleri sıfırlanır. */
async function inRolledBackTx(db: Db, fn: (tx: Pick<Db, "$executeRawUnsafe" | "$queryRawUnsafe">) => Promise<void>) {
  const ROLLBACK = new Error("rollback");
  await db
    .$transaction(async (tx) => {
      try {
        await fn(tx);
      } finally {
        await tx.$executeRawUnsafe("SET TIMESTAMP = DEFAULT, time_zone = DEFAULT");
      }
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
}

const createdAtOf = async (db: Pick<Db, "$queryRawUnsafe">, id: bigint) =>
  (await db.$queryRawUnsafe<{ c: Date }[]>("SELECT created_at c FROM audit_logs WHERE id = ?", id))[0]?.c;
const lastId = async (db: Pick<Db, "$queryRawUnsafe">) =>
  BigInt((await db.$queryRawUnsafe<{ i: bigint }[]>("SELECT LAST_INSERT_ID() i"))[0]?.i ?? 0n);
const nearNow = (d: Date | undefined) => expect(Math.abs((d?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);

describe("P13a audit_logs created_at zorlaması (K-P13-4, AC-198)", () => {
  it("app'in verdiği geçmiş created_at yok sayılır, DB saati (UTC) yazılır — Prisma ve ham SQL", async () => {
    const row = await app().auditLog.create({
      data: { action: "p13a.test", entity: "audit_logs", result: "success", createdAt: new Date("2020-01-01T00:00:00Z") },
      select: { id: true, createdAt: true },
    });
    nearNow(row.createdAt);
    nearNow(await createdAtOf(app(), row.id));
    await inRolledBackTx(app(), async (tx) => {
      await tx.$executeRawUnsafe(
        "INSERT INTO audit_logs (created_at, action, entity, result) VALUES ('2099-01-01 00:00:00.000', 'p13a.test', 'audit_logs', 'success')",
      );
      nearNow(await createdAtOf(tx, await lastId(tx))); // gelecek tarih de zorlanır
    });
  });

  it("SET TIMESTAMP ve oturum time_zone'u zorlanan değeri etkilemez (SYSDATE + UTC)", async () => {
    await inRolledBackTx(app(), async (tx) => {
      await tx.$executeRawUnsafe("SET TIMESTAMP = UNIX_TIMESTAMP('2020-01-01 00:00:00'), time_zone = '+14:00'");
      await tx.$executeRawUnsafe("INSERT INTO audit_logs (action, entity, result) VALUES ('p13a.test', 'audit_logs', 'success')");
      const id = await lastId(tx);
      await tx.$executeRawUnsafe("SET TIMESTAMP = DEFAULT, time_zone = '+00:00'");
      nearNow(await createdAtOf(tx, id));
    });
  });

  it("migrator muaf: geçmiş tarihli fikstür ve geri yükleme özgün created_at'i korur", async () => {
    const row = await migrator().auditLog.create({
      data: { action: "p13a.test", entity: "audit_logs", result: "success", createdAt: new Date("2021-06-01T12:00:00Z") },
      select: { id: true },
    });
    expect((await createdAtOf(migrator(), row.id))?.toISOString()).toBe("2021-06-01T12:00:00.000Z");
  });
});

describe("P13a audit_logs DELETE (retention yolu, AC-198)", () => {
  const oldRow = async (days: number) =>
    (
      await migrator().auditLog.create({
        data: { action: "p13a.del", entity: "audit_logs", result: "success", createdAt: new Date(Date.now() - days * 86_400_000) },
        select: { id: true },
      })
    ).id;

  it("app 730 günden eski satırı siler; 729 gün ve yeni satır SIGNAL", async () => {
    const old = await oldRow(731);
    await expect(app().$executeRawUnsafe("DELETE FROM audit_logs WHERE id = ?", old)).resolves.toBe(1);
    for (const days of [729, 0])
      await rejectsWith(app().$executeRawUnsafe("DELETE FROM audit_logs WHERE id = ?", await oldRow(days)), RETENTION);
  });

  it("app geriye tarihli satır ekleyip hemen silemez (ekle-sil açığı kapalı)", async () => {
    const row = await app().auditLog.create({
      data: { action: "p13a.del", entity: "audit_logs", result: "success", createdAt: new Date("2019-01-01T00:00:00Z") },
      select: { id: true },
    });
    await rejectsWith(app().auditLog.deleteMany({ where: { id: row.id } }), RETENTION);
  });

  it("toplu silmede tek yeni satır tüm ifadeyi geri alır (parti atomik)", async () => {
    const a = await oldRow(800);
    const b = await oldRow(10);
    await rejectsWith(app().auditLog.deleteMany({ where: { id: { in: [a, b] } } }), RETENTION);
    expect(await app().auditLog.count({ where: { id: { in: [a, b] } } })).toBe(2);
  });
});

describe("P13a app yetkileri (grants.sql, K27)", () => {
  async function endedSession() {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const s = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" });
    return { tenantId: t.id, userId: u.id, id: s.id };
  }

  it("session_consents: yalnız ip/user_agent UPDATE; karar/seviye/kaynak/metin özeti/zaman 1143", async () => {
    const s = await endedSession();
    const c = await app().sessionConsent.create({
      data: {
        id: newId(),
        sessionId: s.id,
        tenantId: s.tenantId,
        level: "CONTROL",
        decision: "GRANTED",
        source: "UI",
        ip: "203.0.113.7",
        userAgent: "ua",
      },
    });
    await expect(app().sessionConsent.updateMany({ where: { sessionId: s.id }, data: { ip: null, userAgent: null } })).resolves.toEqual({
      count: 1,
    });
    const row = await app().sessionConsent.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ ip: null, userAgent: null, level: "CONTROL", decision: "GRANTED", source: "UI" });
    for (const data of [
      { level: "VIEW" },
      { decision: "DENIED" },
      { source: "SYSTEM" },
      { consentSha256: null },
      { createdAt: new Date() },
    ]) {
      await rejectsWith(app().sessionConsent.updateMany({ where: { id: c.id }, data }), COLUMN_DENIED);
    }
    await rejectsWith(app().$executeRawUnsafe("DELETE FROM session_consents WHERE id = ?", c.id), PRIVILEGE_DENIED);
  });

  it("session_files DELETE izinli (anonimleştirmede satır silinir), UPDATE yok", async () => {
    const s = await endedSession();
    await app().sessionFile.create({
      data: {
        id: newId(),
        sessionId: s.id,
        tenantId: s.tenantId,
        direction: "TO_TECH",
        fileName: "rapor.pdf",
        sizeBytes: 10n,
        sha256: "a".repeat(64),
        result: "OK",
      },
    });
    await rejectsWith(app().$executeRawUnsafe("UPDATE session_files SET file_name = 'x' WHERE session_id = ?", s.id), PRIVILEGE_DENIED);
    await expect(app().sessionFile.deleteMany({ where: { sessionId: s.id } })).resolves.toEqual({ count: 1 });
  });

  it("password_reset_tokens DELETE izinli (+7 gün); süre/hash UPDATE hâlâ yok", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const tok = await app().passwordResetToken.create({
      data: { id: newId(), userId: u.id, tokenHash: sha256Hex(newId()), expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    await rejectsWith(
      app().passwordResetToken.updateMany({ where: { id: tok.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } }),
      COLUMN_DENIED,
    );
    await expect(app().passwordResetToken.deleteMany({ where: { id: tok.id } })).resolves.toEqual({ count: 1 });
  });

  it("K27: support_sessions, session_consents, support_requests, device_bindings, customers DELETE yok (hard delete Sonra)", async () => {
    for (const table of [
      "support_sessions",
      "session_consents",
      "support_requests",
      "device_bindings",
      "customers",
      "request_refs",
      "consent_texts",
      "system_settings",
    ]) {
      await rejectsWith(app().$executeRawUnsafe(`DELETE FROM ${table} WHERE 1 = 0`), PRIVILEGE_DENIED);
    }
  });
});

describe("P13a support_sessions.anonymized_at + support_sessions_anonymized_chk (AC-197)", () => {
  const C = /support_sessions_anonymized_chk/;
  const PII = { customerName: "Ayşe Yılmaz", customerEmail: "ayse@example.test", note: "gizli not" };
  const ANON = { customerName: null, customerEmail: null, note: null, guestNetKey: null, guestIpKey: null };
  async function session(status: "ACTIVE" | "ENDED" | "EXPIRED" | "CANCELLED" | "PENDING") {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const s = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status });
    return { tenantId: t.id, id: s.id };
  }
  const upd = (s: { id: string; tenantId: string }, data: Record<string, unknown>) =>
    app().supportSession.updateMany({ where: { id: s.id, tenantId: s.tenantId }, data });

  it("bitmiş oturum anonimleşir; ticket no, mod, kalite özeti kalır", async () => {
    const s = await session("ENDED");
    await upd(s, {
      ...PII,
      ticketNo: "INC-9",
      guestNetKey: "203.0.113.0/24",
      guestIpKey: "203.0.113.7",
      qualitySummary: { connType: "relay" },
    });
    await upd(s, { ...ANON, anonymizedAt: new Date() });
    const row = await app().supportSession.findFirstOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ ...ANON, ticketNo: "INC-9", mode: "BROWSER", qualitySummary: { connType: "relay" } });
    expect(row.anonymizedAt).toBeInstanceOf(Date);
    for (const status of ["EXPIRED", "CANCELLED"] as const) await upd(await session(status), { anonymizedAt: new Date() });
  });

  it("PENDING/ACTIVE oturum anonimleşemez; kişisel alan bırakılırsa 3819", async () => {
    for (const status of ["PENDING", "ACTIVE"] as const) await rejectsWith(upd(await session(status), { anonymizedAt: new Date() }), C);
    const s = await session("ENDED");
    await upd(s, PII);
    for (const keep of ["customerName", "customerEmail", "note"] as const) {
      const data: Record<string, unknown> = { ...ANON, anonymizedAt: new Date() };
      data[keep] = PII[keep];
      if (keep === "customerEmail") data.customerName = PII.customerName; // e-posta CHECK'i adı ister
      await rejectsWith(upd(s, data), C);
    }
  });

  it("anonim oturuma kişisel veri yeniden yazılamaz (PATCH 409'un DB savunması)", async () => {
    const s = await session("ENDED");
    await upd(s, { anonymizedAt: new Date() });
    for (const data of [{ note: "yeni not" }, { customerName: "Ali Veli" }]) await rejectsWith(upd(s, data), C);
    await expect(upd(s, { ticketNo: "INC-10" })).resolves.toEqual({ count: 1 }); // ticket no kişisel veri değil
  });

  it("retention aday indeksi IX(tenant_id, anonymized_at, created_at) var", async () => {
    const cols = await migrator().$queryRawUnsafe<{ c: string }[]>(
      "SELECT COLUMN_NAME c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_sessions' AND INDEX_NAME = 'support_sessions_tenant_id_anonymized_at_created_at_idx' ORDER BY SEQ_IN_INDEX",
    );
    expect(cols.map((r) => r.c)).toEqual(["tenant_id", "anonymized_at", "created_at"]);
  });
});
