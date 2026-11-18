// P16 G3 — firma kalıcı silme: önizleme/zamanlama/iptal uçları ve yürütücü (AC-242; ADR-0030 m.2/m.5/m.6/m.9, mimari-e11
// §7.3, §7.5; S16-1, S16-2, S16-4, S16-6, S16-13). Gerçek MySQL; geçmiş tarihler migrator fikstürüyle (tetikleyiciden muaf).
import { mkdtemp, readFile, stat, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  TENANT_PURGE_STEPS,
  TENANT_REACTIVATE_PURGE_PARTIAL_MESSAGE,
  TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE,
  type TenantPurgePreviewResponse,
  type TenantPurgeScheduledResponse,
} from "@remote/contracts/api/tenants";
import { TenantPurgeRunner } from "../../src/jobs/tenant-purge.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import {
  createTenant,
  createUser,
  loginStepUp,
  makeApp,
  TEST_LEDGER_PATH,
  testDb,
  testFixtureDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { retryNotReady } from "../helpers/requests.ts";
import { auditDigest, backdatePassive, makeDue, makeEligible, seedPurgeTenant, tenantRowCounts } from "../helpers/tenant-purge.ts";

let app: FastifyInstance;
let sa: Session;
let superAdmin: TestUser;

const url = (id: string) => `/api/v1/admin/tenants/${id}/purge`;
const preview = async (id: string, s: Session = sa) =>
  app.inject({ method: "POST", url: url(id), headers: s.headers, payload: { dryRun: true } });
/**
 * Q-P21-3: zamanlama TX'i `lockOpenJob` (tenant_id dizininde boşluk kilidi) + INSERT yapar; başka dosyadaki eşzamanlı zamanlama
 * aynı boşluğa INSERT ederken InnoDB deadlock'u (1213) → tasarlanmış 503 NOT_READY + Retry-After (TX geri alındı, önizleme
 * tüketilmedi). Belgelenmiş yeniden deneme: en çok 2 ek deneme, yalnız 503'te.
 */
const schedule = (id: string, previewId: string, confirmName: string, s: Session = sa) =>
  retryNotReady(
    () => app.inject({ method: "POST", url: url(id), headers: s.headers, payload: { dryRun: false, previewId, confirmName } }),
    {
      attempts: 3,
    },
  );
const runner = (afterBatch?: (step: string) => Promise<void>) =>
  new TenantPurgeRunner({
    db: testDb(),
    store: app.uploads,
    ledger: app.erasureLedger,
    metrics: app.metrics,
    log: app.log,
    ...(afterBatch ? { afterBatch } : {}),
  });
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** Önizleme → zamanlama → 24 saati migrator ile atla; preview gövdesi ve iş kimliği döner. */
async function scheduleDue(tenantId: string, name: string): Promise<{ pv: TenantPurgePreviewResponse; jobId: string }> {
  const p = await preview(tenantId);
  expect(p.statusCode, p.body).toBe(200);
  const pv = p.json<TenantPurgePreviewResponse>();
  const r = await schedule(tenantId, pv.previewId, name);
  expect(r.statusCode, r.body).toBe(202);
  const jobId = r.json<TenantPurgeScheduledResponse>().jobId;
  await makeDue(jobId);
  return { pv, jobId };
}

beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
// /admin yazma hızı kullanıcı başına 30/dk (AC-203) → her test kendi Super Admin'iyle.
beforeEach(async () => {
  superAdmin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
  sa = await loginStepUp(app, superAdmin);
});
afterAll(async () => app.close());

