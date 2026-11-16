// P16 G3 — firma silme meta-testleri (ADR-0030 m.1/m.5, S16-11) ve imha defteri CLI'si (`erasure:replay|verify`,
// ADR-0030 m.9, S16-5/S16-13). Şema bilgisi information_schema'dan (migrator bağlantısı; app'in görünürlüğü yetkiyle sınırlı).
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANT_PURGE_STEPS } from "@remote/contracts/api/tenants";
import { EXIT, main, replay, verify } from "../../src/cli/erasure.ts";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { DATA_STEPS } from "../../src/jobs/tenant-purge-repo.ts";
import { isP16Signal } from "../../src/lib/db.ts";
import { TenantPurgeRunner } from "../../src/jobs/tenant-purge.ts";
import { ErasureLedger, parseLedgerLine } from "../../src/ops/erasure-ledger.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, makeApp, testDb, testFixtureDb } from "../helpers/app.ts";
import { createCustomerRow, createRequestRow } from "../helpers/requests.ts";
import { seedPurgeTenant, tenantRowCounts } from "../helpers/tenant-purge.ts";

/** Firma silinse de kalan, `tenants`'a FK TAŞIMAMASI gereken tablolar (ADR-0030 m.1). */
const KEEP_WITHOUT_TENANT_FK = ["audit_logs", "tenant_purge_jobs"];
/** FENCE'te güncellenen (silinmeyen) firma referansı. */
const FENCE_TABLES = ["auth_sessions"];
/** USER_CHILDREN adımında silinen ama `tenants`'a da FK veren kullanıcı alt tabloları (P27a: tenant_id NOT NULL). */
const USER_CHILDREN_WITH_TENANT_FK = ["trusted_devices"];
/** P28b: adımda silinen ama firmaya yalnız oturum üzerinden (FK `support_sessions(id, tenant_id)`) bağlı tablolar. */
const STEP_TABLES_VIA_SESSION_FK = ["session_stored_files"];
/** Korunan 12 tablo (koşullu DELETE tetikleyicisi; P18 += session_messages). */
const GUARDED = [
  "session_messages",
  "support_sessions",
  "support_requests",
  "session_consents",
  "device_bindings",
  "customers",
  "request_refs",
  "consent_texts",
  "tenant_request_settings",
  "users",
  "tenants",
  "tenant_purge_jobs",
];
/** `users`'a FK veren, firmaya göre silinmeyen tablolar — yalnız Super Admin (tenant_id NULL) yazar. */
const USER_FK_SUPERADMIN_ONLY = ["system_settings", "tenant_purge_jobs"];

/** Geri yüklenmiş DB'de firmanın silme iş satırı (migrator; tetikleyiciden muaf). */
async function insertJob(tenantId: string, state: "SCHEDULED" | "CANCELLED", by: string): Promise<void> {
  const cancelled = state === "CANCELLED" ? Prisma.sql`UTC_TIMESTAMP(3), ${by}` : Prisma.sql`NULL, NULL`;
  await testFixtureDb().$executeRaw`
    INSERT INTO tenant_purge_jobs (id, tenant_id, state, step, scheduled_for, counts, attempts, preview_hash, started_by,
      started_at, created_at, updated_at, cancelled_at, cancelled_by)
    VALUES (${newId()}, ${tenantId}, ${state}, 'FENCE', UTC_TIMESTAMP(3), JSON_OBJECT(), 0, ${sha256Hex(newId())}, ${by},
      NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ${cancelled})`;
}

/** Geri yüklenmiş DB durumu benzetimi (migrator; tetikleyiciden muaf): firma durumu + `passive_at` (gün önce). */
async function setTenantState(id: string, status: "ACTIVE" | "PASSIVE", passiveDaysAgo: number): Promise<void> {
  await testFixtureDb().$executeRaw`
    UPDATE tenants SET status = ${status}, passive_at = UTC_TIMESTAMP(3) - INTERVAL ${passiveDaysAgo} DAY WHERE id = ${id}`;
}

const stepTables = (): Set<string> => new Set(Object.values(DATA_STEPS).flatMap((parts) => parts.map((p) => p.table)));

