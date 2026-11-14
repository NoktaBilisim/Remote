// P13a saklama işi (jobs/retention.ts) + geçmiş sözleşmesi (AC-197, AC-198, AC-199). İş tüm firmalarda ve global
// tablolarda çalıştığı (audit 730 g silme dahil) için bu dosya vitest'te ayrı projede, diğer dosyalar bittikten SONRA koşar
// (vitest.config.ts). Gerçek MySQL: app (TEST_DATABASE_URL) + migrator (geçmiş tarihli audit fikstürü, tetikleyici muafı).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ANONYMIZED_MESSAGE, SESSION_CSV_ANONYMIZED, type SessionHistoryDetail, type SessionListResponse } from "@remote/contracts/api/sessions";
import { RETENTION_AUDIT } from "@remote/contracts/audit";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { RetentionJob, SESSION_BATCH } from "../../src/jobs/retention.ts";
import { createSupportSessionRow, createTenant, createUser, loginAs, makeApp, testDb, testFixtureDb, type Session, type TestUser } from "../helpers/app.ts";
import { FAKE_METRICS_TOKEN } from "../helpers/secrets.ts";

// AC-199 fail-soft: seçilen tenant'ın oturum adımı hata verir; diğerleri sürer.
const failing = vi.hoisted(() => ({ tenantId: "" }));
vi.mock("../../src/jobs/retention-repo.ts", async (orig) => {
  const actual = await orig<typeof import("../../src/jobs/retention-repo.ts")>();
  return {
    ...actual,
    anonymizeSessionBatch: async (...args: Parameters<typeof actual.anonymizeSessionBatch>) => {
      if (args[1] === failing.tenantId) throw new Error("p13a test: tenant adımı hatası");
      return actual.anonymizeSessionBatch(...args);
    },
  };
});

const DAY = 86_400_000;
const HIST = { "sessions.view": true, "session_history.view": true, "session_history.edit": true, "session_history.export": true };

let app: FastifyInstance;
afterAll(async () => {
  await app?.close();
  await testFixtureDb().$disconnect();
});
beforeAll(async () => {
  app = makeApp({ env: { METRICS_TOKEN: FAKE_METRICS_TOKEN } });
  await app.ready();
});

async function tenantWith(retentionDays: number) {
  const t = await createTenant();
  await testDb().tenantSettings.update({ where: { tenantId: t.id }, data: { retentionDays } });
  return t.id;
}

/** Kişisel alanları dolu bitmiş oturum + onay (ip/UA) + dosya meta + müşteri adlı zaman çizelgesi audit'i. */
async function finishedSession(tenantId: string, technicianId: string, ageDays: number, status: "ENDED" | "EXPIRED" | "CANCELLED" = "ENDED") {
  const id = newId();
  const createdAt = new Date(Date.now() - ageDays * DAY);
  const consumed = status === "ENDED";
  await testDb().supportSession.create({
    data: {
      id,
      tenantId,
      technicianId,
      tokenHash: sha256Hex(newId()),
      techVerifyCode: "1234",
      status,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
      endedAt: new Date(createdAt.getTime() + 600_000),
      endedBy: consumed ? "CUSTOMER" : "SYSTEM",
      endReason: consumed ? "customer" : status.toLowerCase(),
      // customer_consumed_chk / guest_keys_chk: ad, e-posta ve misafir ağ anahtarları yalnız admit edilmiş oturumda.
      ...(consumed
        ? { consumedAt: new Date(createdAt.getTime() + 5_000), mode: "BROWSER", qualitySummary: { fps: { avg: 20, min: 15, max: 25 }, kbps: { avg: 900, min: 500, max: 1200 }, rttMs: { avg: 30, min: 20, max: 50 }, connType: "host" }, customerName: "Ayşe Yılmaz", customerEmail: "ayse@example.test", guestNetKey: "4:203.0.113", guestIpKey: "4:203.0.113.7" }
        : {}),
      note: "Müşteri notu",
      ticketNo: "TCK-42",
    },
  });
  await testDb().sessionConsent.create({ data: { id: newId(), sessionId: id, tenantId, level: "VIEW", decision: "GRANTED", source: "UI", ip: "203.0.113.7", userAgent: "Mozilla/5.0" } });
  await testDb().sessionFile.create({ data: { id: newId(), sessionId: id, tenantId, direction: "TO_TECH", fileName: "rapor.pdf", sizeBytes: 10n, sha256: "a".repeat(64), result: "OK" } });
  await testDb().auditLog.create({ data: { tenantId, username: "customer", action: "guest.pending", entity: "support_sessions", entityId: id, newValue: { name: "Ayşe Yılmaz" }, result: "success" } });
  return id;
}

