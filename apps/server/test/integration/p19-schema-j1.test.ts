// P19 J1 (dba) — DB düzeyi kurallar (mimari-e11 §8c.1; AC-259, 260, 261; S-P19-12, S-P19-T5, B2). Uygulama kodu yok: app
// bağlantısı (testDb) yetki/CHECK'e tabi; migrator (testFixtureDb) information_schema ve EXPLAIN için.
import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { anonymizeBatch } from "../../src/requests/repo.ts";
import { DATA_STEPS } from "../../src/jobs/tenant-purge-repo.ts";
import { newId } from "../../src/lib/ids.ts";
import { createTenant, testDb, testFixtureDb } from "../helpers/app.ts";
import { createRequestRow } from "../helpers/requests.ts";

const hex64 = (): string => createHash("sha256").update(newId()).digest("hex");

interface OutboxInput {
  tenantId: string;
  requestId: string;
  kind?: string;
  channel?: string;
  state?: string;
  recipientEnc?: Uint8Array<ArrayBuffer> | null;
  recipientHash?: string;
  lastReason?: string | null;
  sentAt?: Date | null;
  attempts?: number;
}

function outbox(o: OutboxInput) {
  return testDb().notificationOutbox.create({
    data: {
      id: newId(),
      tenantId: o.tenantId,
      requestId: o.requestId,
      kind: o.kind ?? "REQ_ACCEPTED",
      channel: o.channel ?? "SMS",
      state: o.state ?? "PENDING",
      recipientEnc: o.recipientEnc === undefined ? new Uint8Array(45) : o.recipientEnc,
      recipientMask: "+90 5** *** ** 67",
      recipientHash: o.recipientHash ?? hex64(),
      lastReason: o.lastReason ?? null,
      sentAt: o.sentAt ?? null,
      attempts: o.attempts ?? 0,
    },
  });
}

afterAll(async () => {
  await testDb().$disconnect();
  await testFixtureDb().$disconnect();
});

describe("P19 J1 support_requests.source (AC-259, S-P19-13)", () => {
  it("WEB ⇔ client_version NULL; AGENT + NULL ve WEB + sürüm 3819; kaynak ikili enum", async () => {
    const t = await createTenant();
    const web = await createRequestRow(t.id, { source: "WEB" });
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: web.id }, select: { source: true, clientVersion: true } });
    expect(row).toEqual({ source: "WEB", clientVersion: null });
    await expect(testDb().supportRequest.update({ where: { id: web.id }, data: { clientVersion: "0.12.0" } })).rejects.toThrow(
      /source_version_chk/,
    );
    const agent = await createRequestRow(t.id);
    const a = await testDb().supportRequest.findUniqueOrThrow({ where: { id: agent.id }, select: { source: true, notifySms: true } });
    expect(a).toEqual({ source: "AGENT", notifySms: false }); // varsayılanlar (eski satırlar da böyle)
    await expect(testDb().supportRequest.update({ where: { id: agent.id }, data: { clientVersion: null } })).rejects.toThrow(
      /source_version_chk/,
    );
    for (const bad of ["KIOSK", "web", "WEB "]) {
      await expect(testDb().$executeRaw`UPDATE support_requests SET source = ${bad} WHERE id = ${agent.id}`).rejects.toThrow(/source_chk/);
    }
  });
});

describe("P19 J1 tenant_settings SMS (AC-260, S-P19-T5)", () => {
  it("sms_url yalnız köken + yol; userinfo/sorgu/parça/satır sonu 3819; başlık NetGSM biçimi", async () => {
    const t = await createTenant();
    await testDb().tenantSettings.upsert({ where: { tenantId: t.id }, create: { tenantId: t.id }, update: {} });
    const set = (data: { smsUrl?: string | null; smsHeader?: string | null }) =>
      testDb().tenantSettings.update({ where: { tenantId: t.id }, data });
    for (const ok of ["https://sms.example.com/api", "http://10.0.0.5:3001", "HTTPS://sms.example.com"]) {
      await expect(set({ smsUrl: ok })).resolves.toBeTruthy();
    }
    for (const bad of [
      "https://u:p@sms.example.com",
      "https://sms.example.com/x?apikey=1",
      "https://sms.example.com/#k",
      "https://sms.example.com\n",
      "ftp://sms.example.com",
    ]) {
      await expect(set({ smsUrl: bad }), bad).rejects.toThrow(/sms_url_chk/);
    }
    await expect(set({ smsHeader: "NOKTA BLSM" })).resolves.toBeTruthy();
    await expect(set({ smsHeader: "NOKTA_BLSM" })).rejects.toThrow(/sms_header_chk/);
  });
});