describe("P16 G3 firma kalıcı silme (AC-242)", () => {
  it("AC-242 uçtan uca: uygunluk 409 → önizleme → zamanlama (+24 sa DB) → bekleme → silme; önizleme = silinen, firma/klasör yok, audit değişmez, defter", async () => {
    const f = await seedPurgeTenant(app);
    // Aktif firma ve < 30 g pasif: PURGE_NOT_ELIGIBLE
    const active = await preview(f.tenantId);
    expect(active.statusCode).toBe(409);
    expect(active.json<{ error: unknown }>().error).toMatchObject({ code: "PURGE_NOT_ELIGIBLE", fields: { reason: "not_passive" } });
    await app.inject({ method: "POST", url: `/api/v1/admin/tenants/${f.tenantId}/deactivate`, headers: sa.headers, payload: {} });
    const young = await preview(f.tenantId);
    expect(young.statusCode).toBe(409);
    expect(young.json<{ error: { fields: { eligibleAt: string } } }>().error.fields.eligibleAt).toMatch(/^\d{4}-/);
    await backdatePassive(f.tenantId, 31);

    const pr = await preview(f.tenantId);
    expect(pr.statusCode, pr.body).toBe(200);
    const pv = pr.json<TenantPurgePreviewResponse>();
    expect(pv.tenant).toEqual({ id: f.tenantId, name: f.tenantName });
    expect(pv.files).toMatchObject({ count: 1 });
    for (const k of [
      "SESSION_FILES",
      "SESSION_CONSENTS",
      "REQUEST_UNLINK",
      "BINDINGS",
      "SESSIONS",
      "REQUESTS",
      "REQUEST_BLOCKS",
      "REQUEST_REFS",
      "CUSTOMERS",
      "SETTINGS",
      "CONSENT_TEXTS",
      "USER_CHILDREN",
      "USERS",
      "TENANT_ROW",
    ] as const)
      expect(pv.counts[k], k).toBeGreaterThan(0);
    expect(pv.auditRetained).toBeGreaterThan(0);
    // Q-P21-2 (mimari-p21 §10 "Silme yolları"): portal hesabı + oturumu SESSIONS sayısına dahil
    const pre = await tenantRowCounts(f.tenantId);
    expect([pre.portal_users, pre.portal_sessions]).toEqual([1, 1]);
    const sessionsStep = [
      "support_sessions",
      "portal_sessions",
      "portal_users",
      "customer_notify_contacts",
      "unattended_registration_codes",
      "unattended_device_grants",
      "unattended_devices",
    ];
    expect(pv.counts.SESSIONS).toBe(sessionsStep.reduce((sum, t) => sum + (pre[t] ?? 0), 0));

    // Ad onayı (400, önizleme tüketilmez) → zamanlama
    expect((await schedule(f.tenantId, pv.previewId, "Yanlış Ad")).statusCode).toBe(400);
    const sc = await schedule(f.tenantId, pv.previewId, ` ${f.tenantName} `);
    expect(sc.statusCode, sc.body).toBe(202);
    const job = sc.json<TenantPurgeScheduledResponse>();
    expect(job.state).toBe("SCHEDULED");
    const dbNow = (await testDb().$queryRaw<{ t: Date }[]>`SELECT UTC_TIMESTAMP(3) AS t`)[0]?.t.getTime() ?? 0;
    expect(Math.abs(Date.parse(job.scheduledFor) - (dbNow + 24 * 3_600_000))).toBeLessThan(120_000);

    // S16-6: aynı previewId ikinci kez → 428
    expect((await schedule(f.tenantId, pv.previewId, f.tenantName)).statusCode).toBe(428);
    // Açık iş varken önizleme 409 CONFLICT (fields.jobId), yeniden etkinleştirme 409 (SCHEDULED mesajı)
    const again = await preview(f.tenantId);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: unknown }>().error).toMatchObject({ code: "CONFLICT", fields: { jobId: job.jobId, state: "SCHEDULED" } });
    const re = await app.inject({
      method: "POST",
      url: `/api/v1/admin/tenants/${f.tenantId}/reactivate`,
      headers: sa.headers,
      payload: {},
    });
    expect(re.statusCode).toBe(409);
    expect(re.json<{ error: { message: string } }>().error.message).toBe(TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE);
    // Liste rozeti + bant kaynağı
    const item = await app.inject({ method: "GET", url: `/api/v1/admin/tenants/${f.tenantId}`, headers: sa.headers });
    expect(item.json()).toMatchObject({ purge: { state: "SCHEDULED", step: "FENCE" }, passiveSince: expect.any(String) });
    const band = await app.inject({ method: "GET", url: "/api/v1/admin/purge-jobs?open=1", headers: sa.headers });
    expect(band.json<{ items: { jobId: string }[] }>().items.map((i) => i.jobId)).toContain(job.jobId);

    // S16-4: 24 saat dolmadan RUNNING yok — yürütücü almaz, app kullanıcısının doğrudan UPDATE'i tetikleyiciye takılır
    expect(await runner().runJob(job.jobId)).toBe("idle");
    await expect(testDb().$executeRaw`UPDATE tenant_purge_jobs SET state = 'RUNNING' WHERE id = ${job.jobId}`).rejects.toThrow(/p16:/);
    expect((await tenantRowCounts(f.tenantId)).tenants).toBe(1);

    const auditBefore = await auditDigest(f.tenantId);
    await makeDue(job.jobId);
    expect(await runner().runJob(job.jobId)).toBe("done");

    const rows = await tenantRowCounts(f.tenantId);
    expect(
      Object.values(rows).every((n) => n === 0),
      JSON.stringify(rows),
    ).toBe(true);
    expect(await exists(app.uploads.absDir(f.tenantId))).toBe(false);
    const st = await app.inject({ method: "GET", url: url(f.tenantId), headers: sa.headers });
    expect(st.statusCode).toBe(200);
    const status = st.json<{ state: string; step: string; stepIndex: number; counts: Record<string, number> }>();
    expect(status).toMatchObject({ state: "DONE", step: "DONE", stepIndex: TENANT_PURGE_STEPS.length - 1 });
    expect(status.counts).toEqual(pv.counts); // önizleme sayısı = silinen sayı
    expect((await app.inject({ method: "GET", url: `/api/v1/admin/tenants/${f.tenantId}`, headers: sa.headers })).statusCode).toBe(404);

    // Audit: önceki satırlar aynen (sayı + içerik özeti); yeni satırlar (started/purged) eklenmiş
    expect(await auditDigest(f.tenantId, auditBefore.maxId)).toEqual(auditBefore);
    const actions = (
      await testDb().auditLog.findMany({ where: { tenantId: f.tenantId, id: { gt: auditBefore.maxId } }, select: { action: true } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["tenant.purge_started", "tenant.purged"]));

    // S16-1: silme sonrası liste ve CSV'de firmanın kullanıcı e-posta/adları ve firma adı 0 kez
    for (const path of [`/api/v1/audit?tenantId=${f.tenantId}`, `/api/v1/audit/export.csv?tenantId=${f.tenantId}`]) {
      const res = await app.inject({ method: "GET", url: path, headers: sa.headers });
      expect(res.statusCode, path).toBe(200);
      for (const needle of [f.admin.email, f.user.email, f.admin.username, f.tenantName, f.portalEmail])
        expect(res.body, `${path} ${needle}`).not.toContain(needle);
    }

    // S16-13: defter — started + done satırları, PII yok
    const ledger = (await readFile(TEST_LEDGER_PATH, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const mine = ledger.filter((l) => l.jobId === job.jobId);
    expect(mine.map((l) => l.phase)).toEqual(["started", "done"]);
    expect(mine[1]).toMatchObject({ v: 1, type: "tenant", id: f.tenantId });
    const band2 = await app.inject({ method: "GET", url: "/api/v1/admin/purge-jobs", headers: sa.headers });
    expect(
      band2.json<{ items: { jobId: string; tenantName: string | null }[] }>().items.find((i) => i.jobId === job.jobId)?.tenantName,
    ).toBeNull();
  });

  it("AC-242 iptal: SCHEDULED → CANCELLED (step-up); iptal sonrası hiçbir satır silinmez, ikinci iptal 404, yeniden etkinleştirme açılır", async () => {
    const f = await seedPurgeTenant(app);
    await makeEligible(app, sa, f.tenantId);
    const { jobId } = await scheduleDue(f.tenantId, f.tenantName);
    const before = await tenantRowCounts(f.tenantId);
    const c = await app.inject({ method: "DELETE", url: url(f.tenantId), headers: sa.headers });
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json()).toEqual({ jobId, state: "CANCELLED" });
    expect((await app.inject({ method: "DELETE", url: url(f.tenantId), headers: sa.headers })).statusCode).toBe(404);
    expect(await runner().runJob(jobId)).toBe("idle");
    expect(await tenantRowCounts(f.tenantId)).toEqual(before);
    expect(await exists(join(app.uploads.root, f.fileRel))).toBe(true);
    const re = await app.inject({
      method: "POST",
      url: `/api/v1/admin/tenants/${f.tenantId}/reactivate`,
      headers: sa.headers,
      payload: {},
    });
    expect(re.statusCode).toBe(200);
    expect(re.json()).toMatchObject({ status: "ACTIVE", passiveSince: null, purge: null });
  });

  it("AC-242 step-up: zamanlama ve iptal step-up'sız 401; önizleme step-up istemez", async () => {
    const f = await seedPurgeTenant(app);
    await makeEligible(app, sa, f.tenantId);
    const plain = await loginStepUp(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    await testDb().authSession.updateMany({ where: { tokenHash: sha256Hex(plain.token) }, data: { stepUpAt: null } });
    const p = await preview(f.tenantId, plain);
    expect(p.statusCode).toBe(200);
    const s = await schedule(f.tenantId, p.json<TenantPurgePreviewResponse>().previewId, f.tenantName, plain);
    expect(s.json<{ error: unknown }>().error).toMatchObject({ code: "MFA_STEP_UP_REQUIRED" });
    expect((await app.inject({ method: "DELETE", url: url(f.tenantId), headers: plain.headers })).statusCode).toBe(401);
  });

  it("AC-242 previewId: başka oturum, durum değişimi, süre/biçim bozuk → 428 PREVIEW_REQUIRED", async () => {
    const f = await seedPurgeTenant(app);
    await makeEligible(app, sa, f.tenantId);
    const pv = (await preview(f.tenantId)).json<TenantPurgePreviewResponse>();
    // Aynı Super Admin, başka oturum
    const sa2 = await loginStepUp(app, superAdmin);
    expect((await schedule(f.tenantId, pv.previewId, f.tenantName, sa2)).json<{ error: unknown }>().error).toMatchObject({
      code: "PREVIEW_REQUIRED",
    });
    // Bozuk / süresi geçmiş
    const [exp, mac] = pv.previewId.split(".") as [string, string];
    expect((await schedule(f.tenantId, `${Number(exp) - 3_600_000}.${mac}`, f.tenantName)).statusCode).toBe(428);
    expect((await schedule(f.tenantId, `${exp}.${"0".repeat(64)}`, f.tenantName)).statusCode).toBe(428);
    // Durum değişimi: passive_at değişti (yeniden pasif)
    await testFixtureDb().$executeRaw`UPDATE tenants SET passive_at = passive_at - INTERVAL 1 SECOND WHERE id = ${f.tenantId}`;
    expect((await schedule(f.tenantId, pv.previewId, f.tenantName)).statusCode).toBe(428);
    expect(await testDb().tenantPurgeJob.count({ where: { tenantId: f.tenantId } })).toBe(0);
  });

  it("AC-242 çökme dayanıklılığı: afterBatch ile her parti/adımdan sonra çökme + yeni yürütücü → aynı sonuç", async () => {
    const f = await seedPurgeTenant(app);
    await makeEligible(app, sa, f.tenantId);
    const { pv, jobId } = await scheduleDue(f.tenantId, f.tenantName);
    const seen: string[] = [];
    for (let i = 0; i < 80; i++) {
      const j = await testDb().tenantPurgeJob.findUniqueOrThrow({ where: { id: jobId } });
      if (j.state === "DONE") break;
      const r = runner(async (step) => {
        seen.push(step);
        throw new Error("çökme benzetimi");
      });
      await r.runJob(jobId).catch((err: unknown) => expect(String(err)).toContain("çökme"));
    }
    const j = await testDb().tenantPurgeJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(j.state).toBe("DONE");
    expect(j.attempts).toBe(0);
    expect(j.counts).toEqual(pv.counts);
    expect(new Set(seen)).toEqual(new Set(TENANT_PURGE_STEPS.filter((s) => s !== "DONE")));
    expect(Object.values(await tenantRowCounts(f.tenantId)).every((n) => n === 0)).toBe(true);
    expect(await exists(app.uploads.absDir(f.tenantId))).toBe(false);
  });

  it("AC-242 S16-2: elle eklenen 'system' işi CHECK'e takılır; aktif firma / satırı olmayan firma işi FAILED invalid_job, dosya silinmez, deftere girmez", async () => {
    const mig = testFixtureDb();
    const owner = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const insert = (id: string, tenantId: string) => mig.$executeRaw`
      INSERT INTO tenant_purge_jobs (id, tenant_id, state, step, scheduled_for, counts, attempts, preview_hash, started_by, started_at, created_at, updated_at)
      VALUES (${id}, ${tenantId}, 'RUNNING', 'FENCE', UTC_TIMESTAMP(3), JSON_OBJECT(), 0, ${sha256Hex(id)}, ${owner.id}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
    await expect(insert(newId(), "system")).rejects.toThrow();

    const activeTenant = await createTenant();
    const rel = await app.uploads.save(activeTenant.id, "png", Buffer.from("x"));
    const ghost = newId();
    for (const [tid, jobId] of [
      [activeTenant.id, newId()],
      [ghost, newId()],
    ] as const) {
      await insert(jobId, tid);
      expect(await runner().runJob(jobId)).toBe("failed");
      const j = await testDb().tenantPurgeJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(j).toMatchObject({ state: "FAILED", lastError: "invalid_job", step: "FENCE" });
      expect(await testDb().auditLog.count({ where: { tenantId: tid, action: "tenant.purge_failed" } })).toBe(1);
      const ledger = await readFile(TEST_LEDGER_PATH, "utf8").catch(() => "");
      expect(ledger).not.toContain(jobId);
    }
    expect(await exists(join(app.uploads.root, rel))).toBe(true);
    expect((await tenantRowCounts(activeTenant.id)).tenants).toBe(1);
  });

  it("AC-242 S16-18: start commit'i ile defter arasında çökme → RUNNING/FENCE iş sonraki turda `started` satırını yazar", async () => {
    const t = await createTenant();
    await testFixtureDb().$executeRaw`
      UPDATE tenants SET status = 'PASSIVE', passive_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY WHERE id = ${t.id}`;
    // Çökme benzetimi: iş RUNNING/FENCE'e geçmiş (start commit'i), defterde satırı yok.
    const jobId = newId();
    await testFixtureDb().$executeRaw`
      INSERT INTO tenant_purge_jobs (id, tenant_id, state, step, scheduled_for, counts, attempts, preview_hash, started_by, started_at, created_at, updated_at)
      VALUES (${jobId}, ${t.id}, 'RUNNING', 'FENCE', UTC_TIMESTAMP(3), JSON_OBJECT(), 0, ${sha256Hex(jobId)}, ${superAdmin.id}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
    expect(await readFile(TEST_LEDGER_PATH, "utf8").catch(() => "")).not.toContain(jobId);
    expect(await runner().runJob(jobId)).toBe("done");
    const mine = (await readFile(TEST_LEDGER_PATH, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { jobId?: string; phase?: string; id: string })
      .filter((l) => l.jobId === jobId);
    expect(mine.map((l) => l.phase)).toEqual(["started", "done"]);
    expect(mine.every((l) => l.id === t.id)).toBe(true);
  });

  it("AC-242 sembolik bağlantı: uploads/{id} bağlantıysa yalnız bağlantı silinir, hedef korunur", async () => {
    const t = await createTenant();
    await createUser({ tenantId: t.id, role: "ADMIN" });
    const outside = await mkdtemp(join(tmpdir(), "rs-purge-target-"));
    await writeFile(join(outside, "keep.txt"), "korunmalı");
    await mkdir(app.uploads.root, { recursive: true });
    await symlink(outside, app.uploads.absDir(t.id));
    await makeEligible(app, sa, t.id);
    const { pv, jobId } = await scheduleDue(t.id, t.name);
    expect(pv.files).toEqual({ count: 0, bytes: 0 }); // bağlantı izlenmez
    expect(await runner().runJob(jobId)).toBe("done");
    expect(await exists(app.uploads.absDir(t.id))).toBe(false);
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("korunmalı");
  });

  it("AC-242 FAILED: yeniden etkinleştirme 409 (kısmen silindi), önizleme 409 vermez, yeni önizlemeyle 202 RUNNING ve tamamlanır", async () => {
    const f = await seedPurgeTenant(app);
    await makeEligible(app, sa, f.tenantId);
    const { jobId } = await scheduleDue(f.tenantId, f.tenantName);
    await testFixtureDb()
      .$executeRaw`UPDATE tenant_purge_jobs SET state = 'FAILED', last_error = 'other', attempts = 4 WHERE id = ${jobId}`;
    const re = await app.inject({
      method: "POST",
      url: `/api/v1/admin/tenants/${f.tenantId}/reactivate`,
      headers: sa.headers,
      payload: {},
    });
    expect(re.statusCode).toBe(409);
    expect(re.json<{ error: { message: string } }>().error.message).toBe(TENANT_REACTIVATE_PURGE_PARTIAL_MESSAGE);
    expect(
      (await app.inject({ method: "DELETE", url: url(f.tenantId), headers: sa.headers })).json<{ error: unknown }>().error,
    ).toMatchObject({ code: "CONFLICT", fields: { state: "FAILED" } });
    const p = await preview(f.tenantId);
    expect(p.statusCode, p.body).toBe(200);
    const r = await schedule(f.tenantId, p.json<TenantPurgePreviewResponse>().previewId, f.tenantName);
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toMatchObject({ jobId, state: "RUNNING" });
    expect(await runner().tick()).toBe("done");
    expect((await testDb().tenantPurgeJob.findUniqueOrThrow({ where: { id: jobId } })).state).toBe("DONE");
  });

  it("AC-242 GET purge: iş yoksa 404; purge-jobs sorgu doğrulaması; metrikler bütün durumları yayımlar", async () => {
    const t = await createTenant();
    expect((await app.inject({ method: "GET", url: url(t.id), headers: sa.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/purge-jobs?open=x", headers: sa.headers })).statusCode).toBe(400);
    await app.tenantPurge.refreshMetrics();
    const text = app.metrics.render();
    for (const s of ["SCHEDULED", "RUNNING", "DONE", "FAILED", "CANCELLED"])
      expect(text).toMatch(new RegExp(`rs_tenant_purge_jobs\\{role="${s}"\\} \\d+`));
    expect(text).toContain("rs_erasure_ledger_write_failed_total");
    expect(text).toContain("rs_tenant_purge_last_heartbeat_seconds");
  });
});