async function fks(where: string): Promise<{ table: string; column: string; ref: string; rule: string }[]> {
  return testFixtureDb().$queryRawUnsafe(
    `SELECT k.TABLE_NAME AS \`table\`, k.COLUMN_NAME AS \`column\`, k.REFERENCED_TABLE_NAME AS ref, r.DELETE_RULE AS rule
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL AND ${where}`,
  );
}

describe("P16 G3 meta-testler (S16-11)", () => {
  it("AC-242 meta: tenants'a FK veren tablo kümesi = adım tabloları ∪ FENCE; istisnalar tenants'a FK taşımaz", async () => {
    const referencing = new Set((await fks("k.REFERENCED_TABLE_NAME = 'tenants'")).map((r) => r.table));
    // USER_CHILDREN tabloları firmaya değil kullanıcıya bağlıdır (user_id ile silinir; aşağıdaki users testi).
    const userChildren = new Set((DATA_STEPS.USER_CHILDREN ?? []).map((p) => p.table));
    const withTenantFk = [...FENCE_TABLES, ...USER_CHILDREN_WITH_TENANT_FK];
    const expected = new Set([
      ...[...stepTables()].filter((t) => (!userChildren.has(t) || withTenantFk.includes(t)) && !STEP_TABLES_VIA_SESSION_FK.includes(t)),
      ...FENCE_TABLES,
    ]);
    expect([...referencing].sort()).toEqual([...expected].sort());
    for (const t of KEEP_WITHOUT_TENANT_FK) expect(referencing.has(t), t).toBe(false);
  });

  it("AC-242 meta: korunan tablolara giden bütün FK'ler DELETE_RULE = RESTRICT (CASCADE/SET NULL tetikleyiciyi atlatır)", async () => {
    const rows = await fks(`k.REFERENCED_TABLE_NAME IN (${GUARDED.map((t) => `'${t}'`).join(",")})`);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => r.rule !== "RESTRICT")).toEqual([]);
  });

  it("AC-242 meta: users'a FK veren tablolar — her biri adımda silinir ya da yalnız Super Admin'e bağlı istisnadır", async () => {
    const refs = (await fks("k.REFERENCED_TABLE_NAME = 'users'")).map((r) => `${r.table}.${r.column}`).sort();
    // Liste bilinçli olarak sabit: yeni bir FK eklenince bu test kırılır ve adım/istisna kararı verilir.
    expect(refs).toEqual(
      [
        "auth_sessions.user_id",
        "business_holidays.created_by",
        "consent_texts.created_by",
        "customers.created_by",
        "password_reset_tokens.user_id",
        "recovery_codes.user_id",
        "request_blocks.created_by",
        "session_messages.sender_user_id",
        "support_requests.accepted_by",
        "support_requests.assigned_to",
        "support_requests.tenant_id", // P18 S-P18-T5: bileşik FK (assigned_to, tenant_id) → users(id, tenant_id)
        "support_requests.rejected_by",
        "support_sessions.technician_id",
        "support_sessions.terminated_by",
        "system_settings.updated_by",
        "tenant_purge_jobs.cancelled_by",
        "tenant_purge_jobs.started_by",
        "trusted_devices.tenant_id", // P27a: bileşik FK (user_id, tenant_id) → users(id, tenant_id)
        "trusted_devices.user_id",
        "unattended_device_grants.created_by", // P27: cihaz tabloları SESSIONS adımında silinir
        "unattended_device_grants.tenant_id", // bileşik FK (user_id, tenant_id) → users(id, tenant_id)
        "unattended_device_grants.user_id",
        "unattended_devices.registered_by",
        "unattended_devices.revoked_by",
        "unattended_registration_codes.created_by",
        "user_permissions.user_id",
      ].sort(),
    );
    const covered = stepTables();
    for (const r of refs) {
      const table = r.split(".")[0] ?? "";
      expect(covered.has(table) || USER_FK_SUPERADMIN_ONLY.includes(table), r).toBe(true);
    }
  });

  it("AC-242 kilit kapsamı: USER_CHILDREN partisi açıkken başka firmanın yetki yazımı beklemez (tam tablo kilidi yok; QA P16 Tur 2)", async () => {
    // Eski `DELETE … WHERE user_id IN (SELECT …) LIMIT` tabloyu tarayıp her satırı kilitliyordu; araya giren `perms` satırı
    // diğer kullanıcının eklemesini firma partisinin aralık kilidinden ayırır.
    const purge = await createTenant();
    await createUser({ tenantId: purge.id });
    const other = await createTenant();
    await createUser({ tenantId: other.id, perms: { "sessions.view": true } });
    const victim = await createUser({ tenantId: other.id });
    const part = DATA_STEPS.USER_CHILDREN?.find((p) => p.table === "user_permissions");
    if (!part) throw new Error("user_permissions adımı yok");
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let deleted = -1;
    const batchTx = testDb().$transaction(async (tx) => {
      deleted = await part.batch(tx, purge.id);
      await hold;
    });
    await expect.poll(() => deleted).toBe(0);
    const insert = testDb()
      .userPermission.create({ data: { userId: victim.id, permKey: "sessions.view", granted: true } })
      .then(() => "inserted");
    const first = await Promise.race([insert, new Promise((r) => setTimeout(() => r("blocked"), 3_000))]);
    release();
    await batchTx;
    await insert;
    expect(first).toBe("inserted");
  });

  it("AC-242 meta: adım sırası contracts ile aynı; veri adımları + FENCE/TENANT_ROW/FILES/DONE = 18 (P18 += MESSAGES)", () => {
    const special = ["FENCE", "TENANT_ROW", "FILES", "DONE"];
    expect(TENANT_PURGE_STEPS.filter((s) => !special.includes(s))).toEqual(Object.keys(DATA_STEPS));
    expect(TENANT_PURGE_STEPS).toHaveLength(18);
  });
});

