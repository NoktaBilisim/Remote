// P28e K3 entegrasyon (gerçek MySQL, `app` kullanıcısı): ayar (AC-380/447), rıza satırı (AC-381), parça yükleme/sıra/
// idempotans/şifreli disk (AC-383, AC-375), kota (AC-384), geri alma sonrası durma payı (AC-382, S-P28e-1), izleme (AC-385,
// S-P28e-3), elle silme (AC-386), geçmiş alanları (AC-450, V-PE-3), belirteç bağlamı (S-P28e-6). Oda portu K4'ün yerine sahte.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECORDING_AUDIT, RECORDING_SETTINGS_AUDIT } from "@remote/contracts/audit";
import { REC_CONSENT_LINE_SHA256 } from "@remote/contracts/ws-rec";
import { storageUsage } from "../../src/fsrv/usage.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import type { RecRoomPort, RoomRec } from "../../src/rec/types.ts";
import { CLUSTER_PART, VIDEO_WEBM, el } from "../helpers/rec-webm-k3.ts";
import {
  ORIGIN,
  TEST_FILES_DIR,
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  loginStepUp,
  makeApp,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";

let app: FastifyInstance;
const rooms = new Map<string, RoomRec>();
const stoppedCalls: { sessionId: string; reason: string }[] = [];
const port: RecRoomPort = {
  get: (id) => rooms.get(id),
  partAccepted(id, s, p, at) {
    const r = rooms.get(id);
    if (r) Object.assign(r, { series: s, nextPart: p + 1, lastPartAt: at });
  },
  stopped(id, reason, at) {
    stoppedCalls.push({ sessionId: id, reason });
    const r = rooms.get(id);
    if (r) Object.assign(r, { state: "stopped", stopSeries: r.series, stopNext: r.nextPart, stoppedAt: at });
  },
};

let tenantId: string;
let admin: TestUser;
let adminS: Session;
let authSessionId: string;
const ctx = { ip: "203.0.113.5", userAgent: "vitest", requestId: "r" };

beforeAll(async () => {
  app = makeApp({ fsrvTest: { freeRatio: 0.5 } });
  await app.ready();
  app.rec.service.room = port;
  tenantId = (await createTenant()).id;
  admin = await createUser({ tenantId, role: "ADMIN" });
  adminS = await loginStepUp(app, admin);
  authSessionId = (await testDb().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(adminS.token) } })).id;
  await testDb().tenantSettings.update({ where: { tenantId }, data: { recordingEnabled: true } });
});
afterAll(async () => {
  await app.close();
});

/** Kayıt açık oturum + oda belleği + yükleme belirteci. */
async function recorded(o: { tenant?: string; tech?: TestUser; authId?: string } = {}) {
  const t = o.tenant ?? tenantId;
  const tech = o.tech ?? admin;
  const s = await createSupportSessionRow({ tenantId: t, technicianId: tech.id, status: "ACTIVE" });
  const r = await app.rec.service.startConsent({
    tenantId: t,
    sessionId: s.id,
    recorderUserId: tech.id,
    lineSha256: REC_CONSENT_LINE_SHA256,
    actor: { kind: "customer", ctx },
  });
  if (!r.ok) throw new Error(`kayıt açılmadı: ${r.reason}`);
  rooms.set(s.id, { rid: r.rid, basis: "consent", state: "active", recorderConnId: "c1", series: 0, nextPart: 0, lastPartAt: undefined });
  const token = app.rec.service.issueUploadToken({
    rid: r.rid,
    sessionId: s.id,
    tenantId: t,
    userId: tech.id,
    authSessionId: o.authId ?? authSessionId,
    connId: "c1",
  });
  return { sessionId: s.id, rid: r.rid, token };
}

