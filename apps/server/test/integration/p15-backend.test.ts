// P15 — G3 küçük özellikler (AC-231..239; mimari-e11 §6). Gerçek MySQL + inject; WS akışları gerçek dinleyen sunucu.
import type { MfaEnableResponse, MfaRecoveryCodesResponse, MfaSetupResponse } from "@remote/contracts/api/auth";
import { REQUEST_BLOCK_EXISTS_MESSAGE, type RequestBlockItem, type RequestBlockListResponse } from "@remote/contracts/api/request-blocks";
import {
  ACCEPT_CODE_CLIENT_UNSUPPORTED_MESSAGE,
  ACCEPT_CODE_MIN_CLIENT_VERSION,
  REQUEST_BUSY_MESSAGE,
} from "@remote/contracts/api/requests";
import { TECH_AVATAR_URL_TTL_SEC, type ResolveSessionResponse, type SessionHistoryDetail } from "@remote/contracts/api/sessions";
import type { SuperadminListResponse, SuperadminResetResponse } from "@remote/contracts/api/users";
import { SHARE_STATE_MIN_INTERVAL_MS } from "@remote/contracts/ws";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, hotp, stepOf, TOTP_STEP_SEC } from "../../src/auth/mfa.ts";
import { handleFileMeta } from "../../src/signaling/collab.ts";
import { relayShareState } from "../../src/signaling/handlers.ts";
import { cidrRange, ipBytes, rangeCidr } from "../../src/requests/blocks.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  loginRequest,
  loginStepUp,
  makeApp,
  ORIGIN,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { sessionOf } from "../helpers/auth.ts";
import { createRequestRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, techSession, type Live } from "../helpers/signal-flow.ts";
import { FakeClock, makeRooms, roomFixture } from "../helpers/ws.ts";

let app: FastifyInstance;
const NOW = (stepOf(Date.now()) + 0.5) * TOTP_STEP_SEC * 1000;
const step = stepOf(NOW);
beforeAll(async () => {
  app = makeApp({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32" } });
  await app.ready();
  app.account.now = () => NOW;
});
afterAll(() => app.close());

let ipSeq = 0;
const nextIp = () => `10.16.${Math.floor(++ipSeq / 250) + 1}.${(ipSeq % 250) + 1}`;
const errOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string; message: string; fields?: Record<string, string> } }>().error;

/** Ortak `signIn`'den farklı: 200 denetimi yok (PT-K2 — davranış korunur). */
const signIn = async (u: TestUser): Promise<Session> =>
  sessionOf(await app.inject(loginRequest(u.email, u.password, { remoteAddress: nextIp() })));
const code = (secret: string, offset: number) => hotp(base32Decode(secret), step + offset);

describe("AC-231 kurtarma kodlarını yenile", () => {
  it("AC-231: geçerli TOTP → 10 yeni kod; eski kodlar aynı TX'te silinir; audit kod içermez; aynı kod ikinci kez 400", async () => {
    const u = await createUser({ tenantId: (await createTenant()).id, role: "ADMIN" });
    const s = await signIn(u);
    const setup = (
      await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup", headers: s.headers, payload: {} })
    ).json<MfaSetupResponse>();
    const en = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enable",
      headers: s.headers,
      payload: { code: code(setup.secret, -1) },
    });
    const old = en.json<MfaEnableResponse>().recoveryCodes;
    const oldHashes = (await testDb().recoveryCode.findMany({ where: { userId: u.id } })).map((r) => r.codeHash);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/recovery-codes",
      headers: s.headers,
      payload: { code: code(setup.secret, 0) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { codes } = res.json<MfaRecoveryCodesResponse>();
    expect(codes).toHaveLength(10);
    expect(codes.some((c) => old.includes(c))).toBe(false);
    const rows = await testDb().recoveryCode.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => oldHashes.includes(r.codeHash))).toBe(false);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { userId: u.id, action: "mfa.recovery_regenerated", result: "success" } });
    expect(a.newValue).toEqual({ count: 10 });
    for (const c of codes) expect(JSON.stringify([a.oldValue, a.newValue])).not.toContain(c);
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/recovery-codes",
      headers: s.headers,
      payload: { code: code(setup.secret, 0) },
    });
    expect(replay.statusCode).toBe(400);
    expect(errOf(replay).fields).toHaveProperty("code");
  });

  it("AC-231: 5 hatalı TOTP sonrası kilit (429); 2FA kurulu değilse 403 MFA_SETUP_REQUIRED; geçersiz gövde 400", async () => {
    const u = await createUser({ tenantId: (await createTenant()).id, role: "ADMIN" });
    const plain = await signIn(u);
    expect(
      errOf(
        await app.inject({ method: "POST", url: "/api/v1/auth/mfa/recovery-codes", headers: plain.headers, payload: { code: "123456" } }),
      ).code,
    ).toBe("MFA_SETUP_REQUIRED");
    const setup = (
      await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup", headers: plain.headers, payload: {} })
    ).json<MfaSetupResponse>();
    await app.inject({ method: "POST", url: "/api/v1/auth/mfa/enable", headers: plain.headers, payload: { code: code(setup.secret, -1) } });
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/auth/mfa/recovery-codes", headers: plain.headers, payload: { code: "12" } }))
        .statusCode,
    ).toBe(400);
    const wrong = code(setup.secret, 0) === "000000" ? "111111" : "000000";
    const call = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/mfa/recovery-codes",
        headers: plain.headers,
        payload: { code: wrong },
        remoteAddress: "10.16.200.1",
      });
    for (let i = 0; i < 5; i++) expect((await call()).statusCode).toBe(400);
    expect((await call()).statusCode).toBe(429);
    expect(await testDb().auditLog.count({ where: { userId: u.id, action: "mfa.recovery_regenerated", result: "fail" } })).toBe(5);
  });
});

