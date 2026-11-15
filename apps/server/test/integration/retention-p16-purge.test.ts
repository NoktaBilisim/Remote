// P16 G2 — gece kalıcı silme `purgeAnonymized` (AC-240; ADR-0030 m.2, mimari-e11 §7.2, S16-8, S16-10, S16-14).
// Saklama işi global adımları (audit 730 g, iş satırları) da çalıştırdığı için `serial-retention` projesinde koşar
// (vitest.config.ts). Geçmiş tarihli `anonymized_at` / `revoked_at` fikstürleri migrator ile (S16-3 tetikleyicisinden muaf);
// iş `app` ile, kesme DB saatiyle. Zaman ofsetleri DB saatine göre dakika cinsinden (`UTC_TIMESTAMP(3) - INTERVAL n MINUTE`).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RETENTION_AUDIT } from "@remote/contracts/audit";
import { RetentionJob } from "../../src/jobs/retention.ts";
import { isP16Signal } from "../../src/lib/db.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, makeApp, testDb, testFixtureDb } from "../helpers/app.ts";
import { createRequestRow } from "../helpers/requests.ts";
import { FAKE_METRICS_TOKEN } from "../helpers/secrets.ts";

// Firma listesi bu dosyanın firmalarıyla sınırlanır (retention-p13a-job ile aynı gerekçe: süre başka verilerden bağımsız).
const scope = vi.hoisted(() => ({ tenantIds: new Set<string>() }));
vi.mock("../../src/requests/repo.ts", async (orig) => {
  const actual = await orig<typeof import("../../src/requests/repo.ts")>();
  return {
    ...actual,
    retentionTenants: async (...args: Parameters<typeof actual.retentionTenants>) =>
      (await actual.retentionTenants(...args)).filter((t) => scope.tenantIds.has(t.tenantId)),
  };
});

// db_signal: seçilen firmanın oturum partisi, gerçek tetikleyiciye çarpan bir DELETE çalıştırır (taze anonim oturum).
const signal = vi.hoisted(() => ({ tenantId: "", sessionId: "", caught: null as unknown }));
vi.mock("../../src/jobs/retention-repo.ts", async (orig) => {
  const actual = await orig<typeof import("../../src/jobs/retention-repo.ts")>();
  return {
    ...actual,
    purgeSessionsBatch: async (...args: Parameters<typeof actual.purgeSessionsBatch>) => {
      if (args[1] === signal.tenantId) {
        try {
          await args[0].$executeRaw`DELETE FROM support_sessions WHERE id = ${signal.sessionId}`;
        } catch (err) {
          signal.caught = err;
          throw err;
        }
      }
      return actual.purgeSessionsBatch(...args);
    },
  };
});

const DAY_MIN = 24 * 60;
const HOUR_MS = 3_600_000;
const fx = () => testFixtureDb();

let app: FastifyInstance;
let on: RetentionJob;
let dry: RetentionJob;
beforeAll(async () => {
  app = makeApp({ env: { METRICS_TOKEN: FAKE_METRICS_TOKEN } });
  await app.ready();
  on = new RetentionJob(app.requests, { purgeMode: "on" });
  dry = new RetentionJob(app.requests, { purgeMode: "dry" });
});
afterAll(async () => {
  await app?.close();
  await fx().$disconnect();
});

async function tenant() {
  const t = await createTenant();
  scope.tenantIds.add(t.id);
  await testDb().tenantSettings.update({ where: { tenantId: t.id }, data: { retentionDays: 90 } });
  const tech = await createUser({ tenantId: t.id, role: "USER" });
  return { id: t.id, techId: tech.id };
}

/**
 * Anonim oturum + (anonim) onay; `anonymized_at` = DB saati − `minutesAgo`. İsteğe bağlı talebe bağlanır (talep oturumu:
 * TTL 60 sn — `support_sessions_ttl_chk`; SET soldan sağa: `created_at` önce kaydırılır).
 */
async function anonSession(t: { id: string; techId: string }, minutesAgo: number, requestId?: string) {
  const s = await createSupportSessionRow({ tenantId: t.id, technicianId: t.techId, status: "EXPIRED" });
  await testDb().sessionConsent.create({
    data: { id: newId(), sessionId: s.id, tenantId: t.id, level: "VIEW", decision: "DENIED", source: "SYSTEM" },
  });
  await fx().$executeRaw`UPDATE support_sessions SET created_at = created_at - INTERVAL 40 DAY,
      expires_at = IF(${requestId ?? null} IS NULL, expires_at - INTERVAL 40 DAY, created_at + INTERVAL 60 SECOND), ended_at = ended_at - INTERVAL 40 DAY,
      request_id = ${requestId ?? null}, anonymized_at = UTC_TIMESTAMP(3) - INTERVAL ${minutesAgo} MINUTE
    WHERE id = ${s.id}`;
  return s.id;
}

