// P18 H1 (dba) — DB düzeyi kurallar (mimari-e11 §8b.1, §8b.13; AC-255..258; S-P18-T5/T11). Uygulama kodu yok: app bağlantısı
// (testDb) tetikleyici/yetki/CHECK'e tabi, migrator (testFixtureDb) fikstür ve geçmiş tarihleme için (tetikleyiciden muaf).
import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { isP16Signal } from "../../src/lib/db.ts";
import { newId } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb, testFixtureDb } from "../helpers/app.ts";
import { createRequestRow } from "../helpers/requests.ts";

const blob = (chars: number): Uint8Array<ArrayBuffer> => new Uint8Array(29 + chars);

async function message(tenantId: string, o: { requestId?: string; sessionId?: string; techId?: string }): Promise<string> {
  const id = newId();
  await testDb().sessionMessage.create({
    data: {
      id,
      tenantId,
      requestId: o.requestId ?? null,
      sessionId: o.sessionId ?? null,
      sender: o.techId ? "TECH" : "CUSTOMER",
      senderUserId: o.techId ?? null,
      bodyEnc: blob(3),
      bodyChars: 3,
    },
  });
  return id;
}

/** Talebi kapatıp anonimleştirir (app; retention UPDATE'i ile aynı alanlar, DB saati). */
const anonymizeRequest = (tx: Prisma.TransactionClient, id: string) =>
  tx.$executeRaw`UPDATE support_requests SET status = 'EXPIRED', closed_at = UTC_TIMESTAMP(3), customer_name = NULL,
    customer_phone = NULL, customer_email = NULL, description = NULL, ip = NULL, ip_key = NULL, net_key = NULL,
    device_hash = NULL, anonymized_at = UTC_TIMESTAMP(3) WHERE id = ${id}`;

const del = (id: string) => testDb().$executeRaw`DELETE FROM session_messages WHERE id = ${id}`;

afterAll(async () => {
  await testDb().$disconnect();
  await testFixtureDb().$disconnect();
});

describe("P18 H1 session_messages_delete_guard (ADR-0025 m.3)", () => {
  it("AC-255: anonim olmayan talebin mesajı DELETE → p18 SIGNAL; aynı TX'te anonimleşince silinir", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const r = await createRequestRow(t.id);
    const m = await message(t.id, { requestId: r.id, techId: u.id });
    await expect(del(m)).rejects.toSatisfy(isP16Signal);
    await testDb().$transaction(async (tx) => {
      await anonymizeRequest(tx, r.id);
      expect(await tx.$executeRaw`DELETE FROM session_messages WHERE tenant_id = ${t.id} AND request_id IN (${r.id})`).toBe(1);
    });
  });

  it("S-P18-T11: iki bağlı satır — yalnız talep (ya da yalnız oturum) anonimken SIGNAL, ikisi anonimken OK", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const r = await createRequestRow(t.id);
    const s = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED" });
    const m = await message(t.id, { requestId: r.id, sessionId: s.id });
    await testDb().$transaction((tx) => anonymizeRequest(tx, r.id));
    await expect(del(m)).rejects.toSatisfy(isP16Signal);
    await testFixtureDb().$executeRaw`UPDATE support_sessions SET customer_name = NULL, customer_email = NULL, note = NULL,
      anonymized_at = UTC_TIMESTAMP(3) WHERE id = ${s.id}`;
    await expect(del(m)).resolves.toBe(1);
  });

  it("AC-242: RUNNING firma silme işinde (PASSIVE ≥ 30 g) DELETE OK; SCHEDULED iş kilidi açmaz", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const r = await createRequestRow(t.id);
    const m = await message(t.id, { requestId: r.id });
    const job = newId();
    await testFixtureDb()
      .$executeRaw`UPDATE tenants SET status = 'PASSIVE', passive_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY WHERE id = ${t.id}`;
    await testFixtureDb().$executeRaw`INSERT INTO tenant_purge_jobs (id, tenant_id, state, step, scheduled_for, counts, preview_hash,
      started_by, updated_at) VALUES (${job}, ${t.id}, 'SCHEDULED', 'FENCE', UTC_TIMESTAMP(3), JSON_OBJECT(), SHA2(${job}, 256), ${u.id},
      UTC_TIMESTAMP(3))`;
    await expect(del(m)).rejects.toSatisfy(isP16Signal);
    await testFixtureDb()
      .$executeRaw`UPDATE tenant_purge_jobs SET state = 'RUNNING', step = 'MESSAGES', started_at = UTC_TIMESTAMP(3) WHERE id = ${job}`;
    await expect(del(m)).resolves.toBe(1);
    // Adım MESSAGES → REQUEST_UNLINK (+1) izinli, atlama yok (update_guard yeni sırayla).
    await expect(testDb().$executeRaw`UPDATE tenant_purge_jobs SET step = 'BINDINGS' WHERE id = ${job}`).rejects.toSatisfy(isP16Signal);
    await expect(testDb().$executeRaw`UPDATE tenant_purge_jobs SET step = 'REQUEST_UNLINK' WHERE id = ${job}`).resolves.toBe(1);
    await testFixtureDb().$executeRaw`DELETE FROM tenant_purge_jobs WHERE id = ${job}`;
  });

  it("app session_messages / business_holidays UPDATE edemez (1142)", async () => {
    await expect(testDb().$executeRaw`UPDATE session_messages SET body_chars = 1 WHERE id = '-'`).rejects.toThrow(/denied/i);
    await expect(testDb().$executeRaw`UPDATE business_holidays SET name = 'x' WHERE id = '-'`).rejects.toThrow(/denied/i);
  });
});

