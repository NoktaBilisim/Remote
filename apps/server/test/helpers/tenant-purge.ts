// P16 G3 (AC-242) firma silme test yardımcıları: veri dolu firma fikstürü, pasiflik/zamanlamayı migrator ile geçmişe alma,
// firmaya ait satır sayımı, audit satırlarının içerik özeti (continuity kalıbı).
import type { FastifyInstance } from "fastify";
import { newId, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";
import { writeAudit } from "../../src/audit/service.ts";
import { createSupportSessionRow, createTenant, createUser, testDb, testFixtureDb, type Session, type TestUser } from "./app.ts";
import { createCustomerRow, createRequestRow, createRequestSettings } from "./requests.ts";

export interface PurgeFixture {
  tenantId: string;
  tenantName: string;
  admin: TestUser;
  user: TestUser;
  fileRel: string;
}

/** Firma + her adım tablosunda en az bir satır + yüklenmiş dosya + firma kullanıcılarının giriş audit'i. */
export async function seedPurgeTenant(app: FastifyInstance): Promise<PurgeFixture> {
  const t = await createTenant();
  await createRequestSettings(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const user = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
  // Giriş yerine doğrudan: auth_sessions + kullanıcı e-postalı audit (giriş hız sınırı 20/dk/IP testleri boğmasın).
  for (const u of [admin, user]) {
    await testDb().authSession.create({
      data: {
        id: newId(),
        userId: u.id,
        tokenHash: sha256Hex(newSecretToken()),
        ip: "203.0.113.9",
        userAgent: "test",
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await writeAudit(
      testDb(),
      { ip: "203.0.113.9", userAgent: "test", requestId: newId() },
      {
        tenantId: t.id,
        userId: u.id,
        username: u.email,
        action: "auth.login",
        entity: "auth_sessions",
        result: "success",
        newValue: { email: u.email, fullName: "Test Kullanıcı" },
      },
    );
  }
  const session = await createSupportSessionRow({ tenantId: t.id, technicianId: user.id, status: "ENDED" });
  const db = testDb();
  await db.sessionFile.create({
    data: {
      id: newId(),
      sessionId: session.id,
      tenantId: t.id,
      direction: "TO_TECH",
      fileName: "a.txt",
      sizeBytes: 1n,
      sha256: "a".repeat(64),
      result: "OK",
    },
  });
  await db.sessionConsent.create({
    data: { id: newId(), sessionId: session.id, tenantId: t.id, level: "VIEW", decision: "GRANTED", source: "SYSTEM" },
  });
  const customer = await createCustomerRow(t.id);
  const bindingId = newId();
  await db.deviceBinding.create({
    data: {
      id: bindingId,
      tenantId: t.id,
      customerId: customer.id,
      keyHash: sha256Hex(newSecretToken()),
      clientVersion: "0.9.0",
      firstSessionId: session.id,
      lastSessionId: session.id,
      lastUsedAt: new Date(),
    },
  });
  const request = await createRequestRow(t.id);
  await db.supportRequest.update({ where: { id: request.id }, data: { bindingId, customerId: customer.id } });
  await db.requestBlock.create({
    data: { id: newId(), tenantId: t.id, kind: "DEVICE", deviceKeyHash: sha256Hex(newId()), createdBy: admin.id },
  });
  // P18: talep mesajı (MESSAGES adımı; gövde fikstürde sahte şifreli blob — 29 + 2 bayt, body_chars 2) + tatil (SETTINGS).
  await db.sessionMessage.create({
    data: {
      id: newId(),
      tenantId: t.id,
      requestId: request.id,
      sender: "TECH",
      senderUserId: user.id,
      bodyEnc: new Uint8Array(31),
      bodyChars: 2,
    },
  });
  await db.businessHoliday.create({
    data: { id: newId(), tenantId: t.id, day: new Date("2026-04-23T00:00:00Z"), name: "Ulusal Egemenlik", createdBy: admin.id },
  });
  const fileRel = await app.uploads.save(t.id, "png", Buffer.from("not-really-a-png"));
  return { tenantId: t.id, tenantName: t.name, admin, user, fileRel };
}

/** Pasife al (API ile, Super Admin) ve `passive_at`'ı 31 gün geriye çek (migrator; tetikleyiciden muaf). */
export async function makeEligible(app: FastifyInstance, sa: Session, tenantId: string): Promise<void> {
  const r = await app.inject({ method: "POST", url: `/api/v1/admin/tenants/${tenantId}/deactivate`, headers: sa.headers, payload: {} });
  if (r.statusCode !== 200) throw new Error(`deactivate ${r.statusCode} ${r.body}`);
  await backdatePassive(tenantId, 31);
}

export async function backdatePassive(tenantId: string, days: number): Promise<void> {
  await testFixtureDb().$executeRaw`UPDATE tenants SET passive_at = UTC_TIMESTAMP(3) - INTERVAL ${days} DAY WHERE id = ${tenantId}`;
}

/** 24 saat beklemeyi atlamak için (yalnız migrator; uygulama `scheduled_for`'u değiştiremez). */
export async function makeDue(jobId: string): Promise<void> {
  await testFixtureDb().$executeRaw`UPDATE tenant_purge_jobs SET scheduled_for = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ${jobId}`;
}

const TENANT_TABLES = [
  "session_files",
  "session_consents",
  "session_messages",
  "device_bindings",
  "support_sessions",
  "support_requests",
  "request_blocks",
  "request_refs",
  "customers",
  "tenant_request_settings",
  "tenant_settings",
  "business_holidays",
  "consent_texts",
  "users",
] as const;

/** Firmaya ait satırlar (tablo → sayı) + firma satırı + kullanıcı alt tabloları. */
export async function tenantRowCounts(tenantId: string): Promise<Record<string, number>> {
  const db = testFixtureDb();
  const out: Record<string, number> = {};
  for (const t of TENANT_TABLES) {
    const r = await db.$queryRawUnsafe<{ c: bigint }[]>(`SELECT COUNT(*) AS c FROM \`${t}\` WHERE tenant_id = ?`, tenantId);
    out[t] = Number(r[0]?.c ?? 0);
  }
  for (const t of ["user_permissions", "auth_sessions", "recovery_codes", "password_reset_tokens"]) {
    const r = await db.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT COUNT(*) AS c FROM \`${t}\` WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)`,
      tenantId,
    );
    out[t] = Number(r[0]?.c ?? 0);
  }
  const tr = await db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM tenants WHERE id = ${tenantId}`;
  out.tenants = Number(tr[0]?.c ?? 0);
  return out;
}

/** Firmanın audit satırlarının sayısı ve içerik özeti (continuity `h` kalıbı: id sırasıyla satır özetleri). */
export async function auditDigest(tenantId: string, maxId?: bigint): Promise<{ n: number; h: string | null; maxId: bigint }> {
  const r = await testFixtureDb().$queryRaw<{ n: bigint; h: string | null; m: bigint | null }[]>`
    SELECT COUNT(*) AS n, MAX(id) AS m,
      SHA2(GROUP_CONCAT(SHA2(JSON_ARRAY(id, created_at, tenant_id, user_id, username, action, entity, entity_id, old_value,
        new_value, ip_address, user_agent, result, correlation_id), 256) ORDER BY id SEPARATOR ''), 256) AS h
    FROM audit_logs WHERE tenant_id = ${tenantId} AND id <= ${maxId ?? 9_223_372_036_854_775_807n}`;
  return { n: Number(r[0]?.n ?? 0), h: r[0]?.h ?? null, maxId: BigInt(r[0]?.m ?? 0) };
}