/** Anonim (kapanmış) talep; `anonymized_at` = DB saati − `minutesAgo`. */
async function anonRequest(tenantId: string, minutesAgo: number) {
  const r = await createRequestRow(tenantId);
  await fx().$executeRaw`UPDATE support_requests SET status = 'EXPIRED', created_at = created_at - INTERVAL 40 DAY,
      consented_at = consented_at - INTERVAL 40 DAY, expires_at = expires_at - INTERVAL 40 DAY,
      closed_at = expires_at, customer_name = NULL, customer_phone = NULL, customer_email = NULL, description = NULL,
      ip = NULL, ip_key = NULL, net_key = NULL, device_hash = NULL,
      anonymized_at = UTC_TIMESTAMP(3) - INTERVAL ${minutesAgo} MINUTE
    WHERE id = ${r.id}`;
  return r.id;
}

/** Kayıt; `revokedMinutesAgo` verilirse DB saatine göre geçmişte iptal edilmiş. */
async function binding(tenantId: string, sessionId: string, revokedMinutesAgo?: number) {
  const id = newId();
  await testDb().deviceBinding.create({
    data: {
      id,
      tenantId,
      keyHash: sha256Hex(newId()),
      clientVersion: "0.10.0",
      firstSessionId: sessionId,
      lastSessionId: sessionId,
      lastUsedAt: new Date(),
    },
  });
  if (revokedMinutesAgo !== undefined)
    await fx().$executeRaw`UPDATE device_bindings SET revoked_at = UTC_TIMESTAMP(3) - INTERVAL ${revokedMinutesAgo} MINUTE,
      revoke_reason = 'EXPIRED', key_hash = NULL WHERE id = ${id}`;
  return id;
}

const exists = {
  session: async (id: string) => (await testDb().supportSession.count({ where: { id } })) === 1,
  request: async (id: string) => (await testDb().supportRequest.count({ where: { id } })) === 1,
  binding: async (id: string) => (await testDb().deviceBinding.count({ where: { id } })) === 1,
  consents: (sessionId: string) => testDb().sessionConsent.count({ where: { sessionId } }),
};

const lastAudit = async (tenantId: string | null) =>
  (
    await testDb().auditLog.findMany({
      where: { action: RETENTION_AUDIT.RUN, tenantId },
      orderBy: { id: "desc" },
      take: 1,
      select: { newValue: true, result: true, createdAt: true },
    })
  )[0];