const retentionAudits = (tenantId: string | null) =>
  testDb().auditLog.findMany({ where: { action: RETENTION_AUDIT.RUN, tenantId }, orderBy: { id: "asc" }, select: { newValue: true, result: true, username: true, userId: true, entity: true } });

describe("P13a saklama işi — oturum anonimleştirme (AC-197)", () => {
  let tenantId: string;
  let tech: TestUser;
  let techS: Session;
  let oldEnded: string;
  let oldExpired: string;
  let young: string;
  let oldPending: string;

  beforeAll(async () => {
    tenantId = await tenantWith(90);
    tech = await createUser({ tenantId, role: "ADMIN", perms: HIST });
    oldEnded = await finishedSession(tenantId, tech.id, 100);
    oldExpired = await finishedSession(tenantId, tech.id, 100, "EXPIRED");
    young = await finishedSession(tenantId, tech.id, 80);
    oldPending = (await createSupportSessionRow({ tenantId, technicianId: tech.id, createdAt: new Date(Date.now() - 100 * DAY) })).id;
  });

  // Sahte saatli tur giriş oturumlarını da (+7 g) sildiği için her test yeni oturumla.
  beforeEach(async () => {
    techS = await loginAs(app, tech);
  });

  it("AC-197: bitmiş + süresi dolmuş oturumların kişisel alanları NULL, onay ip/UA NULL, dosya satırı silinir; ticket/mod/kalite kalır", async () => {
    const r = await app.retention.run();
    expect(r).not.toBeNull();
    for (const id of [oldEnded, oldExpired]) {
      const s = await testDb().supportSession.findUniqueOrThrow({ where: { id } });
      expect(s).toMatchObject({ customerName: null, customerEmail: null, note: null, guestNetKey: null, guestIpKey: null, ticketNo: "TCK-42" });
      expect(s.anonymizedAt).not.toBeNull();
      const consents = await testDb().sessionConsent.findMany({ where: { sessionId: id } });
      expect(consents).toHaveLength(1);
      expect(consents[0]).toMatchObject({ ip: null, userAgent: null, decision: "GRANTED", level: "VIEW", source: "UI" });
      expect(await testDb().sessionFile.count({ where: { sessionId: id } })).toBe(0);
    }
    const ended = await testDb().supportSession.findUniqueOrThrow({ where: { id: oldEnded } });
    expect(ended).toMatchObject({ mode: "BROWSER" });
    expect(ended.qualitySummary).not.toBeNull();
    // Saklama süresi dolmamış ve bitmemiş oturum değişmez.
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: young } })).toMatchObject({ customerName: "Ayşe Yılmaz", anonymizedAt: null });
    expect(await testDb().sessionFile.count({ where: { sessionId: young } })).toBe(1);
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: oldPending } })).toMatchObject({ anonymizedAt: null });
    const audits = await retentionAudits(tenantId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ result: "success", username: "system", userId: null, entity: "retention" });
    expect(audits[0]?.newValue).toEqual({ sessions: 2, consents: 2, files: 2, requests: 0, customers: 0, bindings: 0 });
  });

  it("AC-197: aynı gün ikinci çalıştırma hiçbir satırı değiştirmez (idempotent) ve audit yazmaz", async () => {
    const before = await testDb().supportSession.findUniqueOrThrow({ where: { id: oldEnded }, select: { anonymizedAt: true, updatedAt: true } });
    const r = await app.retention.run();
    expect(r?.failures).toBe(0);
    expect(Object.values(r?.totals ?? {}).reduce((a, b) => a + b, 0)).toBe(0);
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: oldEnded }, select: { anonymizedAt: true, updatedAt: true } })).toEqual(before);
    expect(await retentionAudits(tenantId)).toHaveLength(1);
  });

  it("AC-197: saat ileri alınınca (sahte saat) süresi yeni dolan oturum anonimleşir", async () => {
    await app.retention.run(new Date(Date.now() + 20 * DAY));
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: young } })).toMatchObject({ customerName: null, note: null });
  });

  it("AC-197: liste/detay `anonymized`, müşteri adı hiçbir alanda yok (zaman çizelgesi dahil), dosyalar boş", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/v1/sessions?pageSize=100", headers: techS.headers })).json<SessionListResponse>();
    const item = list.items.find((i) => i.id === oldEnded);
    expect(item).toMatchObject({ anonymized: true, customerName: null, ticketNo: "TCK-42" });
    const res = await app.inject({ method: "GET", url: `/api/v1/sessions/${oldEnded}/history`, headers: techS.headers });
    expect(res.statusCode).toBe(200);
    const d = res.json<SessionHistoryDetail>();
    expect(d).toMatchObject({ anonymized: true, customerName: null, customerEmail: null, note: null, files: [] });
    expect(d.quality).not.toBeNull();
    const pending = d.timeline.find((e) => e.action === "guest.pending");
    expect(pending).toMatchObject({ actor: "CUSTOMER", actorName: null });
    expect(pending?.details).not.toHaveProperty("name");
    expect(res.body).not.toContain("Ayşe");
  });

  it("AC-197: anonim olmayan oturum `anonymized: false` ve ad görünür (kapsam değişmedi)", async () => {
    const other = await finishedSession(tenantId, tech.id, 1);
    const d = (await app.inject({ method: "GET", url: `/api/v1/sessions/${other}/history`, headers: techS.headers })).json<SessionHistoryDetail>();
    expect(d).toMatchObject({ anonymized: false, customerName: "Ayşe Yılmaz" });
    expect(d.timeline.find((e) => e.action === "guest.pending")).toMatchObject({ actorName: "Ayşe Yılmaz" });
  });

  it("AC-197: anonim oturumu düzenleme 409 SESSION_ANONYMIZED (not ve ticket); DB değişmez", async () => {
    for (const payload of [{ note: "yeni not" }, { ticketNo: "X-1" }]) {
      const res = await app.inject({ method: "PATCH", url: `/api/v1/sessions/${oldEnded}`, headers: techS.headers, payload });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string; message: string } }>().error).toMatchObject({ code: "SESSION_ANONYMIZED", message: SESSION_ANONYMIZED_MESSAGE });
    }
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: oldEnded } })).toMatchObject({ note: null, ticketNo: "TCK-42" });
  });

  it("AC-197: başka tenant'ın anonim oturumu 404 kalır (AC-61 kapsamı 409'dan önce)", async () => {
    const otherTenant = await tenantWith(90);
    const outsider = await loginAs(app, await createUser({ tenantId: otherTenant, role: "ADMIN", perms: HIST }));
    const res = await app.inject({ method: "PATCH", url: `/api/v1/sessions/${oldEnded}`, headers: outsider.headers, payload: { note: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("AC-197: CSV'de anonim satır \"Anonimleştirildi\", müşteri adı ve not yok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/export.csv", headers: techS.headers });
    expect(res.statusCode).toBe(200);
    const line = res.body.split("\r\n").find((l) => l.startsWith(oldEnded));
    expect(line).toContain(SESSION_CSV_ANONYMIZED);
    expect(line).toContain("TCK-42");
    expect(line).not.toContain("Ayşe");
    expect(line).not.toContain("Müşteri notu");
  });
});