const put = (rid: string, token: string, s: number, p: number, body: Buffer, extra: Record<string, string> = {}) =>
  app.inject({
    method: "PUT",
    url: `/api/v1/rec/${rid}/series/${s}/parts/${p}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "video/webm",
      "x-rec-duration-ms": "1000",
      ...(p === 0 ? { "x-rec-series-start-ms": String(Date.now()) } : {}),
      ...extra,
    },
    payload: body,
  });
const recRow = (rid: string) => testDb().sessionRecording.findUniqueOrThrow({ where: { id: rid } });

describe("AC-380 / AC-447 ayar", () => {
  it("AC-380 kayıt açma aydınlatma onayı ister, audit eski→yeni; AC-447 gözetimsiz anahtar kutu + step-up ister", async () => {
    const t = (await createTenant()).id;
    const a = await createUser({ tenantId: t, role: "ADMIN" });
    const plain = await loginAs(app, a);
    const putS = (s: Session, payload: object) =>
      app.inject({ method: "PUT", url: "/api/v1/settings/recording", headers: s.headers, payload });
    const g = await app.inject({ method: "GET", url: "/api/v1/settings/recording", headers: plain.headers });
    expect(g.statusCode).toBe(200);
    expect(g.json()).toMatchObject({
      enabled: false,
      retentionDays: 30,
      unattendedEnabled: false,
      maxRetentionDays: 90,
      soleManager: true,
    });
    const noAck = await putS(plain, { enabled: true, retentionDays: 30, unattendedEnabled: false });
    expect(noAck.statusCode).toBe(400);
    expect(noAck.json().error.fields).toHaveProperty("consentUpdated");
    expect((await putS(plain, { enabled: true, retentionDays: 14, unattendedEnabled: false, consentUpdated: true })).statusCode).toBe(200);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: t, action: RECORDING_SETTINGS_AUDIT } });
    expect(audit.newValue).toMatchObject({ enabled: true, retentionDays: 14, consentAck: true });
    expect((await putS(plain, { enabled: false, retentionDays: 14, unattendedEnabled: true })).statusCode).toBe(400);
    const noNotice = await putS(plain, { enabled: true, retentionDays: 14, unattendedEnabled: true });
    expect(noNotice.json().error.fields).toHaveProperty("employeeNoticeAck");
    const noStep = await putS(plain, { enabled: true, retentionDays: 14, unattendedEnabled: true, employeeNoticeAck: true });
    expect(noStep.json().error.code).toBe("MFA_SETUP_REQUIRED"); // 2FA'sız yönetici; step-up yolu aşağıda
    const step = await loginStepUp(app, a);
    const ok = await putS(step, { enabled: true, retentionDays: 14, unattendedEnabled: true, employeeNoticeAck: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ unattendedEnabled: true });
    expect(ok.json().unattendedAckAt).toBeTruthy();
  });

  it("AC-380 §6.5 kapatma ACTIVE kaydı POLICY_OFF ile durdurur, yayın + audit; USER ayara yazamaz", async () => {
    const t = (await createTenant()).id;
    await testDb().tenantSettings.update({ where: { tenantId: t }, data: { recordingEnabled: true } });
    const a = await createUser({ tenantId: t, role: "ADMIN" });
    const s = await loginAs(app, a);
    const r = await recorded({ tenant: t, tech: a });
    const off = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/recording",
      headers: s.headers,
      payload: { enabled: false, retentionDays: 30, unattendedEnabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect(await recRow(r.rid)).toMatchObject({ state: "STOPPED", stopReason: "POLICY_OFF" });
    expect(stoppedCalls).toContainEqual({ sessionId: r.sessionId, reason: "policy_off" });
    const u = await loginAs(app, await createUser({ tenantId: t, role: "USER" }));
    const denied = await app.inject({ method: "PUT", url: "/api/v1/settings/recording", headers: u.headers, payload: {} });
    expect(denied.statusCode).toBe(403);
  });
});

describe("AC-381 / AC-383 / AC-375 başlatma ve parça yükleme", () => {
  it("AC-381 rıza satırı RECORDING GRANTED + line_sha256 + audit recording.start; ikinci başlatma yok", async () => {
    const r = await recorded();
    const c = await testDb().sessionConsent.findFirstOrThrow({ where: { sessionId: r.sessionId, level: "RECORDING" } });
    expect(c).toMatchObject({ decision: "GRANTED", lineSha256: REC_CONSENT_LINE_SHA256 });
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: r.sessionId, action: RECORDING_AUDIT.START } });
    expect(a).toMatchObject({ result: "success", username: "customer" });
    const again = await app.rec.service.startConsent({
      tenantId,
      sessionId: r.sessionId,
      recorderUserId: admin.id,
      lineSha256: REC_CONSENT_LINE_SHA256,
      actor: { kind: "customer", ctx },
    });
    expect(again).toEqual({ ok: false, reason: "unavailable" });
    expect(await app.rec.service.canOffer(tenantId)).toBe(true);
  });

  it("AC-383 sıra, idempotans, yeni bölüm kuralı; disk şifreli (düz WebM yok); kota kayıtları sayar", async () => {
    const r = await recorded();
    const p0 = VIDEO_WEBM();
    const before = await storageUsage(testDb(), tenantId);
    expect((await put(r.rid, r.token, 0, 0, p0)).json()).toEqual({ next: 1 });
    expect((await put(r.rid, r.token, 0, 0, p0)).json()).toEqual({ next: 1 }); // idempotent
    const gap = await put(r.rid, r.token, 0, 2, CLUSTER_PART());
    expect(gap.statusCode).toBe(409);
    expect(gap.json()).toEqual({ next: 1 });
    expect((await put(r.rid, r.token, 0, 1, CLUSTER_PART())).statusCode).toBe(200);
    expect((await put(r.rid, r.token, 1, 1, CLUSTER_PART())).statusCode).toBe(409); // yeni bölüm p=0 olmalı
    expect((await put(r.rid, r.token, 0, 99, CLUSTER_PART())).statusCode).toBe(400); // p > 59
    const row = await recRow(r.rid);
    expect(row).toMatchObject({ partCount: 2, durationMs: 2000 });
    expect(await storageUsage(testDb(), tenantId)).toBe(before + Number(row.sizeBytes));
    const parts = await testDb().sessionRecordingPart.findMany({ where: { recordingId: r.rid } });
    for (const p of parts) {
      expect(p.storageRel.startsWith(`${tenantId}/`)).toBe(true);
      const disk = await readFile(join(TEST_FILES_DIR, p.storageRel));
      expect(disk.subarray(0, 4).toString("ascii")).toBe("RSF1");
      expect(disk.includes(p0.subarray(0, 16))).toBe(false);
    }
  });

  it("AC-375 ses izli başlık 400 + STOPPED{ERROR} + stop audit code invalid; S-P28e-7 p>0 EBML reddi", async () => {
    const a = await recorded();
    const audio = Buffer.concat([
      VIDEO_WEBM().subarray(0, 0),
      el(0x1a45dfa3, el(0x4282, Buffer.from("webm"))),
      Buffer.from([0x18, 0x53, 0x80, 0x67, 0x80]),
    ]);
    expect((await put(a.rid, a.token, 0, 0, audio)).statusCode).toBe(400);
    expect(await recRow(a.rid)).toMatchObject({ state: "STOPPED", stopReason: "ERROR" });
    const stop = await testDb().auditLog.findFirstOrThrow({ where: { entityId: a.sessionId, action: RECORDING_AUDIT.STOP } });
    // `code` anahtarı audit kara listesinde (mask.ts `code`) → "***"; açık nokta tmp-impl notunda.
    expect(stop.newValue).toMatchObject({ reason: "error" });
    const b = await recorded();
    expect((await put(b.rid, b.token, 0, 0, VIDEO_WEBM())).statusCode).toBe(200);
    expect((await put(b.rid, b.token, 0, 1, VIDEO_WEBM())).statusCode).toBe(400);
    expect(await recRow(b.rid)).toMatchObject({ state: "STOPPED", stopReason: "ERROR" });
  });

  it("S-P28e-6 belirteçsiz / rid uyuşmazlığı / çıkış sonrası 404; çerez okunmaz", async () => {
    const r = await recorded();
    const other = await recorded();
    expect((await put(r.rid, "x".repeat(43), 0, 0, VIDEO_WEBM())).statusCode).toBe(404);
    expect((await put(other.rid, r.token, 0, 0, VIDEO_WEBM())).statusCode).toBe(404);
    const t = await createUser({ tenantId, role: "ADMIN" });
    const ts = await loginAs(app, t);
    const authId = (await testDb().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(ts.token) } })).id;
    const mine = await recorded({ tech: t, authId });
    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: ts.headers });
    expect((await put(mine.rid, mine.token, 0, 0, VIDEO_WEBM())).statusCode).toBe(404);
    const noBearer = await app.inject({
      method: "PUT",
      url: `/api/v1/rec/${r.rid}/series/0/parts/0`,
      headers: { ...adminS.headers, "content-type": "video/webm", "x-rec-duration-ms": "1000" },
      payload: VIDEO_WEBM(),
    });
    expect(noBearer.statusCode).toBe(404);
  });
});

describe("AC-384 / AC-382 kota ve durma payı", () => {
  it("AC-384 kota doluyken 409 STORAGE_QUOTA + STOPPED{QUOTA}, dosya yazılmaz; teklif yok", async () => {
    const t = (await createTenant()).id;
    await testDb().tenantSettings.update({ where: { tenantId: t }, data: { recordingEnabled: true } });
    const a = await createUser({ tenantId: t, role: "ADMIN" });
    const as = await loginAs(app, a);
    const authId = (await testDb().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(as.token) } })).id;
    const r = await recorded({ tenant: t, tech: a, authId });
    // Kota 1 GB'yi başka oturumun (durmuş) 1 GiB'lik kaydı doldurur — dosya + kayıt tek kota (V50).
    await testDb().tenant.update({ where: { id: t }, data: { storageQuotaGb: 1 } });
    const filler = await createSupportSessionRow({ tenantId: t, technicianId: a.id, status: "ENDED" });
    const now = new Date();
    await testDb().sessionRecording.create({
      data: {
        id: newId(),
        tenantId: t,
        sessionId: filler.id,
        basis: "CONSENT",
        state: "STOPPED",
        stopReason: "SESSION_END",
        startedAt: now,
        stoppedAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
        sizeBytes: BigInt(1024 ** 3),
        partCount: 1,
      },
    });
    const before = await readdir(join(TEST_FILES_DIR, t)).catch(() => []);
    const res = await put(r.rid, r.token, 0, 0, VIDEO_WEBM());
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("STORAGE_QUOTA");
    expect(await recRow(r.rid)).toMatchObject({ state: "STOPPED", stopReason: "QUOTA" });
    expect(await readdir(join(TEST_FILES_DIR, t)).catch(() => [])).toEqual(before);
    expect(await app.rec.service.canOffer(t)).toBe(false);
    expect(stoppedCalls).toContainEqual({ sessionId: r.sessionId, reason: "quota" });
  });

  it("AC-382 geri alma: REVOKED rıza satırı; pay içinde aynı bölüm kabul, yeni bölüm 404; yeniden başlatma yok", async () => {
    const r = await recorded();
    expect((await put(r.rid, r.token, 0, 0, VIDEO_WEBM())).statusCode).toBe(200);
    const out = await app.rec.service.stop({ tenantId, rid: r.rid, reason: "revoked", actor: { kind: "customer", ctx } });
    expect(out.changed).toBe(true);
    port.stopped(r.sessionId, "revoked", Date.now());
    const rev = await testDb().sessionConsent.findFirst({ where: { sessionId: r.sessionId, level: "RECORDING", decision: "REVOKED" } });
    expect(rev?.lineSha256).toBe(REC_CONSENT_LINE_SHA256);
    expect((await put(r.rid, r.token, 0, 1, CLUSTER_PART())).statusCode).toBe(200);
    expect((await put(r.rid, r.token, 1, 0, VIDEO_WEBM())).statusCode).toBe(404);
    expect((await app.rec.service.stop({ tenantId, rid: r.rid, reason: "revoked", actor: { kind: "system" } })).changed).toBe(false);
  });
});

describe("AC-385 / AC-386 / AC-450 izleme, silme, geçmiş", () => {
  it("AC-385 meta + POST view (audit) + parça GET düz WebM; başka tenant 404; yetkisiz 403; yeni view eskisini düşürür", async () => {
    const r = await recorded();
    const p0 = VIDEO_WEBM();
    await put(r.rid, r.token, 0, 0, p0);
    const meta = await app.inject({ method: "GET", url: `/api/v1/sessions/${r.sessionId}/recording`, headers: adminS.headers });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toMatchObject({
      id: r.rid,
      state: "active",
      basis: "consent",
      series: [{ s: 0, parts: [{ p: 0 }] }],
      canDelete: false,
    });
    const v = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${r.sessionId}/recording/view`,
      headers: adminS.headers,
      payload: {},
    });
    expect(v.statusCode).toBe(200);
    const token = v.json().token as string;
    expect(await testDb().auditLog.count({ where: { entityId: r.sessionId, action: RECORDING_AUDIT.VIEW } })).toBe(1);
    const part = await app.inject({
      method: "GET",
      url: `/api/v1/rec/${r.rid}/series/0/parts/0`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(part.statusCode).toBe(200);
    expect(part.rawPayload.equals(p0)).toBe(true);
    expect(part.headers["content-disposition"]).toBeUndefined();
    expect(part.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ method: "GET", url: `/api/v1/rec/${r.rid}/series/0/parts/0`, headers: adminS.headers })).statusCode).toBe(
      404,
    );
    // yeni view → eski belirteç `replaced` + view.end özeti
    await app.inject({ method: "POST", url: `/api/v1/sessions/${r.sessionId}/recording/view`, headers: adminS.headers, payload: {} });
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/rec/${r.rid}/series/0/parts/0`, headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(404);
    const end = await testDb().auditLog.findFirstOrThrow({ where: { entityId: r.sessionId, action: RECORDING_AUDIT.VIEW_END } });
    expect(end.newValue).toMatchObject({ partsServed: 1, endReason: "replaced" });
    // başka tenant Admin → 404; yetkisiz USER → 403
    const t2 = (await createTenant()).id;
    const other = await loginAs(app, await createUser({ tenantId: t2, role: "ADMIN" }));
    expect((await app.inject({ method: "GET", url: `/api/v1/sessions/${r.sessionId}/recording`, headers: other.headers })).statusCode).toBe(
      404,
    );
    const user = await loginAs(app, await createUser({ tenantId, role: "USER", perms: { "session_history.view": true } }));
    expect((await app.inject({ method: "GET", url: `/api/v1/sessions/${r.sessionId}/recording`, headers: user.headers })).statusCode).toBe(
      403,
    );
  });

  it("AC-386 ACTIVE silinemez (409); durmuşu sil → 204, dosya + parçalar gider, DELETED{MANUAL}, audit; tekrar 204; geçmiş alanları", async () => {
    const r = await recorded();
    await put(r.rid, r.token, 0, 0, VIDEO_WEBM());
    const del = () =>
      app.inject({
        method: "DELETE",
        url: `/api/v1/sessions/${r.sessionId}/recording`,
        headers: adminS.headers,
        payload: { confirm: true },
      });
    expect((await del()).statusCode).toBe(409);
    const list = (q = "") => app.inject({ method: "GET", url: `/api/v1/sessions?recorded=true&pageSize=100${q}`, headers: adminS.headers });
    expect((await list()).json().items.some((i: { id: string; hasRecording: boolean }) => i.id === r.sessionId && i.hasRecording)).toBe(
      true,
    );
    await app.rec.service.stop({ tenantId, rid: r.rid, reason: "session_end", actor: { kind: "system" } });
    const det = await app.inject({ method: "GET", url: `/api/v1/sessions/${r.sessionId}/history`, headers: adminS.headers });
    expect(det.json().recording).toMatchObject({ state: "stopped", stopReason: "session_end", canView: true, canDelete: true });
    const rels = (await testDb().sessionRecordingPart.findMany({ where: { recordingId: r.rid } })).map((p) => p.storageRel);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/v1/sessions/${r.sessionId}/recording`, headers: adminS.headers, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect((await del()).statusCode).toBe(204);
    expect(await recRow(r.rid)).toMatchObject({ state: "DELETED", deleteReason: "MANUAL", partCount: 0 });
    for (const rel of rels) await expect(readFile(join(TEST_FILES_DIR, rel))).rejects.toThrow();
    expect(await testDb().auditLog.count({ where: { entityId: r.sessionId, action: RECORDING_AUDIT.DELETE } })).toBe(1);
    expect((await del()).statusCode).toBe(204);
    const det2 = await app.inject({ method: "GET", url: `/api/v1/sessions/${r.sessionId}/history`, headers: adminS.headers });
    expect(det2.json().recording).toMatchObject({ state: "deleted", deleteReason: "manual", canView: false });
    expect((await list()).json().items.some((i: { id: string }) => i.id === r.sessionId)).toBe(false);
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/sessions/${r.sessionId}/recording`, headers: adminS.headers })).statusCode,
    ).toBe(404);
    expect(ORIGIN).toBeTruthy();
  });
});

describe("AC-448 / AC-387 gözetimsiz politika kaydı (servis, admit TX'i)", () => {
  it("AC-387 gözetimsiz anahtar kapalıyken kayıt açılmaz; AC-448 açıkken TENANT_POLICY + rıza satırı yok + audit consentMode", async () => {
    const t = (await createTenant()).id;
    const a = await createUser({ tenantId: t, role: "ADMIN" });
    await testDb().tenantSettings.update({ where: { tenantId: t }, data: { recordingEnabled: true } });
    const s = await createSupportSessionRow({ tenantId: t, technicianId: a.id, status: "ACTIVE" });
    const start = () =>
      testDb().$transaction((tx) =>
        app.rec.service.startPolicy(tx, {
          tenantId: t,
          sessionId: s.id,
          recorderUserId: a.id,
          consentMode: "asked",
          actor: { kind: "user", userId: a.id, username: a.email, ctx },
        }),
      );
    expect(await start()).toEqual({ ok: false, reason: "unavailable" });
    await testDb().tenantSettings.update({
      where: { tenantId: t },
      data: { unattendedRecordingEnabled: true, unattendedRecordingAckAt: new Date(), unattendedRecordingAckBy: a.id },
    });
    const r = await start();
    expect(r).toMatchObject({ ok: true, basis: "tenant_policy" });
    expect(await testDb().sessionConsent.count({ where: { sessionId: s.id, level: "RECORDING" } })).toBe(0);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: s.id, action: RECORDING_AUDIT.START } });
    expect(audit.newValue).toMatchObject({ basis: "tenant_policy", consentMode: "asked" });
    expect(audit.userId).toBe(a.id);
  });
});

// --- Düzeltme turu (koordinatör): eşzamanlılık, kova, kilit sırası, belirteç düşümü, audit `cause`, metrikler ---

const sessionIdOf = async (s: Session) => (await testDb().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(s.token) } })).id;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("S-P28e-5 / S-P28e-3 / S-P28e-9 eşzamanlılık", () => {
  it("S-P28e-5 aynı belirteçle eşzamanlı ikinci PUT 429 + Retry-After; ilk PUT kilit bırakılınca 200", async () => {
    const r = await recorded();
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((res) => (release = res));
    const lockedP = new Promise<void>((res) => (locked = res));
    // İlk PUT `lockTenantRecording`'de (tenants FOR UPDATE) beklesin: kapı (tek uçuş) bu süre boyunca dolu.
    const tx = testDb().$transaction(
      async (t) => {
        await t.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    await lockedP;
    const first = put(r.rid, r.token, 0, 0, VIDEO_WEBM());
    await sleep(400);
    const second = await put(r.rid, r.token, 0, 0, VIDEO_WEBM());
    release();
    await tx;
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
    expect((await first).statusCode).toBe(200);
  });

  it("S-P28e-3 izleme kovası: kapasite kadar GET 200, sonraki 429 + Retry-After", async () => {
    const { REC_VIEW_BURST_PARTS } = await import("@remote/contracts/ws-rec");
    const r = await recorded();
    expect((await put(r.rid, r.token, 0, 0, VIDEO_WEBM())).statusCode).toBe(200);
    const v = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${r.sessionId}/recording/view`,
      headers: adminS.headers,
      payload: {},
    });
    const token = v.json().token as string;
    const get = () =>
      app.inject({ method: "GET", url: `/api/v1/rec/${r.rid}/series/0/parts/0`, headers: { authorization: `Bearer ${token}` } });
    for (let i = 0; i < REC_VIEW_BURST_PARTS; i++) expect((await get()).statusCode).toBe(200);
    const over = await get();
    expect(over.statusCode).toBe(429);
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("S-P28e-9 §5.5 kilit sırası: eşzamanlı PUT + ayar kapatma + elle silme deadlock/500 üretmez", async () => {
    const t = (await createTenant()).id;
    const a = await createUser({ tenantId: t, role: "ADMIN" });
    const s = await loginStepUp(app, a);
    const aId = await sessionIdOf(s);
    const settings = (enabled: boolean) =>
      app.inject({
        method: "PUT",
        url: "/api/v1/settings/recording",
        headers: s.headers,
        payload: { enabled, retentionDays: 30, unattendedEnabled: false, ...(enabled ? { consentUpdated: true } : {}) },
      });
    for (let round = 0; round < 3; round++) {
      expect((await settings(true)).statusCode).toBe(200);
      const live = await recorded({ tenant: t, tech: a, authId: aId });
      expect((await put(live.rid, live.token, 0, 0, VIDEO_WEBM())).statusCode).toBe(200);
      const done = await recorded({ tenant: t, tech: a, authId: aId });
      await app.rec.service.stop({ tenantId: t, rid: done.rid, reason: "session_end", actor: { kind: "system" } });
      const [p, off, del] = await Promise.all([
        put(live.rid, live.token, 0, 1, CLUSTER_PART()),
        settings(false),
        app.inject({
          method: "DELETE",
          url: `/api/v1/sessions/${done.sessionId}/recording`,
          headers: s.headers,
          payload: { confirm: true },
        }),
      ]);
      expect([200, 404, 409]).toContain(p.statusCode);
      expect(off.statusCode).toBe(200);
      expect(del.statusCode).toBe(204);
      expect(await recRow(live.rid)).toMatchObject({ state: "STOPPED", stopReason: "POLICY_OFF" });
      expect(await recRow(done.rid)).toMatchObject({ state: "DELETED", deleteReason: "MANUAL" });
    }
  });
});

