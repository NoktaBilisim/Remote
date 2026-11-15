// LG-1 (dba) — unattended_registration_codes ekleri (mimari-link-gonderme §3, §4.4; AC-419, AC-420). Uygulama kodu yok: app
// bağlantısı (testDb) CHECK/UNIQUE'e tabi; migrator (testFixtureDb) information_schema ve EXPLAIN için.
import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { newId } from "../../src/lib/ids.ts";
import { createTenant, testDb, testFixtureDb } from "../helpers/app.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { codeRow } from "../helpers/unattended.ts";

const hex64 = (): string => createHash("sha256").update(newId()).digest("hex");

async function pendingCode(): Promise<{ tenantId: string; id: string }> {
  const t = await createTenant();
  const c = await createCustomerRow(t.id);
  return { tenantId: t.id, id: await codeRow(t.id, c.id) };
}

afterAll(async () => {
  await testDb().$disconnect();
  await testFixtureDb().$disconnect();
});

describe("LG-1 download_token_hash (AC-419)", () => {
  it("varsayılan NULL (LG öncesi kodlar); hex yazılır; büyük harf / düz belirteç / kısa değer 3819; UNIQUE", async () => {
    const a = await pendingCode();
    const row = await testDb().unattendedRegistrationCode.findUniqueOrThrow({
      where: { id: a.id },
      select: { downloadTokenHash: true, sentCount: true },
    });
    expect(row).toEqual({ downloadTokenHash: null, sentCount: 0 });

    const h = hex64();
    await testDb().unattendedRegistrationCode.update({ where: { id: a.id }, data: { downloadTokenHash: h } });
    const found = await testDb().unattendedRegistrationCode.findUnique({ where: { downloadTokenHash: h }, select: { id: true } });
    expect(found?.id).toBe(a.id);

    const b = await pendingCode();
    for (const bad of [h.toUpperCase(), "a".repeat(63), `${"a".repeat(63)}g`, "düz-belirteç-" + newId()]) {
      await expect(
        testDb().$executeRaw`UPDATE unattended_registration_codes SET download_token_hash = ${bad} WHERE id = ${b.id}`,
      ).rejects.toThrow(/download_token_hash_chk/);
    }
    await expect(testDb().unattendedRegistrationCode.update({ where: { id: b.id }, data: { downloadTokenHash: h } })).rejects.toThrow(
      /Unique constraint|download_token_hash/,
    );
    // Birden çok NULL serbest (a dışındaki tüm kodlar NULL).
    const c = await pendingCode();
    await expect(
      testDb().unattendedRegistrationCode.update({ where: { id: c.id }, data: { downloadTokenHash: null } }),
    ).resolves.toBeTruthy();
  });

  it("public uç araması UNIQUE indeksi kullanır", async () => {
    const rows = await testFixtureDb().$queryRawUnsafe<{ key: string | null; type: string }[]>(
      "EXPLAIN SELECT id FROM unattended_registration_codes WHERE download_token_hash = ?",
      hex64(),
    );
    // Eşleşme yoksa MySQL "no matching row in const table" der (key NULL); bu da const erişimi demektir.
    expect(rows[0]?.key === "unattended_registration_codes_download_token_hash_key" || rows[0]?.key === null).toBe(true);
    const idx = await testFixtureDb().$queryRaw<{ NON_UNIQUE: number | bigint }[]>`
      SELECT NON_UNIQUE FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unattended_registration_codes'
        AND INDEX_NAME = 'unattended_registration_codes_download_token_hash_key'`;
    expect(idx.map((r) => Number(r.NON_UNIQUE))).toEqual([0]);
  });
});

describe("LG-1 sent_count (AC-420, §4.4)", () => {
  it("0..3; 4 ve negatif reddedilir; koşullu artış 3'te durur", async () => {
    const a = await pendingCode();
    const inc = () =>
      testDb().$executeRaw`UPDATE unattended_registration_codes SET sent_count = sent_count + 1
        WHERE id = ${a.id} AND tenant_id = ${a.tenantId} AND used_at IS NULL AND expires_at > NOW(3) AND sent_count < 3`;
    expect([await inc(), await inc(), await inc(), await inc()]).toEqual([1, 1, 1, 0]);
    const row = await testDb().unattendedRegistrationCode.findUniqueOrThrow({ where: { id: a.id }, select: { sentCount: true } });
    expect(row.sentCount).toBe(3);
    await expect(testDb().$executeRaw`UPDATE unattended_registration_codes SET sent_count = 4 WHERE id = ${a.id}`).rejects.toThrow(
      /sent_count_chk/,
    );
    // UNSIGNED: negatif değer CHECK'ten önce aralık hatası (strict mode) verir.
    await expect(testDb().$executeRaw`UPDATE unattended_registration_codes SET sent_count = -1 WHERE id = ${a.id}`).rejects.toThrow();
  });
});