describe("P13a saklama işi — global silmeler (AC-198)", () => {
  it("AC-198: 730 günden eski audit silinir, daha yenisi kalır; giriş oturumu/sıfırlama bağlantısı +7 g; firma alanı boş tek retention.run", async () => {
    const mig = testFixtureDb();
    const old = await mig.auditLog.create({ data: { action: "p13a.job", entity: "audit_logs", result: "success", createdAt: new Date(Date.now() - 731 * DAY) }, select: { id: true } });
    const keep = await mig.auditLog.create({ data: { action: "p13a.job", entity: "audit_logs", result: "success", createdAt: new Date(Date.now() - 729 * DAY) }, select: { id: true } });
    const user = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const sess = async (expiresDaysAgo: number, revokedDaysAgo: number | null) => {
      const id = newId();
      await testDb().authSession.create({
        data: { id, userId: user.id, tokenHash: sha256Hex(newId()), ip: "198.51.100.1", userAgent: "ua", lastSeenAt: new Date(), expiresAt: new Date(Date.now() - expiresDaysAgo * DAY), revokedAt: revokedDaysAgo === null ? null : new Date(Date.now() - revokedDaysAgo * DAY) },
      });
      return id;
    };
    const expiredOld = await sess(8, null);
    // İş saati +1 g ileride: kesme noktası "5 g önce" (yeni kayıtlar 4 g önceden yeni).
    const revokedRecently = await sess(8, 3); // max(expires, revoked) = 3 g önce → kalır
    const expiredRecent = await sess(4, null);
    const token = async (expiresDaysAgo: number) => {
      const id = newId();
      const expiresAt = new Date(Date.now() - expiresDaysAgo * DAY);
      await testDb().passwordResetToken.create({ data: { id, userId: user.id, tokenHash: sha256Hex(newId()), createdAt: new Date(expiresAt.getTime() - 30 * 60_000), expiresAt } });
      return id;
    };
    const tokOld = await token(8);
    const tokRecent = await token(4);
    const auditsBefore = (await retentionAudits(null)).length;

    // İş saati DB'den ileride olsa da (sahte saat) audit silme tetikleyici sınırını aşmaz (ifade geri alınmaz).
    const r = await app.retention.run(new Date(Date.now() + 1 * DAY));
    expect(r?.failures).toBe(0);
    expect(await testDb().auditLog.count({ where: { id: old.id } })).toBe(0);
    expect(await testDb().auditLog.count({ where: { id: keep.id } })).toBe(1);
    expect(await testDb().authSession.findMany({ where: { id: { in: [expiredOld, revokedRecently, expiredRecent] } }, select: { id: true } })).toEqual(
      expect.arrayContaining([{ id: revokedRecently }, { id: expiredRecent }]),
    );
    expect(await testDb().authSession.count({ where: { id: expiredOld } })).toBe(0);
    expect(await testDb().passwordResetToken.count({ where: { id: tokOld } })).toBe(0);
    expect(await testDb().passwordResetToken.count({ where: { id: tokRecent } })).toBe(1);
    const audits = await retentionAudits(null);
    expect(audits).toHaveLength(auditsBefore + 1);
    const g = audits.at(-1)?.newValue as Record<string, number>;
    expect(Object.keys(g).sort()).toEqual(["audit", "authSessions", "resetTokens"]);
    expect(g.audit).toBeGreaterThanOrEqual(1);
    expect(g.authSessions).toBeGreaterThanOrEqual(1);
    expect(g.resetTokens).toBeGreaterThanOrEqual(1);
  });

  it("AC-198: uygulama kullanıcısı 730 günden yeni audit'i silemez ve eklediği kaydı geri tarihleyemez", async () => {
    const row = await testDb().auditLog.create({ data: { action: "p13a.job", entity: "audit_logs", result: "success", createdAt: new Date("2019-01-01T00:00:00Z") }, select: { id: true, createdAt: true } });
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
    await expect(testDb().auditLog.deleteMany({ where: { id: row.id } })).rejects.toThrow(/older than 730 days/);
  });
});