describe("S-P28e-6 yükleme belirteci bellekten HEMEN düşer (çıkış / kullanıcı / tenant pasifleştirme)", () => {
  it("S-P28e-6 çıkış: yalnız o oturumun belirteci düşer", async () => {
    const u = await createUser({ tenantId, role: "ADMIN" });
    const s = await loginAs(app, u);
    const mine = await recorded({ tech: u, authId: await sessionIdOf(s) });
    const other = await recorded();
    expect(app.rec.service.tokens.get(mine.token)).not.toBeNull();
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: s.headers, payload: {} })).statusCode).toBe(204);
    expect(app.rec.service.tokens.get(mine.token)).toBeNull();
    expect(app.rec.service.tokens.get(other.token)).not.toBeNull();
  });

  it("S-P28e-6 kullanıcı pasife alınınca belirteçleri düşer", async () => {
    const u = await createUser({ tenantId, role: "USER" });
    const s = await loginAs(app, u);
    const r = await recorded({ tech: u, authId: await sessionIdOf(s) });
    expect(app.rec.service.tokens.get(r.token)).not.toBeNull();
    expect(
      (await app.inject({ method: "POST", url: `/api/v1/users/${u.id}/deactivate`, headers: adminS.headers, payload: {} })).statusCode,
    ).toBe(204);
    expect(app.rec.service.tokens.get(r.token)).toBeNull();
  });

  it("S-P28e-6 tenant pasife alınınca tenant'ın belirteçleri düşer, başka tenant etkilenmez", async () => {
    const t = (await createTenant()).id;
    await testDb().tenantSettings.update({ where: { tenantId: t }, data: { recordingEnabled: true } });
    const u = await createUser({ tenantId: t, role: "ADMIN" });
    const s = await loginAs(app, u);
    const r = await recorded({ tenant: t, tech: u, authId: await sessionIdOf(s) });
    const other = await recorded();
    const sa = await loginStepUp(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const res = await app.inject({ method: "POST", url: `/api/v1/admin/tenants/${t}/deactivate`, headers: sa.headers, payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    expect(app.rec.service.tokens.get(r.token)).toBeNull();
    expect(app.rec.service.tokens.get(other.token)).not.toBeNull();
  });
});

describe("§11 audit `cause` okunur + metrikler", () => {
  it("AC-388 recording.stop alt kodu audit görünümünde `cause` olarak açık (maskeye takılmaz)", async () => {
    const r = await recorded();
    await app.rec.service.stop({ tenantId, rid: r.rid, reason: "error", code: "orphan", actor: { kind: "system" } });
    const res = await app.inject({ method: "GET", url: "/api/v1/audit?action=recording.stop", headers: adminS.headers });
    expect(res.statusCode).toBe(200);
    const item = res
      .json<{ items: { entityId: string | null; newValue: Record<string, unknown> | null }[] }>()
      .items.find((i) => i.entityId === r.sessionId);
    expect(item?.newValue).toMatchObject({ reason: "error", cause: "orphan" });
    expect(item?.newValue).not.toHaveProperty("code");
  });

  it("§11.2 rs_storage_used_bytes kayıtları sayar; rs_rec_part_bytes histogramı kabul edilen parçayı gözler", async () => {
    const { refreshStorageGauges } = await import("../../src/fsrv/wiring.ts");
    const r = await recorded();
    const before = /rs_rec_part_bytes_count (\d+)/.exec(app.metrics.render())?.[1];
    expect((await put(r.rid, r.token, 0, 0, VIDEO_WEBM())).statusCode).toBe(200);
    const after = /rs_rec_part_bytes_count (\d+)/.exec(app.metrics.render())?.[1];
    expect(Number(after)).toBe(Number(before) + 1);
    // Paylaşılan DB'de başka dosyalar eşzamanlı yazar → toplam, sorgu başına sabit dönen saplı DB ile doğrulanır.
    const stub = {
      $queryRaw: async (sql: TemplateStringsArray) => [{ n: sql.join("").includes("session_recordings") ? 7n : 5n }],
    } as unknown as Parameters<typeof refreshStorageGauges>[0];
    await refreshStorageGauges(stub, app.fsrv);
    expect(app.fsrv.gauges.usedBytes).toBe(12);
  });
});