describe("P19 J1 notification_outbox (AC-261, S-P19-12)", () => {
  it("yaşam döngüsü PENDING → SENDING → SENT (alıcı NULL'lanır, hash kalır); tavan aşımı FAILED rate_limited", async () => {
    const t = await createTenant();
    const r = await createRequestRow(t.id, { source: "WEB" });
    const o = await outbox({ tenantId: t.id, requestId: r.id });
    await testDb().notificationOutbox.update({ where: { id: o.id }, data: { state: "SENDING", attempts: 1 } });
    const sent = await testDb().notificationOutbox.update({
      where: { id: o.id },
      data: { state: "SENT", recipientEnc: null, sentAt: new Date() },
    });
    expect(sent.recipientHash).toBe(o.recipientHash);
    await expect(
      outbox({ tenantId: t.id, requestId: r.id, channel: "EMAIL", state: "FAILED", recipientEnc: null, lastReason: "rate_limited" }),
    ).resolves.toBeTruthy();
    // Idempotent kuyruğa alma: aynı talep/tür/kanal ikinci satır yok.
    await expect(outbox({ tenantId: t.id, requestId: r.id })).rejects.toThrow(/request_id_tenant_id_kind_channel_key|Unique/i);
  });

  it("CHECK negatifleri: son durum ⇔ alıcı, hash biçimi, SENT ⇔ sent_at, FAILED ⇒ kod, enum'lar, attempts", async () => {
    const t = await createTenant();
    const r = await createRequestRow(t.id);
    const base = { tenantId: t.id, requestId: r.id };
    await expect(outbox({ ...base, state: "SENT", sentAt: new Date() })).rejects.toThrow(/recipient_enc_chk/);
    await expect(outbox({ ...base, recipientEnc: null })).rejects.toThrow(/recipient_enc_chk/);
    await expect(outbox({ ...base, recipientEnc: new Uint8Array(Buffer.from("+905301112233")) })).rejects.toThrow(/recipient_enc_chk/);
    await expect(outbox({ ...base, recipientHash: "abc" })).rejects.toThrow(/recipient_hash_chk/);
    await expect(outbox({ ...base, recipientHash: hex64().toUpperCase() })).rejects.toThrow(/recipient_hash_chk/);
    await expect(outbox({ ...base, state: "SENT", recipientEnc: null })).rejects.toThrow(/sent_chk/);
    await expect(outbox({ ...base, state: "FAILED", recipientEnc: null })).rejects.toThrow(/last_reason_chk/);
    await expect(outbox({ ...base, lastReason: "ECONNREFUSED 10.0.0.1" })).rejects.toThrow(/last_reason_chk/);
    await expect(outbox({ ...base, channel: "FAX" })).rejects.toThrow(/channel_chk/);
    await expect(outbox({ ...base, kind: "ASSIGNED" })).rejects.toThrow(/kind_chk/);
    await expect(outbox({ ...base, state: "pending" })).rejects.toThrow(/state_chk/);
    await expect(outbox({ ...base, attempts: 4 })).rejects.toThrow(/attempts_chk/);
    await expect(
      testDb().$executeRaw`INSERT INTO notification_outbox (id, tenant_id, request_id, kind, channel, recipient_enc, recipient_mask,
        recipient_hash, updated_at) VALUES (${newId()}, ${t.id}, ${r.id}, 'REQ_ACCEPTED', 'SMS', RANDOM_BYTES(45), 'm', NULL,
        UTC_TIMESTAMP(3))`,
    ).rejects.toThrow(/cannot be null/i);
  });

  it("başka tenant'ın talebine satır → FK (1452)", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const r = await createRequestRow(other.id);
    await expect(outbox({ tenantId: t.id, requestId: r.id })).rejects.toThrow(/foreign key/i);
  });

  it("B2: anonimleştirme partisi talebin outbox satırlarını aynı TX'te siler (recipient_hash dahil)", async () => {
    const t = await createTenant();
    const old = new Date(Date.now() - 400 * 86_400_000);
    const r = await createRequestRow(t.id, { createdAt: old, waitMinutes: 10 });
    await testDb().supportRequest.update({ where: { id: r.id }, data: { status: "EXPIRED", closedAt: old } });
    await outbox({ tenantId: t.id, requestId: r.id, state: "FAILED", recipientEnc: null, lastReason: "unconfigured" });
    const keep = await createRequestRow(t.id);
    await outbox({ tenantId: t.id, requestId: keep.id });
    const n = await anonymizeBatch(testDb(), t.id, new Date(Date.now() - 365 * 86_400_000), 1000);
    expect(n.requests).toBe(1);
    expect(await testDb().notificationOutbox.count({ where: { requestId: r.id } })).toBe(0);
    expect(await testDb().notificationOutbox.count({ where: { requestId: keep.id } })).toBe(1);
  });

  it("firma silme: outbox MESSAGES adımında (talepten önce) silinir", () => {
    expect(DATA_STEPS.MESSAGES?.map((p) => p.table)).toEqual(["session_messages", "notification_outbox"]);
  });

  it("yetki: app SELECT/INSERT/UPDATE/DELETE var, DDL yok; tetikleyici sayısı 23", async () => {
    await expect(testDb().$executeRaw`DELETE FROM notification_outbox WHERE id = '-'`).resolves.toBe(0);
    await expect(testDb().$executeRaw`UPDATE notification_outbox SET attempts = 0 WHERE id = '-'`).resolves.toBe(0);
    await expect(testDb().$executeRawUnsafe("ALTER TABLE notification_outbox ADD COLUMN x INT")).rejects.toThrow(/denied/i);
    const trg = await testFixtureDb().$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = DATABASE()`;
    expect(Number(trg[0]?.n)).toBe(23); // deploy/backup/lib.sh REMOTE_EXPECTED_TRIGGERS (P19 değiştirmez)
  });

  it("S-P19-12 EXPLAIN: alıcı sayımı IX(recipient_hash, created_at), firma/kanal sayımı IX(tenant_id, channel, created_at)", async () => {
    const t = await createTenant();
    const h = hex64();
    const plan = async (sql: string, ...args: unknown[]) =>
      (await testFixtureDb().$queryRawUnsafe<{ key: string | null }[]>(`EXPLAIN ${sql}`, ...args)).map((x) => x.key);
    expect(
      await plan(
        `SELECT COUNT(*) FROM notification_outbox WHERE tenant_id = ? AND recipient_hash = ? AND channel = 'SMS'
         AND created_at > UTC_TIMESTAMP(3) - INTERVAL 24 HOUR AND (last_reason IS NULL OR last_reason <> 'rate_limited')`,
        t.id,
        h,
      ),
    ).toEqual(["notification_outbox_recipient_hash_created_at_idx"]);
    expect(
      await plan(
        `SELECT COUNT(*) FROM notification_outbox WHERE tenant_id = ? AND channel = 'SMS'
         AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR AND (last_reason IS NULL OR last_reason <> 'rate_limited')`,
        t.id,
      ),
    ).toEqual(["notification_outbox_tenant_id_channel_created_at_idx"]);
    expect(
      await plan(
        `SELECT id FROM notification_outbox WHERE state = 'PENDING' AND next_at <= UTC_TIMESTAMP(3) ORDER BY next_at LIMIT 20
         FOR UPDATE SKIP LOCKED`,
      ),
    ).toEqual(["notification_outbox_state_next_at_idx"]);
  });
});