describe("P13a saklama işi — partiler, fail-soft, metrikler (AC-199)", () => {
  it(`AC-199: ${SESSION_BATCH + 1} aday oturum 1.000'lik partilerle tamamlanır`, async () => {
    const tenantId = await tenantWith(90);
    const tech = await createUser({ tenantId, role: "USER" });
    const at = new Date(Date.now() - 100 * DAY);
    await testDb().supportSession.createMany({
      data: Array.from({ length: SESSION_BATCH + 1 }, () => ({
        id: newId(),
        tenantId,
        technicianId: tech.id,
        tokenHash: sha256Hex(newId()),
        techVerifyCode: "1234",
        status: "ENDED",
        createdAt: at,
        expiresAt: new Date(at.getTime() + 15 * 60_000),
        consumedAt: at,
        mode: "AGENT",
        endedAt: at,
        endedBy: "CUSTOMER",
        endReason: "customer",
        customerName: "Toplu Müşteri",
      })),
    });
    await app.retention.run();
    expect(await testDb().supportSession.count({ where: { tenantId, anonymizedAt: null } })).toBe(0);
    expect((await retentionAudits(tenantId))[0]?.newValue).toMatchObject({ sessions: SESSION_BATCH + 1 });
  });

  it("AC-199: turlar üst üste binmez (eşzamanlı ikinci çağrı çalışmadan döner)", async () => {
    const [a, b] = await Promise.all([app.retention.run(), app.retention.run()]);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
    expect(app.retention.isRunning).toBe(false);
  });

  it("AC-199: bir firmadaki hata diğer firmaları durdurmaz; fail audit + rs_retention_* metrikleri", async () => {
    const bad = await tenantWith(90);
    const good = await tenantWith(90);
    const tBad = await createUser({ tenantId: bad, role: "USER" });
    const tGood = await createUser({ tenantId: good, role: "USER" });
    const sBad = await finishedSession(bad, tBad.id, 100);
    const sGood = await finishedSession(good, tGood.id, 100);
    failing.tenantId = bad;
    let r: Awaited<ReturnType<RetentionJob["run"]>>;
    try {
      r = await app.retention.run();
    } finally {
      failing.tenantId = "";
    }
    expect(r?.failures).toBe(1);
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: sGood } })).toMatchObject({ customerName: null });
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: sBad } })).toMatchObject({ customerName: "Ayşe Yılmaz", anonymizedAt: null });
    expect((await retentionAudits(bad))[0]).toMatchObject({ result: "fail" });
    expect((await retentionAudits(good))[0]).toMatchObject({ result: "success" });

    const lastOk = app.retention.lastSuccessSeconds;
    const metrics = (await app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${FAKE_METRICS_TOKEN}` } })).body;
    expect(metrics).toMatch(/rs_retention_rows_total\{kind="sessions"\} [1-9]/);
    expect(metrics).toMatch(/rs_retention_rows_total\{kind="audit"\} [1-9]/);
    expect(metrics).toMatch(/rs_retention_failures_total 1\n/);
    expect(metrics).toContain(`rs_retention_last_success_timestamp_seconds ${lastOk}`);
    expect(lastOk).toBeGreaterThan(0); // önceki hatasız turlardan

    // Hata giderilince sonraki tur kalan işi tamamlar ve son başarı zamanı ilerler.
    await app.retention.run();
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: sBad } })).toMatchObject({ customerName: null });
    expect(app.retention.lastSuccessSeconds).toBeGreaterThanOrEqual(lastOk);
  });

  it("AC-199: audit kayıtlarında kişisel veri yok (yalnız sayılar)", async () => {
    const rows = await testDb().auditLog.findMany({ where: { action: RETENTION_AUDIT.RUN }, select: { newValue: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) for (const v of Object.values(r.newValue as Record<string, unknown>)) expect(typeof v).toBe("number");
  });
});