const metricsText = async () =>
  (await app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${FAKE_METRICS_TOKEN}` } })).body;

describe("P16 gece kalıcı silme (AC-240)", () => {
  it("AC-240: DB saatiyle 30 g ± 1 sa sınırı, FK sırası (kayıt → oturum/onay → talep), kayda bağlı oturum kalır; ikinci koşu 0", async () => {
    const t = await tenant();
    const rLinked = await anonRequest(t.id, 31 * DAY_MIN);
    const sOld = await anonSession(t, 30 * DAY_MIN + 120, rLinked); // 30 g + 2 sa → silinir
    const sMargin = await anonSession(t, 30 * DAY_MIN + 30); // 30 g + 30 dk → 1 sa pay içinde, kalır
    const sYoung = await anonSession(t, 29 * DAY_MIN); // kalır
    const sBound = await anonSession(t, 31 * DAY_MIN);
    const bLive = await binding(t.id, sBound); // etkin kayıt → oturum kalır
    const sViaRevoked = await anonSession(t, 31 * DAY_MIN);
    const bRevoked = await binding(t.id, sViaRevoked, 31 * DAY_MIN); // anonim talepten başka bağı yok → silinir
    const rOfBinding = await anonRequest(t.id, 31 * DAY_MIN);
    await fx().$executeRaw`UPDATE support_requests SET binding_id = ${bRevoked} WHERE id = ${rOfBinding}`;
    const bRevokedYoung = await binding(t.id, await anonSession(t, 31 * DAY_MIN), 29 * DAY_MIN); // iptal 29 g → kalır
    const rOrphan = await anonRequest(t.id, 30 * DAY_MIN + 120);
    const rMargin = await anonRequest(t.id, 30 * DAY_MIN + 30);
    const rLive = (await createRequestRow(t.id)).id;

    const r = await on.run();
    expect(r?.failures).toBe(0);
    for (const id of [sOld, sViaRevoked]) expect(await exists.session(id)).toBe(false);
    for (const id of [sOld, sViaRevoked]) expect(await exists.consents(id)).toBe(0);
    for (const id of [sMargin, sYoung, sBound]) expect(await exists.session(id)).toBe(true);
    expect(await exists.consents(sBound)).toBe(1);
    expect(await exists.binding(bRevoked)).toBe(false);
    expect(await exists.binding(bLive)).toBe(true);
    expect(await exists.binding(bRevokedYoung)).toBe(true);
    for (const id of [rLinked, rOfBinding, rOrphan]) expect(await exists.request(id)).toBe(false);
    for (const id of [rMargin, rLive]) expect(await exists.request(id)).toBe(true);

    const a = await lastAudit(t.id);
    expect(a?.result).toBe("success");
    expect(a?.newValue).toMatchObject({ purgedSessions: 2, purgedConsents: 2, purgedFiles: 0, purgedRequests: 3, purgedBindings: 1 });
    expect(a?.newValue).not.toHaveProperty("purgeCandidates");
    const m = await metricsText();
    expect(m).toMatch(/rs_retention_rows_total\{kind="purged_sessions"\} [1-9]/);
    expect(m).toMatch(/rs_retention_rows_total\{kind="purged_bindings"\} [1-9]/);

    // İkinci koşu: hiçbir satır silinmez, firma için yeni audit yazılmaz.
    const auditsBefore = await testDb().auditLog.count({ where: { action: RETENTION_AUDIT.RUN, tenantId: t.id } });
    const r2 = await on.run();
    expect(r2?.failures).toBe(0);
    expect(r2?.totals).toMatchObject({ purgedSessions: 0, purgedConsents: 0, purgedRequests: 0, purgedBindings: 0, purgedFiles: 0 });
    expect(await testDb().auditLog.count({ where: { action: RETENTION_AUDIT.RUN, tenantId: t.id } })).toBe(auditsBefore);
    for (const id of [sMargin, sYoung, sBound]) expect(await exists.session(id)).toBe(true);
  });

  it("AC-240 / S16-8: uygulama saati +2 sa ileride iken parti takılmaz (kesme DB saatiyle); anonimleştirme damgaları DB saati (S16-14)", async () => {
    const t = await tenant();
    const sOld = await anonSession(t, 30 * DAY_MIN + 120);
    // 29 g 23 sa: uygulama saatiyle (+2 sa) hesaplanan kesme bu adayı seçerdi → tetikleyici SIGNAL → parti her gece geri alınırdı.
    const sEdge = await anonSession(t, 30 * DAY_MIN - 60);
    await expect(testDb().$executeRaw`DELETE FROM support_sessions WHERE id = ${sEdge}`).rejects.toSatisfy(isP16Signal);
    // Saklama süresi dolmuş talep + boşta kayıt: iş +2 sa saatle anonimleştirir/iptal eder; damga DB saati.
    const rFresh = (await createRequestRow(t.id, { createdAt: new Date(Date.now() - 100 * 86_400_000) })).id;
    const bIdle = await binding(t.id, await anonSession(t, 10));
    await testDb().deviceBinding.update({ where: { id: bIdle }, data: { lastUsedAt: new Date(Date.now() - 100 * 86_400_000) } });

    const r = await on.run(new Date(Date.now() + 2 * HOUR_MS));
    expect(r?.failures).toBe(0);
    expect(await exists.session(sOld)).toBe(false);
    expect(await exists.session(sEdge)).toBe(true);
    const req = await testDb().supportRequest.findUniqueOrThrow({
      where: { id: rFresh },
      select: { anonymizedAt: true, customerName: true },
    });
    expect(req.customerName).toBeNull();
    expect(Math.abs((req.anonymizedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
    const b = await testDb().deviceBinding.findUniqueOrThrow({
      where: { id: bIdle },
      select: { revokedAt: true, revokeReason: true, keyHash: true },
    });
    expect(b).toMatchObject({ revokeReason: "EXPIRED", keyHash: null });
    expect(Math.abs((b.revokedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
    expect((await lastAudit(t.id))?.result).toBe("success");
  });

  it("AC-240: `dry` modu hiçbir satır silmez; adaylar audit'te `purgeCandidates`, metrikte `purge_candidate_*`", async () => {
    const t = await tenant();
    const s = await anonSession(t, 31 * DAY_MIN);
    const rq = await anonRequest(t.id, 31 * DAY_MIN);
    const r = await dry.run();
    expect(r?.failures).toBe(0);
    expect(await exists.session(s)).toBe(true);
    expect(await exists.consents(s)).toBe(1);
    expect(await exists.request(rq)).toBe(true);
    const a = await lastAudit(t.id);
    expect(a?.newValue).toMatchObject({ purgeCandidates: { sessions: 1, consents: 1, files: 0, requests: 1, bindings: 0 } });
    expect(a?.newValue).not.toHaveProperty("purgedSessions");
    expect(await metricsText()).toMatch(/rs_retention_rows_total\{kind="purge_candidate_sessions"\} [1-9]/);
    // Aynı veriyle `on`: dry sayıları gerçekten silinir.
    await on.run();
    expect(await exists.session(s)).toBe(false);
    expect(await exists.request(rq)).toBe(false);
  });

  it("AC-240: partide tetikleyici reddi `db_signal` sınıfı + metrik + fail audit; sıradaki firma işlenir", async () => {
    const bad = await tenant();
    const good = await tenant();
    const sBadOld = await anonSession(bad, 31 * DAY_MIN);
    signal.sessionId = await anonSession(bad, DAY_MIN); // 1 g önce anonim → DELETE SIGNAL
    const sGood = await anonSession(good, 31 * DAY_MIN);
    signal.tenantId = bad.id;
    let r: Awaited<ReturnType<RetentionJob["run"]>>;
    try {
      r = await on.run();
    } finally {
      signal.tenantId = "";
    }
    expect(isP16Signal(signal.caught)).toBe(true);
    expect(r?.failures).toBe(1);
    expect(await exists.session(sGood)).toBe(false);
    expect(await exists.session(sBadOld)).toBe(true); // parti geri alındı
    expect((await lastAudit(bad.id))?.result).toBe("fail");
    expect((await lastAudit(good.id))?.result).toBe("success");
    expect(await metricsText()).toMatch(/rs_retention_failures_total\{class="db_signal"\} 1\n/);
    // Hata giderilince sonraki tur tamamlar.
    await on.run();
    expect(await exists.session(sBadOld)).toBe(false);
  });

  it("AC-240: açık firma silme işi (SCHEDULED) olan firma atlanır; iş kapanınca işlenir", async () => {
    const t = await tenant();
    const s = await anonSession(t, 31 * DAY_MIN);
    const admin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const jobId = newId();
    await testDb().tenantPurgeJob.create({
      data: { id: jobId, tenantId: t.id, scheduledFor: new Date(), counts: {}, previewHash: sha256Hex(newId()), startedBy: admin.id },
    });
    const auditsBefore = await testDb().auditLog.count({ where: { action: RETENTION_AUDIT.RUN, tenantId: t.id } });
    await on.run();
    expect(await exists.session(s)).toBe(true);
    expect(await testDb().auditLog.count({ where: { action: RETENTION_AUDIT.RUN, tenantId: t.id } })).toBe(auditsBefore);
    await testDb().tenantPurgeJob.update({
      where: { id: jobId },
      data: { state: "CANCELLED", cancelledBy: admin.id, cancelledAt: new Date() },
    });
    await on.run();
    expect(await exists.session(s)).toBe(false);
  });

  it("AC-240 / S16-10: DONE/CANCELLED iş satırı 730 g sonra silinir, daha yenisi kalır; global audit `purgedJobs`", async () => {
    const t = await tenant();
    const admin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const job = async (daysAgo: number) => {
      const id = newId();
      await fx().$executeRaw`INSERT INTO tenant_purge_jobs (id, tenant_id, state, step, scheduled_for, counts, attempts,
          preview_hash, started_by, cancelled_by, cancelled_at, created_at, updated_at)
        VALUES (${id}, ${t.id}, 'CANCELLED', 'FENCE', UTC_TIMESTAMP(3) - INTERVAL ${daysAgo + 1} DAY, '{}', 0, ${sha256Hex(id)},
          ${admin.id}, ${admin.id}, UTC_TIMESTAMP(3) - INTERVAL ${daysAgo} DAY, UTC_TIMESTAMP(3) - INTERVAL ${daysAgo + 1} DAY,
          UTC_TIMESTAMP(3) - INTERVAL ${daysAgo} DAY)`;
      return id;
    };
    const old = await job(731);
    const keep = await job(729);
    const r = await on.run();
    expect(r?.failures).toBe(0);
    expect(await testDb().tenantPurgeJob.count({ where: { id: old } })).toBe(0);
    expect(await testDb().tenantPurgeJob.count({ where: { id: keep } })).toBe(1);
    expect((await lastAudit(null))?.newValue).toMatchObject({ purgedJobs: 1 });
  });
});