describe("P16 G3 imha defteri CLI (S16-5, S16-13)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = makeApp();
    await app.ready();
  });
  afterAll(async () => app.close());

  it("AC-242 defter satırı biçimi: v1, ULID, PII yok; bozuk satır reddedilir", () => {
    const id = newId();
    expect(parseLedgerLine(JSON.stringify({ v: 1, type: "user", id, at: new Date().toISOString() }))).not.toBeNull();
    expect(
      parseLedgerLine(JSON.stringify({ v: 1, type: "tenant", id, jobId: newId(), phase: "done", at: new Date().toISOString() })),
    ).not.toBeNull();
    for (const bad of [
      '{"v":1,"type":"user"',
      JSON.stringify({ v: 1, type: "user", id: "system", at: "x" }),
      JSON.stringify({ v: 1, type: "user", id, at: new Date().toISOString(), email: "a@b" }),
    ])
      expect(parseLedgerLine(bad)).toBeNull();
  });

  it("AC-242 replay geri yüklenmiş firmayı ve kullanıcıyı yeniden siler; verify önce 1, sonra 0; ikinci replay 0; audit erasure.replayed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-ledger-replay-"));
    const path = join(dir, "erasure-ledger.jsonl");
    const ledger = new ErasureLedger(path);
    // "Geri yüklenmiş" firma (veri dolu; silmeden önce alınmış yedekte 20 g pasif) ve başka firmada canlı kullanıcı: defterde
    // silinmiş görünüyorlar. S16-16: firma PASSIVE + passive_at ≤ UTC − 16 g → meşru.
    const f = await seedPurgeTenant(app);
    await setTenantState(f.tenantId, "PASSIVE", 20);
    const other = await createTenant();
    const u = await createUser({ tenantId: other.id, role: "USER", perms: { "sessions.view": true } });
    await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    await ledger.append({ type: "tenant", id: f.tenantId, jobId: newId(), phase: "started", at: new Date().toISOString() });
    await ledger.append({ type: "tenant", id: f.tenantId, jobId: newId(), phase: "done", at: new Date().toISOString() });
    await ledger.append({ type: "user", id: u.id, at: new Date().toISOString() });
    await writeFile(path, '{"v":1,"type":"user"\n', { flag: "a" }); // yarım satır

    const mig = testFixtureDb();
    expect(await verify(mig, path)).toEqual({ pendingUsers: 1, pendingTenants: 1, rejectedUsers: 0, rejectedTenants: 0, invalid: 1 });
    expect(await replay(mig, path)).toEqual({ users: 1, tenants: 1, rejectedUsers: 0, rejectedTenants: 0, invalid: 1 });
    const tomb = await testDb().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(tomb).toMatchObject({ status: "DELETED", email: `deleted+${u.id}@invalid`, username: null, passwordHash: "!deleted" });
    expect(await testDb().userPermission.count({ where: { userId: u.id } })).toBe(0);

    const job = await testDb().tenantPurgeJob.findFirstOrThrow({ where: { tenantId: f.tenantId, state: "RUNNING" } });
    expect(job.step).toBe("FENCE");
    const runner = new TenantPurgeRunner({
      db: testDb(),
      store: app.uploads,
      ledger: app.erasureLedger,
      metrics: app.metrics,
      log: app.log,
    });
    expect(await runner.runJob(job.id)).toBe("done");
    expect(Object.values(await tenantRowCounts(f.tenantId)).every((n) => n === 0)).toBe(true);

    expect(await verify(mig, path)).toEqual({ pendingUsers: 0, pendingTenants: 0, rejectedUsers: 0, rejectedTenants: 0, invalid: 1 });
    expect(await replay(mig, path)).toEqual({ users: 0, tenants: 0, rejectedUsers: 0, rejectedTenants: 0, invalid: 1 });
    // Eşzamanlı test dosyaları (ör. p27a-revoke) da replay audit'i yazar: yalnız bu defterin (3 satır) kayıtları.
    const audits = (
      await testDb().auditLog.findMany({
        where: { action: "erasure.replayed", correlationId: { not: null } },
        orderBy: { id: "desc" },
        take: 20,
      })
    ).filter((a) => (a.newValue as { ledgerLines?: number } | null)?.ledgerLines === 3);
    expect(audits.slice(0, 2).map((a) => a.newValue)).toEqual([
      { users: 0, tenants: 0, rejectedUsers: 0, rejectedTenants: 0, invalid: 1, ledgerLines: 3 },
      { users: 1, tenants: 1, rejectedUsers: 0, rejectedTenants: 0, invalid: 1, ledgerLines: 3 },
    ]);
  });

  it("AC-242 S16-16 replay tutarsız satırı reddeder: aktif firma, taze pasif firma, Super Admin → 0 değişiklik; meşrular işlenir; rc 3; audit rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-ledger-reject-"));
    const path = join(dir, "erasure-ledger.jsonl");
    const ledger = new ErasureLedger(path);
    const at = new Date().toISOString();
    // Sahte (kurcalanmış) satırlar: aktif firma, 2 gündür pasif firma (işi yok), Super Admin hesabı.
    const active = await createTenant();
    const fresh = await createTenant();
    await setTenantState(fresh.id, "PASSIVE", 2);
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    // Meşru satırlar: 2 gündür pasif ama zamanlanmış işi olan firma (S16-20: CANCELLED sayılmaz, ayrı test), firmaya bağlı
    // kullanıcı (intent + done).
    const withJob = await createTenant();
    await setTenantState(withJob.id, "PASSIVE", 2);
    await insertJob(withJob.id, "SCHEDULED", sa.id);
    const member = await createUser({ tenantId: withJob.id, role: "USER", perms: { "sessions.view": true } });
    for (const id of [active.id, fresh.id, withJob.id]) await ledger.append({ type: "tenant", id, jobId: newId(), phase: "done", at });
    await ledger.append({ type: "user", id: sa.id, phase: "done", at });
    await ledger.append({ type: "user", id: member.id, phase: "intent", at });
    await ledger.append({ type: "user", id: member.id, phase: "done", at });
    const before = await testDb().tenant.findMany({ where: { id: { in: [active.id, fresh.id] } }, orderBy: { id: "asc" } });

    const out: string[] = [];
    const err: string[] = [];
    const rc = await main(
      ["erasure:replay"],
      { MIGRATE_DATABASE_URL: process.env.TEST_MIGRATE_DATABASE_URL },
      { out: (x) => out.push(x), err: (x) => err.push(x) },
      path,
    );
    expect(rc).toBe(EXIT.REJECTED);
    expect(rc).toBe(3);
    expect(out.join("")).toBe("erasure:replay kullanici=1 firma=1 reddedilen_kullanici=1 reddedilen_firma=2 gecersiz_satir=0\n");
    expect(err.join("")).toContain("kurcalama");
    expect([...out, ...err].join("")).not.toMatch(/@|[0-9A-HJKMNP-TV-Z]{26}/);

    // Reddedilenler: firma satırları aynen, işleri yok; Super Admin canlı.
    expect(await testDb().tenant.findMany({ where: { id: { in: [active.id, fresh.id] } }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await testDb().tenantPurgeJob.count({ where: { tenantId: { in: [active.id, fresh.id] } } })).toBe(0);
    expect(await testDb().user.findUniqueOrThrow({ where: { id: sa.id } })).toMatchObject({ status: "ACTIVE", email: sa.email });
    // Meşrular: kullanıcı mezar taşı, firmaya RUNNING iş.
    expect((await testDb().user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("DELETED");
    const job = await testDb().tenantPurgeJob.findFirstOrThrow({ where: { tenantId: withJob.id, state: "RUNNING" } });

    const mig = testFixtureDb();
    expect(await verify(mig, path)).toEqual({ pendingUsers: 0, pendingTenants: 1, rejectedUsers: 1, rejectedTenants: 2, invalid: 0 });
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { action: "erasure.replayed" }, orderBy: { id: "desc" } });
    expect(audit.result).toBe("fail");
    expect(audit.newValue).toEqual({ users: 1, tenants: 1, rejectedUsers: 1, rejectedTenants: 2, invalid: 0, ledgerLines: 6 });

    // Meşru iş biter; reddedilenler bekleyen sayılmaz → verify 0 (reddedilenler ayrı sayılır).
    const runner = new TenantPurgeRunner({
      db: testDb(),
      store: app.uploads,
      ledger: app.erasureLedger,
      metrics: app.metrics,
      log: app.log,
    });
    expect(await runner.runJob(job.id)).toBe("done");
    const v = await verify(mig, path);
    expect(v).toEqual({ pendingUsers: 0, pendingTenants: 0, rejectedUsers: 1, rejectedTenants: 2, invalid: 0 });
  });

  it("AC-242 S16-20 replay: yalnız intent satırı + yeniden etkinleştirilmiş kullanıcı ve yalnız CANCELLED işi olan taze pasif firma reddedilir; intent + PASSIVE uygulanır", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rs-ledger-s1620-"));
    const path = join(dir, "erasure-ledger.jsonl");
    const ledger = new ErasureLedger(path);
    const at = new Date().toISOString();
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    // Geri alınmış silme TX'i (yalnız intent), sonra hesap yeniden etkinleştirilmiş → ACTIVE: mezar taşına çevrilmez.
    const t = await createTenant();
    const reactivated = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
    // Commit sonrası `done` yazılamadan çöken meşru silme (yalnız intent, hâlâ PASSIVE) → uygulanır.
    const crashed = await createUser({ tenantId: t.id, role: "USER", status: "PASSIVE" });
    // 3 gündür pasif, silmesi zamanlanıp iptal edilmiş firma: CANCELLED iş silme izni değildir.
    const cancelled = await createTenant();
    await setTenantState(cancelled.id, "PASSIVE", 3);
    await insertJob(cancelled.id, "CANCELLED", sa.id);
    await ledger.append({ type: "user", id: reactivated.id, phase: "intent", at });
    await ledger.append({ type: "user", id: crashed.id, phase: "intent", at });
    await ledger.append({ type: "tenant", id: cancelled.id, jobId: newId(), phase: "done", at });
    const tenantBefore = await testDb().tenant.findUniqueOrThrow({ where: { id: cancelled.id } });

    const mig = testFixtureDb();
    expect(await verify(mig, path)).toEqual({ pendingUsers: 1, pendingTenants: 0, rejectedUsers: 1, rejectedTenants: 1, invalid: 0 });
    expect(await replay(mig, path)).toEqual({ users: 1, tenants: 0, rejectedUsers: 1, rejectedTenants: 1, invalid: 0 });
    expect(await testDb().user.findUniqueOrThrow({ where: { id: reactivated.id } })).toMatchObject({
      status: "ACTIVE",
      email: reactivated.email,
    });
    expect(await testDb().userPermission.count({ where: { userId: reactivated.id } })).toBe(1);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: crashed.id } })).status).toBe("DELETED");
    expect(await testDb().tenant.findUniqueOrThrow({ where: { id: cancelled.id } })).toEqual(tenantBefore);
    expect(await testDb().tenantPurgeJob.findMany({ where: { tenantId: cancelled.id }, select: { state: true } })).toEqual([
      { state: "CANCELLED" },
    ]);
    expect(await verify(mig, path)).toEqual({ pendingUsers: 0, pendingTenants: 0, rejectedUsers: 1, rejectedTenants: 1, invalid: 0 });
  });

  it("AC-242 cli main: bilinmeyen komut ve eksik MIGRATE_DATABASE_URL → 2 (PII'siz çıktı)", async () => {
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) };
    expect(await main([], {}, io)).toBe(2);
    expect(await main(["erasure:nope"], {}, io)).toBe(2);
    expect(await main(["erasure:verify"], {}, io)).toBe(2);
    // DB yolu replay/verify testlerinde; burada ek bağlantı havuzu açılmaz (test DB max_connections sınırında).
    expect(out.join("")).not.toMatch(/@/);
  });
});