describe("P18 H1 CHECK / FK", () => {
  it("TECH mesajında sender_user_id zorunlu; düz metin gövde uzunluk kuralına takılır", async () => {
    const t = await createTenant();
    const r = await createRequestRow(t.id);
    const base = { id: newId(), tenantId: t.id, requestId: r.id, bodyEnc: blob(3), bodyChars: 3 };
    await expect(testDb().sessionMessage.create({ data: { ...base, sender: "TECH" } })).rejects.toThrow(/sender_user_chk/);
    await expect(
      testDb().sessionMessage.create({ data: { ...base, sender: "CUSTOMER", bodyEnc: new Uint8Array(Buffer.from("abc")) } }),
    ).rejects.toThrow(/body_enc_chk/);
  });

  it("S-P18-T5: başka tenant kullanıcısına ve Super Admin'e atama → FK (1452); aynı tenant OK", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const mine = await createUser({ tenantId: t.id });
    const foreign = await createUser({ tenantId: other.id });
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const r = await createRequestRow(t.id);
    const assign = (userId: string) =>
      testDb().$executeRaw`UPDATE support_requests SET assigned_to = ${userId}, assigned_at = UTC_TIMESTAMP(3) WHERE id = ${r.id}`;
    await expect(assign(foreign.id)).rejects.toThrow(/foreign key/i);
    await expect(assign(sa.id)).rejects.toThrow(/foreign key/i);
    await expect(assign(mine.id)).resolves.toBe(1);
  });

  it("AC-257/258: öncelik enum, SLA aralığı, business_hours şeması ve gün içi sıra", async () => {
    const t = await createTenant();
    const r = await createRequestRow(t.id);
    await expect(testDb().$executeRaw`UPDATE support_requests SET priority = 'URGENT' WHERE id = ${r.id}`).rejects.toThrow(/priority_chk/);
    await expect(testDb().$executeRaw`UPDATE support_requests SET sla_minutes = 4 WHERE id = ${r.id}`).rejects.toThrow(/sla_minutes_chk/);
    await testDb().$executeRaw`INSERT INTO tenant_request_settings (tenant_id, request_ref, file_label, wa_recipients, email_recipients,
      trusted_cidrs, updated_at) VALUES (${t.id}, ${`pzzh${t.id
        .slice(-12)
        .toLowerCase()
        .replace(/[^a-z2-7]/g, "a")}`}, 'P18', '[]', '[]', '[]', UTC_TIMESTAMP(3))`;
    const set = (json: string) =>
      testDb().$executeRaw`UPDATE tenant_request_settings SET business_hours = CAST(${json} AS JSON) WHERE tenant_id = ${t.id}`;
    const day = (x: string) => `[${x},[],[],[],[],[],[]]`;
    await expect(set(day(`[{"from":"09:00","to":"12:00"},{"from":"13:00","to":"24:00"}]`))).resolves.toBe(1);
    await expect(set(`[[],[],[],[],[],[],[],[]]`)).rejects.toThrow(/business_hours_chk/);
    await expect(set(day(`[{"from":"18:00","to":"09:00"}]`))).rejects.toThrow(/business_hours_chk/);
    await expect(set(day(`[{"from":"09:00","to":"13:00"},{"from":"12:00","to":"18:00"}]`))).rejects.toThrow(/business_hours_chk/);
    await expect(
      testDb().$executeRaw`UPDATE tenant_request_settings SET business_hours = NULL, hours_enabled = 1 WHERE tenant_id = ${t.id}`,
    ).rejects.toThrow(/hours_enabled_chk/);
  });
});