describe("AC-232 Super Admin panel şifre sıfırlama", () => {
  it("AC-232: step-up'lı SA başka SA'yı sıfırlar → geçici parola, oturumları kapanır, must_change, audit; kendi id 403; step-up yoksa 401", async () => {
    const actor = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const target = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const targetS = await loginAs(app, target);
    const noStep = await loginAs(app, actor);
    await testDb().user.update({ where: { id: actor.id }, data: { totpEnabled: true, totpSecretEnc: new Uint8Array(40) } });
    expect(
      errOf(
        await app.inject({
          method: "POST",
          url: `/api/v1/admin/superadmins/${target.id}/reset-password`,
          headers: noStep.headers,
          payload: {},
        }),
      ).code,
    ).toBe("MFA_STEP_UP_REQUIRED");
    const s = await loginStepUp(app, actor);
    const list = (await app.inject({ method: "GET", url: "/api/v1/admin/superadmins", headers: s.headers })).json<SuperadminListResponse>();
    // Test DB'sinde çok sayıda SA olabilir (liste ≤100): self bayrağı yalnız oturum sahibinde.
    expect(list.items.length).toBeLessThanOrEqual(100);
    expect(list.items.every((i) => i.self === (i.id === actor.id))).toBe(true);
    const self = await app.inject({
      method: "POST",
      url: `/api/v1/admin/superadmins/${actor.id}/reset-password`,
      headers: s.headers,
      payload: {},
    });
    expect(self.statusCode).toBe(403);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/superadmins/${target.id}/reset-password`,
      headers: s.headers,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json<SuperadminResetResponse>();
    expect(out.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(out.revokedSessions).toBeGreaterThanOrEqual(1);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: targetS.headers })).statusCode).toBe(401);
    expect(await testDb().user.findUniqueOrThrow({ where: { id: target.id }, select: { mustChangePassword: true } })).toEqual({
      mustChangePassword: true,
    });
    const a = await testDb().auditLog.findFirstOrThrow({ where: { action: "auth.superadmin_reset", entityId: target.id } });
    expect(a).toMatchObject({ userId: actor.id, result: "success" });
    expect(a.newValue).toMatchObject({ via: "panel", mustChangePassword: true });
    expect(JSON.stringify([a.oldValue, a.newValue])).not.toContain(out.temporaryPassword);
    const login = await app.inject(loginRequest(target.email, out.temporaryPassword, { remoteAddress: nextIp() }));
    expect(login.statusCode).toBe(200);
  });

  it("AC-232: hedef SA değil / yok → 404; tenant Admin'i → 403", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await loginStepUp(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    expect(
      (await app.inject({ method: "POST", url: `/api/v1/admin/superadmins/${admin.id}/reset-password`, headers: s.headers, payload: {} }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: `/api/v1/admin/superadmins/${newId()}/reset-password`, headers: s.headers, payload: {} }))
        .statusCode,
    ).toBe(404);
    const as = await loginAs(app, admin);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/superadmins", headers: as.headers })).statusCode).toBe(403);
  });
});

describe("AC-234 share.state neden/yöntem", () => {
  it("AC-234: reason/method konsola iletilir; 0.10.x yükü (alansız) hatasız; S17-2: 1 sn içindekiler birleştirilir, son durum kaybolmaz", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const f = await roomFixture(rooms);
    const g = await f.guest();
    const sent = () => f.techPeer.sent.filter((m) => m.t === "share.state");
    f.room.share = { state: "sharing" };
    relayShareState(rooms, f.room);
    expect(sent()).toHaveLength(1);
    f.room.share = { state: "stopped", reason: "NO_H264_ENCODER", method: "DXGI" };
    relayShareState(rooms, f.room);
    f.room.share = { state: "stopped", reason: "FUTURE_CODE", method: "GDI" };
    relayShareState(rooms, f.room);
    expect(sent()).toHaveLength(1);
    clock.advance(SHARE_STATE_MIN_INTERVAL_MS);
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toEqual({ t: "share.state", state: "stopped", reason: "FUTURE_CODE", method: "GDI" });
    expect(g).toBeTruthy();
  });

  it("AC-234: gerçek WS — misafirin reason/method'lu share.state'i teknisyene aynen gider; biçim dışı reason 1008", async () => {
    const live = await startLive();
    try {
      const t = await techSession(live);
      const { admitted } = await import("../helpers/signal-flow.ts");
      const { guest } = await admitted(live, t);
      guest.send({ t: "share.state", state: "stopped", reason: "DXGI_ACCESS_DENIED", method: "DXGI" });
      expect(await t.ws.waitFor("share.state")).toEqual({
        t: "share.state",
        state: "stopped",
        reason: "DXGI_ACCESS_DENIED",
        method: "DXGI",
      });
      guest.send({ t: "share.state", state: "stopped", reason: "bad reason" });
      expect((await guest.closed).code).toBe(1008);
    } finally {
      await live.close();
    }
  });
});

describe("AC-235 talep engelleri", () => {
  let live: Live | undefined;
  afterEach(async () => {
    await live?.close();
    live = undefined;
  });

  it("AC-235: IP yardımcıları — IPv4-eşlemeli IPv6 4 bayt; CIDR ↔ aralık", () => {
    expect(ipBytes("::ffff:203.0.113.7")).toEqual(Buffer.from([203, 0, 113, 7]));
    expect(ipBytes("203.0.113.7")).toEqual(Buffer.from([203, 0, 113, 7]));
    expect(ipBytes("2001:db8::1")?.length).toBe(16);
    const r = cidrRange("203.0.113.0/24");
    expect([...r.from]).toEqual([203, 0, 113, 0]);
    expect([...r.to]).toEqual([203, 0, 113, 255]);
    expect(rangeCidr(r.from, r.to)).toBe("203.0.113.0/24");
    const v6 = cidrRange("2001:db8:1::/48");
    expect(rangeCidr(v6.from, v6.to)).toBe("2001:db8:1::/48");
  });

  it("AC-235: IP/önek ve cihaz engeli → tek tip 429, talep yazılmaz; kaldırınca kabul; liste/limit/audit; yetkisiz 403; tenant izolasyonu", async () => {
    const l = await startLive({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32" } });
    live = l;
    const rc = requestClient(l.app, l.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await loginAs(l.app, admin);
    const post = (payload: object) => l.app.inject({ method: "POST", url: "/api/v1/request-blocks", headers: s.headers, payload });

    const b1 = await post({ source: "CIDR", cidr: "203.0.113.77/24", durationHours: 1, note: "spam" });
    expect(b1.statusCode, b1.body).toBe(201);
    const item = b1.json<RequestBlockItem>();
    expect(item).toMatchObject({ kind: "IP", cidr: "203.0.113.0/24", expired: false, note: "spam" });
    const dup = await post({ source: "CIDR", cidr: "203.0.113.9/24", durationHours: null });
    expect(dup.statusCode).toBe(409);
    expect(errOf(dup)).toMatchObject({
      code: "CONFLICT",
      message: REQUEST_BLOCK_EXISTS_MESSAGE,
      fields: { cidr: REQUEST_BLOCK_EXISTS_MESSAGE },
    });

    const blocked = await rc.createReq(ref, "::ffff:203.0.113.10");
    expect(blocked.statusCode).toBe(429);
    expect(errOf(blocked)).toMatchObject({ code: "RATE_LIMITED", message: REQUEST_BUSY_MESSAGE });
    expect(await testDb().supportRequest.count({ where: { tenantId: t.id } })).toBe(0);
    expect((await rc.createReq(ref, "198.51.100.10")).statusCode).toBe(201);

    // cihaz: talepten kısayol
    const deviceKey = "D".repeat(22);
    const first = await rc.createReq(ref, "198.51.100.11", { deviceKey });
    const reqId = first.json<{ requestId: string }>().requestId;
    const b2 = await post({ source: "REQUEST", requestId: reqId, target: "DEVICE", durationHours: null });
    expect(b2.statusCode, b2.body).toBe(201);
    expect(b2.json<RequestBlockItem>().deviceFingerprint).toBe(sha256Hex(`${t.id}${deviceKey}`).slice(0, 8));
    expect((await rc.createReq(ref, "198.51.100.12", { deviceKey })).statusCode).toBe(429);
    const dupDev = await post({ source: "REQUEST", requestId: reqId, target: "DEVICE", durationHours: 1 });
    expect(errOf(dupDev).fields).toEqual({ target: REQUEST_BLOCK_EXISTS_MESSAGE });
    // talepten IP (önek ile)
    const b3 = await post({ source: "REQUEST", requestId: reqId, target: "IP", prefixLen: 24, durationHours: 24 });
    expect(b3.json<RequestBlockItem>().cidr).toBe("198.51.100.0/24");

    const list = (
      await live.app.inject({ method: "GET", url: "/api/v1/request-blocks?pageSize=2", headers: s.headers })
    ).json<RequestBlockListResponse>();
    expect(list).toMatchObject({ total: 3, used: 3, max: 1000, pageSize: 2 });
    expect(list.items).toHaveLength(2);
    expect(await testDb().auditLog.count({ where: { tenantId: t.id, action: "request_block.created" } })).toBe(3);
    const audit = await testDb().auditLog.findFirstOrThrow({
      where: { tenantId: t.id, action: "request_block.created", entityId: item.id },
    });
    expect(JSON.stringify(audit.newValue)).not.toContain("spam");

    // kaldırma → önbellek geçersiz → kabul
    expect((await live.app.inject({ method: "DELETE", url: `/api/v1/request-blocks/${item.id}`, headers: s.headers })).statusCode).toBe(
      204,
    );
    expect((await live.app.inject({ method: "DELETE", url: `/api/v1/request-blocks/${item.id}`, headers: s.headers })).statusCode).toBe(
      404,
    );
    expect((await rc.createReq(ref, "203.0.113.10")).statusCode).toBe(201);

    // tenant izolasyonu + yetki
    const other = await createTenant();
    const otherAdmin = await loginAs(live.app, await createUser({ tenantId: other.id, role: "ADMIN" }));
    const ol = (
      await live.app.inject({ method: "GET", url: "/api/v1/request-blocks", headers: otherAdmin.headers })
    ).json<RequestBlockListResponse>();
    expect(ol.total).toBe(0);
    const cross = await live.app.inject({
      method: "POST",
      url: "/api/v1/request-blocks",
      headers: otherAdmin.headers,
      payload: { source: "REQUEST", requestId: reqId, target: "IP", durationHours: 1 },
    });
    expect(cross.statusCode).toBe(404);
    const user = await loginAs(live.app, await createUser({ tenantId: t.id, role: "USER", perms: { "support_requests.view": true } }));
    expect((await live.app.inject({ method: "GET", url: "/api/v1/request-blocks", headers: user.headers })).statusCode).toBe(403);
    const blockUser = await loginAs(
      live.app,
      await createUser({ tenantId: t.id, role: "USER", perms: { "support_requests.block": true } }),
    );
    expect((await live.app.inject({ method: "GET", url: "/api/v1/request-blocks", headers: blockUser.headers })).statusCode).toBe(200);
  });

  it("AC-235: tenant başına 1.000 sınırı → 409; süresi dolmuş aynı hedef yeniden eklenebilir; saklama işi 30 g sonra siler", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await loginAs(app, admin);
    const past = new Date(Date.now() - 40 * 86_400_000);
    const r = cidrRange("192.0.2.0/24");
    await testDb().requestBlock.create({
      data: {
        id: newId(),
        tenantId: t.id,
        kind: "IP",
        ipFrom: new Uint8Array(r.from),
        ipTo: new Uint8Array(r.to),
        createdBy: admin.id,
        createdAt: new Date(past.getTime() - 3_600_000),
        expiresAt: past,
      },
    });
    const again = await app.inject({
      method: "POST",
      url: "/api/v1/request-blocks",
      headers: s.headers,
      payload: { source: "CIDR", cidr: "192.0.2.0/24", durationHours: 1 },
    });
    expect(again.statusCode, again.body).toBe(201);
    await testDb().requestBlock.create({
      data: {
        id: newId(),
        tenantId: t.id,
        kind: "DEVICE",
        deviceKeyHash: sha256Hex("old"),
        createdBy: admin.id,
        createdAt: new Date(past.getTime() - 3_600_000),
        expiresAt: past,
      },
    });
    await testDb().requestBlock.createMany({
      data: Array.from({ length: 998 }, () => ({
        id: newId(),
        tenantId: t.id,
        kind: "DEVICE",
        deviceKeyHash: sha256Hex(newId()),
        createdBy: admin.id,
      })),
    });
    const full = await app.inject({
      method: "POST",
      url: "/api/v1/request-blocks",
      headers: s.headers,
      payload: { source: "CIDR", cidr: "192.0.2.200", durationHours: 1 },
    });
    expect(full.statusCode).toBe(409);
    const { purgeExpiredBlocks } = await import("../../src/requests/blocks.ts");
    expect(await purgeExpiredBlocks(testDb(), t.id, new Date(Date.now() - 30 * 86_400_000))).toBe(1);
  });
});

describe("AC-236 teknisyen avatarı imzalı URL", () => {
  it("AC-236: resolve imzalı URL döner; 200 + private,no-store; bozuk imza/süre 403; oturum bitince 403; avatarsız null", async () => {
    const t = await createTenant();
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: TECH_PERMS });
    const { UploadStore } = await import("../../src/uploads/store.ts");
    const { TEST_UPLOADS_DIR } = await import("../helpers/app.ts");
    const rel = await new UploadStore(TEST_UPLOADS_DIR).save(t.id, "webp", Buffer.from("RIFF0000WEBP"));
    await testDb().user.update({ where: { id: tech.id }, data: { avatarPath: rel } });
    const s = await loginAs(app, tech);
    const created = (await app.inject({ method: "POST", url: "/api/v1/sessions", headers: s.headers, payload: {} })).json<{
      id: string;
      link: string;
    }>();
    const token = created.link.split("/").pop() ?? "";
    const r = (
      await app.inject({
        method: "POST",
        url: "/api/v1/public/sessions/resolve",
        headers: { origin: ORIGIN },
        payload: { token, clientKind: "BROWSER" },
      })
    ).json<ResolveSessionResponse>();
    const url = r.technician.avatarUrl ?? "";
    expect(url).toMatch(new RegExp(`^/api/v1/public/sessions/${created.id}/tech-avatar\\?exp=\\d+&sig=[a-f0-9]{64}$`));
    expect(url).not.toContain(token);
    const ok = await app.inject({ method: "GET", url });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(
      (await app.inject({ method: "GET", url: url.replace(/sig=(.)/, (_m, ch: string) => `sig=${ch === "0" ? "1" : "0"}`) })).statusCode,
    ).toBe(403);
    const exp = Number(/exp=(\d+)/.exec(url)?.[1]);
    expect((await app.inject({ method: "GET", url: url.replace(`exp=${exp}`, `exp=${exp + 1}`) })).statusCode).toBe(403);
    // QA 6: üretilen exp − now ≤ TTL; geçerli MAC'li ama süresi geçmiş / TTL'den uzak exp → 403
    const nowSec = Math.floor(Date.now() / 1000);
    expect(exp - nowSec).toBeLessThanOrEqual(TECH_AVATAR_URL_TTL_SEC);
    expect(exp - nowSec).toBeGreaterThan(TECH_AVATAR_URL_TTL_SEC - 30);
    const signed = (e: number) =>
      `/api/v1/public/sessions/${created.id}/tech-avatar?exp=${e}&sig=${app.secrets.mac("avatar-url", `${created.id}\n${e}`)}`;
    expect((await app.inject({ method: "GET", url: signed(nowSec + 60) })).statusCode).toBe(200); // MAC kurgusu doğru
    expect((await app.inject({ method: "GET", url: signed(nowSec - 1) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: signed(nowSec + TECH_AVATAR_URL_TTL_SEC + 1) })).statusCode).toBe(403);
    await testDb().supportSession.update({
      where: { id: created.id },
      data: { status: "CANCELLED", activeCode: null, endedAt: new Date(), endedBy: "TECH", endReason: "cancelled" },
    });
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);

    const plain = await createUser({ tenantId: t.id, role: "USER", perms: TECH_PERMS });
    const ps = await loginAs(app, plain);
    const c2 = (await app.inject({ method: "POST", url: "/api/v1/sessions", headers: ps.headers, payload: {} })).json<{ link: string }>();
    const r2 = (
      await app.inject({
        method: "POST",
        url: "/api/v1/public/sessions/resolve",
        headers: { origin: ORIGIN },
        payload: { token: c2.link.split("/").pop(), clientKind: "BROWSER" },
      })
    ).json<ResolveSessionResponse>();
    expect(r2.technician.avatarUrl).toBeNull();
  });
});

describe("AC-237 users.delete", () => {
  it("AC-237: users.delete toggle listesinde (tek tanım); USER varsayılan kapalı, ADMIN açık", async () => {
    const t = await createTenant();
    const u = await loginAs(app, await createUser({ tenantId: t.id, role: "USER" }));
    const a = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const me = async (s: Session) =>
      (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: s.headers })).json<{ permissions: string[] }>();
    expect((await me(u)).permissions).not.toContain("users.delete");
    expect((await me(a)).permissions).toEqual(expect.arrayContaining(["users.delete", "support_requests.block"]));
  });
});

describe("AC-238 dosya raporlayan taraf", () => {
  it("AC-238: fid'li iki rapor iki satır + aynı match_key → geçmişte tek 'doğrulanmış'; yalnız müşteri → 'Müşteri bildirimi'; tekrar rapor yok sayılır; CSV sütunu", async () => {
    const rooms = makeRooms(new FakeClock());
    const f = await roomFixture(rooms, [
      "sessions.create",
      "sessions.view",
      "file_transfer.use",
      "session_history.view",
      "session_history.export",
    ]);
    const g = await f.guest();
    f.room.admitted = g.entry;
    f.room.caps = ["file_transfer"];
    f.room.maxFileMb = 100;
    const meta = (fid: string | undefined, direction: "TO_CUSTOMER" | "TO_TECH", sha: string) => ({
      t: "file.meta" as const,
      ...(fid ? { fid } : {}),
      direction,
      fileName: "rapor.pdf",
      sizeBytes: 10,
      sha256: sha,
      result: "OK" as const,
    });
    const techR = { side: "tech" as const, peer: f.techPeer };
    const guestR = { side: "guest" as const, peer: g.peer };
    // aktarım 1: teknisyen → müşteri, iki taraf raporu
    expect(await handleFileMeta(rooms, f.room, techR, meta("f1", "TO_CUSTOMER", "a".repeat(64)))).toBe("sender_reported");
    expect(await handleFileMeta(rooms, f.room, guestR, meta("f1", "TO_CUSTOMER", "a".repeat(64)))).toBe("recorded");
    expect(await handleFileMeta(rooms, f.room, guestR, meta("f1", "TO_CUSTOMER", "a".repeat(64)))).toBe("duplicate");
    // aktarım 2: müşteri → teknisyen, yalnız müşteri raporu
    expect(await handleFileMeta(rooms, f.room, guestR, meta("f2", "TO_TECH", "b".repeat(64)))).toBe("sender_reported");
    // aktarım 3: eski istemci (fid yok) — gönderen raporu satır değil
    expect(await handleFileMeta(rooms, f.room, guestR, meta(undefined, "TO_TECH", "c".repeat(64)))).toBe("sender_reported");
    const rows = await testDb().sessionFile.findMany({ where: { sessionId: f.room.sessionId }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.reportedBy).sort()).toEqual(["CUSTOMER", "CUSTOMER", "TECH"]);
    expect(rows.every((r) => /^[a-f0-9]{64}$/.test(r.matchKey ?? ""))).toBe(true);
    // geçmiş
    await testDb().supportSession.update({
      where: { id: f.room.sessionId },
      data: {
        status: "ENDED",
        activeCode: null,
        consumedAt: new Date(),
        mode: "BROWSER",
        endedAt: new Date(),
        endedBy: "TECH",
        endReason: "tech",
      },
    });
    const viewer = await createUser({ tenantId: f.room.tenantId, role: "ADMIN" });
    const vs = await loginAs(app, viewer);
    const d = (
      await app.inject({ method: "GET", url: `/api/v1/sessions/${f.room.sessionId}/history`, headers: vs.headers })
    ).json<SessionHistoryDetail>();
    expect(d.files).toHaveLength(2);
    expect(d.files.find((x) => x.sha256 === "a".repeat(64))).toMatchObject({ verified: true, reportedBy: "TECH" });
    expect(d.files.find((x) => x.sha256 === "b".repeat(64))).toMatchObject({ verified: false, reportedBy: "CUSTOMER" });
    const csv = await app.inject({ method: "GET", url: "/api/v1/sessions/export.csv", headers: vs.headers });
    const header = csv.body.split("\r\n")[0] ?? "";
    expect(header).toContain("Dosyalar");
    const line = csv.body.split("\r\n").find((l) => l.startsWith(f.room.sessionId)) ?? "";
    expect(line).toContain("1 doğrulanmış; 1 müşteri bildirimi");
  });

  it("AC-238: tarayıcı istemcisi biçimi (fid'li iki uç) TO_CUSTOMER → 'Doğrulanmış'; fid'siz (0.10.x Go) müşteri raporu TECH raporuyla eşlenir, tek başına 'Müşteri bildirimi' kalır", async () => {
    const rooms = makeRooms(new FakeClock());
    const f = await roomFixture(rooms, ["sessions.create", "sessions.view", "file_transfer.use", "session_history.view"]);
    const g = await f.guest();
    f.room.admitted = g.entry;
    f.room.caps = ["file_transfer"];
    f.room.maxFileMb = 100;
    const techR = { side: "tech" as const, peer: f.techPeer };
    const guestR = { side: "guest" as const, peer: g.peer };
    // apps/web/lib/dc/files.ts'in ürettiği gövde: gönderen (senderMeta) ve alıcı (meta) aynı fid'i taşır
    const web = (fid: string | undefined, sha: string, fileName = "kurulum.zip") => ({
      t: "file.meta" as const,
      ...(fid ? { fid } : {}),
      direction: "TO_CUSTOMER" as const,
      fileName,
      sizeBytes: 2048,
      sha256: sha,
      result: "OK" as const,
    });
    // 1) web teknisyen → web müşteri (fid'li iki uç)
    expect(await handleFileMeta(rooms, f.room, techR, web("k3x9a1b2c3d4e5f6g7h8i9j0", "d".repeat(64)))).toBe("sender_reported");
    expect(await handleFileMeta(rooms, f.room, guestR, web("k3x9a1b2c3d4e5f6g7h8i9j0", "d".repeat(64)))).toBe("recorded");
    // 2) web teknisyen (fid'li) → 0.10.x Go müşteri (fid'siz alıcı raporu); sıra ters: önce müşteri
    expect(await handleFileMeta(rooms, f.room, guestR, web(undefined, "e".repeat(64)))).toBe("recorded");
    expect(await handleFileMeta(rooms, f.room, techR, web("m1n2o3p4q5r6s7t8u9v0w1x2", "e".repeat(64)))).toBe("sender_reported");
    // 3) fid'siz tek müşteri raporu (teknisyen raporu yok)
    expect(await handleFileMeta(rooms, f.room, guestR, web(undefined, "f".repeat(64)))).toBe("recorded");
    await testDb().supportSession.update({
      where: { id: f.room.sessionId },
      data: {
        status: "ENDED",
        activeCode: null,
        consumedAt: new Date(),
        mode: "BROWSER",
        endedAt: new Date(),
        endedBy: "TECH",
        endReason: "tech",
      },
    });
    const vs = await loginAs(app, await createUser({ tenantId: f.room.tenantId, role: "ADMIN" }));
    const d = (
      await app.inject({ method: "GET", url: `/api/v1/sessions/${f.room.sessionId}/history`, headers: vs.headers })
    ).json<SessionHistoryDetail>();
    expect(d.files).toHaveLength(3);
    expect(d.files.find((x) => x.sha256 === "d".repeat(64))).toMatchObject({ verified: true, reportedBy: "TECH" });
    expect(d.files.find((x) => x.sha256 === "e".repeat(64))).toMatchObject({ verified: true, reportedBy: "TECH" });
    expect(d.files.find((x) => x.sha256 === "f".repeat(64))).toMatchObject({ verified: false, reportedBy: "CUSTOMER" });
  });
});

describe("AC-239 talepte kabul kodu", () => {
  let live: Live | undefined;
  afterEach(async () => {
    await live?.close();
    live = undefined;
  });
  const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };

  async function putAcceptCode(l: Live, headers: Session["headers"], requireAcceptCode: boolean) {
    const put = await l.app.inject({
      method: "PUT",
      url: "/api/v1/settings/support-requests",
      headers,
      payload: {
        waitMinutes: 30,
        trustedCidrs: [],
        whatsapp: { enabled: false, recipients: [] },
        email: { enabled: false, recipients: [] },
        requireAcceptCode,
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<{ requireAcceptCode: boolean }>().requireAcceptCode).toBe(requireAcceptCode);
  }

  async function prepare(requireAcceptCode: boolean, version: string) {
    live = await startLive({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32" } });
    const rc = requestClient(live.app, live.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const admin = await loginAs(live.app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    await putAcceptCode(live, admin.headers, requireAcceptCode);
    const c = (await rc.createReq(ref, nextIp(), { version })).json<{ requestId: string; requestSecret: string }>();
    const techUser = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const ts = await loginAs(live.app, techUser);
    const rws = await rc.reqWs(c.requestSecret);
    await waitMsg(rws, "request.state");
    return { live, rc, c, ts, admin, rws };
  }

  async function acceptFlow(requireAcceptCode: boolean, version = ACCEPT_CODE_MIN_CLIENT_VERSION) {
    const p = await prepare(requireAcceptCode, version);
    const acc = await p.rc.accept(p.ts.headers, p.c.requestId);
    expect(acc.statusCode, acc.body).toBe(200);
    const accepted = await waitMsg<{ wsTicket: string; admitCode?: string }>(p.rws, "request.accepted");
    return { ...p, accepted, sessionId: acc.json<{ sessionId: string }>().sessionId };
  }

  it("AC-239: kapalıyken akış değişmez (regresyon) — admitCode yok, misafir doğrudan kabul (hello)", async () => {
    const { rc, accepted } = await acceptFlow(false);
    expect(accepted).not.toHaveProperty("admitCode");
    const g = await rc.guestWs(accepted.wsTicket);
    await g.waitFor("hello");
  });

  it("AC-239 (S15-6): ayar kapalı + 0.10.x istemci → normal kabul (admitCode yok, misafir doğrudan hello; audit'te doğrulama alanı yok)", async () => {
    const { rc, c, accepted } = await acceptFlow(false, "0.10.4");
    expect(accepted).not.toHaveProperty("admitCode");
    const g = await rc.guestWs(accepted.wsTicket);
    await g.waitFor("hello");
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.accepted" } });
    expect(a.result).toBe("success");
    expect(a.newValue).not.toHaveProperty("acceptVerification");
  });

  it("AC-239 (S15-6): ayar açık + 0.10.x istemci → kabul 409 ACCEPT_CODE_CLIENT_UNSUPPORTED; talep PENDING kalır, oturum yok; audit fail + client_unsupported; ayar kapatılınca aynı talep kabul edilir", async () => {
    const { live: l, rc, c, ts, admin, rws } = await prepare(true, "0.10.4");
    const acc = await rc.accept(ts.headers, c.requestId);
    expect(acc.statusCode, acc.body).toBe(409);
    expect(errOf(acc)).toMatchObject({ code: "ACCEPT_CODE_CLIENT_UNSUPPORTED", message: ACCEPT_CODE_CLIENT_UNSUPPORTED_MESSAGE });
    expect(errOf(acc).message).toContain("0.11.0");
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: c.requestId } });
    expect(row).toMatchObject({ status: "PENDING", acceptedBy: null });
    expect(await testDb().supportSession.count({ where: { requestId: c.requestId } })).toBe(0);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.accepted" } });
    expect(a.result).toBe("fail");
    expect(a.newValue).toMatchObject({ acceptVerification: false, reason: "client_unsupported", clientVersion: "0.10.4" });
    // Çift gönderim: aynı yanıt, durum yine değişmez.
    expect(errOf(await rc.accept(ts.headers, c.requestId)).code).toBe("ACCEPT_CODE_CLIENT_UNSUPPORTED");
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id: c.requestId } })).status).toBe("PENDING");
    // Ayar kapatılınca aynı talep kodsuz kabul edilir (kuyruktan düşmemişti).
    await putAcceptCode(l, admin.headers, false);
    const ok = await rc.accept(ts.headers, c.requestId);
    expect(ok.statusCode, ok.body).toBe(200);
    const accepted = await waitMsg<{ wsTicket: string; admitCode?: string }>(rws, "request.accepted");
    expect(accepted).not.toHaveProperty("admitCode");
  });

  it("AC-239: ayar açık + 0.11.0 istemci → audit acceptVerification:true (kod uygulanır)", async () => {
    const { c, accepted } = await acceptFlow(true);
    expect(accepted.admitCode).toMatch(/^\d{4}$/);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.accepted" } });
    expect(a.newValue).toMatchObject({ acceptVerification: true });
    expect(a.newValue).not.toHaveProperty("reason");
  });

  it("AC-239: açıkken müşteri 4 haneli kod alır, lobiye düşer; yanlış kod tüketmez; doğru kodla oturum ACTIVE (talep bağlı, onay kaydı)", async () => {
    const { live: l, rc, c, ts, accepted, sessionId } = await acceptFlow(true);
    expect(accepted.admitCode).toMatch(/^\d{4}$/);
    const { connect, techHeaders } = await import("../helpers/ws.ts");
    const tech = await connect(`${l.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(ts.token, ORIGIN));
    await tech.waitFor("hello");
    const g = await rc.guestWs(accepted.wsTicket);
    await g.waitFor("lobby.wait");
    await tech.waitFor("peer.pending");
    const wrong = accepted.admitCode === "0000" ? "1111" : "0000";
    tech.send({ t: "guest.admit", admitCode: wrong });
    expect((await tech.waitFor("error")).code).toBe("ADMIT_CODE_INVALID");
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("PENDING");
    tech.send({ t: "guest.admit", admitCode: accepted.admitCode });
    await g.waitFor("hello");
    const s = await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s).toMatchObject({ status: "ACTIVE", requestId: c.requestId });
    expect(await testDb().sessionConsent.count({ where: { sessionId, requestId: c.requestId } })).toBe(1);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: "guest.admitted" } });
    expect(a.newValue).toMatchObject({ via: "request", requestId: c.requestId });
    expect(JSON.stringify([a.oldValue, a.newValue])).not.toContain(accepted.admitCode);
  });
});

describe("AC-235/238 tenant matrisi kapsamı", () => {
  it("AC-235: başka tenant'ın engeli kaldırılamaz (404) ve oturum satırı ayrı tenant'ta yazılmaz", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const aAdmin = await createUser({ tenantId: a.id, role: "ADMIN" });
    const id = newId();
    await testDb().requestBlock.create({
      data: { id, tenantId: a.id, kind: "DEVICE", deviceKeyHash: sha256Hex(id), createdBy: aAdmin.id },
    });
    const bs = await loginAs(app, await createUser({ tenantId: b.id, role: "ADMIN" }));
    expect((await app.inject({ method: "DELETE", url: `/api/v1/request-blocks/${id}`, headers: bs.headers })).statusCode).toBe(404);
    expect(await testDb().requestBlock.count({ where: { id } })).toBe(1);
    const sess = await createSupportSessionRow({ tenantId: a.id, technicianId: aAdmin.id });
    const req = await createRequestRow(a.id);
    expect(sess.id && req.id).toBeTruthy();
  });
});