describe("P16 S16-3 damga tetikleyicileri (anonymized_at / revoked_at)", () => {
  it("AC-240 S16-3: app ile damga bir kez ve DB saatine yakın yazılır; ikinci yazım, NULL'lama ve geçmiş tarih SIGNAL", async () => {
    const t = await createTenant();
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
    const session = await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id, status: "ENDED" });
    const request = await createRequestRow(t.id);
    const customer = await createCustomerRow(t.id);
    const bindingId = newId();
    await testDb().deviceBinding.create({
      data: {
        id: bindingId,
        tenantId: t.id,
        customerId: customer.id,
        keyHash: sha256Hex(newId()),
        clientVersion: "0.9.0",
        firstSessionId: session.id,
        lastSessionId: session.id,
        lastUsedAt: new Date(),
      },
    });
    // CHECK'ler damgayla birlikte yazılacak sütunları ister: support_requests PII NULL (`support_requests_pii_chk`),
    // device_bindings neden + özet NULL (`device_bindings_revoked_chk`).
    const piiNull = Prisma.sql`, customer_name = NULL, customer_phone = NULL, customer_email = NULL, description = NULL,
      ip = NULL, ip_key = NULL, net_key = NULL, device_hash = NULL`;
    const cases = [
      { table: "support_sessions", col: "anonymized_at", id: session.id, extra: Prisma.empty },
      { table: "support_requests", col: "anonymized_at", id: request.id, extra: piiNull },
      { table: "device_bindings", col: "revoked_at", id: bindingId, extra: Prisma.sql`, revoke_reason = 'EXPIRED', key_hash = NULL` },
    ] as const;
    const set = (c: (typeof cases)[number], value: Prisma.Sql) =>
      testDb().$executeRaw`UPDATE ${Prisma.raw(c.table)} SET ${Prisma.raw(c.col)} = ${value} ${c.extra} WHERE id = ${c.id}`;
    for (const c of cases) {
      // Geçmiş (> 1 g) ve gelecek (> 1 dk) değer reddedilir.
      await expect(set(c, Prisma.sql`UTC_TIMESTAMP(3) - INTERVAL 40 DAY`), c.table).rejects.toSatisfy(isP16Signal);
      await expect(set(c, Prisma.sql`UTC_TIMESTAMP(3) + INTERVAL 1 HOUR`), c.table).rejects.toSatisfy(isP16Signal);
      // İlk yazım (DB saati) geçer.
      expect(await set(c, Prisma.sql`UTC_TIMESTAMP(3)`)).toBe(1);
      // Dolu damga değişmez ve NULL'lanmaz.
      await expect(set(c, Prisma.sql`UTC_TIMESTAMP(3) - INTERVAL 1 HOUR`), c.table).rejects.toSatisfy(isP16Signal);
      await expect(set(c, Prisma.sql`NULL`), c.table).rejects.toSatisfy(isP16Signal);
    }
  });
});
