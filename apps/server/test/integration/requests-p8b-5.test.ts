// P8b-1 düzeltme turu 1 — eksik AC testleri (QA-P8b-3/4/5/6/9, AC-129). Gerçek MySQL + dinleyen sunucu.
// AC-129 (ayar uçları yetki + ref), AC-135 (onay kaydı), AC-143 (bekleyen sınırları), AC-147/148 (yetki, Super Admin),
// AC-157/160 (kabul/ret audit + PII taraması), AC-158/159 (geçmiş detay/CSV, anonimleştirme).
import { REQUEST_BUSY_MESSAGE } from "@remote/contracts/api/requests";
import { afterEach, describe, expect, it } from "vitest";
import { anonymizeRequestsOf } from "../../src/requests/jobs.ts";
import { forEachRetentionTenant } from "../helpers/retention.ts";
import { sha256Hex } from "../../src/lib/ids.ts";
import { createConsentText, createTenant, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import { login } from "../helpers/auth.ts";
import { createRequestRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
type ErrBody = { error: { code: string; message: string; fields?: Record<string, string> } };
const errOf = (r: { json: <T>() => T }) => r.json<ErrBody>().error;
const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? String(x) : x));

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});
async function boot() {
  live = await startLive({ env: PROXY });
  return { l: live, rc: requestClient(live.app, live.base) };
}

const api = (app: Live["app"], s: Session, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: s.headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

describe("AC-135 onay kaydı", () => {
  it("AC-135: eski (isCurrent=false) consentTextId → 400 fields.consentTextId, talep yazılmaz; güncel sürümle talep satırında metin/sha/zaman/IP dolu; onay hatırlanmaz", async () => {
    const { rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const ip = "198.51.110.7";
    const oldId = await rc.consentId(ref, ip);
    await testDb().consentText.update({ where: { id: oldId }, data: { isCurrent: false } });
    const v2 = await createConsentText(t.id, { version: 2, isCurrent: true });
    const info = (await rc.tenantInfo(ref, ip)).json<{ consentText: { id: string; version: number } }>();
    expect(info.consentText).toMatchObject({ id: v2.id, version: 2 });

    const stale = await rc.createReq(ref, ip, { consentTextId: oldId });
    expect(stale.statusCode).toBe(400);
    expect(errOf(stale)).toMatchObject({ code: "VALIDATION" });
    expect(errOf(stale).fields?.consentTextId).toBeTruthy();
    const other = await createTenant(); // başka tenant'ın güncel metni de geçersiz
    const foreign = await rc.createReq(ref, ip, {
      consentTextId: (await testDb().consentText.findFirstOrThrow({ where: { tenantId: other.id, isCurrent: true } })).id,
    });
    expect(foreign.statusCode).toBe(400);
    const notAccepted = await rc.createReq(ref, ip, { extra: { consentAccepted: false } });
    expect(notAccepted.statusCode).toBe(400);
    expect(await testDb().supportRequest.count({ where: { tenantId: t.id } })).toBe(0);

    const before = Date.now();
    const r1 = await rc.createReq(ref, ip);
    const r2 = await rc.createReq(ref, ip); // farklı istemci örneği: her talep kendi onayını taşır
    expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
    for (const r of [r1, r2]) {
      const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: r.json<{ requestId: string }>().requestId } });
      expect(row).toMatchObject({ consentTextId: v2.id, consentSha256: v2.sha256, ip });
      expect(row.consentedAt.getTime()).toBeGreaterThanOrEqual(before - 5);
      expect(row.consentedAt.getTime()).toBeLessThanOrEqual(Date.now() + 5);
    }
  });

  it("AC-135 / §13.3: talep oturumunda görüntüleme onayı session_consents'e request_id, metin kimliği ve sha ile yazılır", async () => {
    const { l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const c = (await rc.createReq(ref, "198.51.110.20")).json<{ requestId: string; requestSecret: string }>();
    const ws = await rc.reqWs(c.requestSecret);
    await waitMsg(ws, "request.state");
    const x = await login(l.app, t.id, { perms: REQ_PERMS });
    const acc = await rc.accept(x.s.headers, c.requestId);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(ws, "request.accepted");
    const techWs = await connect(`${l.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(x.s.token, ORIGIN));
    await techWs.waitFor("hello");
    const guest = await rc.guestWs(wsTicket);
    await guest.waitFor("hello");
    const consent = await testDb().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } });
    await expect
      .poll(() => testDb().sessionConsent.findMany({ where: { sessionId } }))
      .toMatchObject([
        {
          level: "VIEW",
          decision: "GRANTED",
          source: "UI",
          requestId: c.requestId,
          consentTextId: consent.id,
          consentSha256: consent.sha256,
        },
      ]);
    guest.ws.close();
    techWs.ws.close();
    ws.ws.close();
  });
});

describe("AC-147 / AC-148 yetki ve Super Admin bağlamı", () => {
  it("AC-147: yalnız support_requests.view yetkili kullanıcı liste/sayaç/detay 200, kabul ve ret 403; talep PENDING kalır, audit yok", async () => {
    const { l } = await boot();
    const t = await createTenant();
    const { id } = await createRequestRow(t.id);
    const v = await login(l.app, t.id, { perms: { "support_requests.view": true } });
    expect((await api(l.app, v.s, "GET", "/api/v1/support-requests")).statusCode).toBe(200);
    expect((await api(l.app, v.s, "GET", "/api/v1/support-requests?tab=history")).statusCode).toBe(200);
    expect((await api(l.app, v.s, "GET", "/api/v1/support-requests/count")).json()).toEqual({ pending: 1 });
    expect((await api(l.app, v.s, "GET", `/api/v1/support-requests/${id}`)).statusCode).toBe(200);
    const acc = await api(l.app, v.s, "POST", `/api/v1/support-requests/${id}/accept`, {});
    expect(acc.statusCode).toBe(403);
    expect(errOf(acc).code).toBe("FORBIDDEN");
    const rej = await api(l.app, v.s, "POST", `/api/v1/support-requests/${id}/reject`, { message: "Şu an müsait değiliz" });
    expect(rej.statusCode).toBe(403);
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    expect(await testDb().auditLog.count({ where: { entityId: id, action: { in: ["request.accepted", "request.rejected"] } } })).toBe(0);
  });

  // AC-147 "view yoksa tüm talep uçları 403" (düzeltme turu 1: accept/reject view + accept ister).
  it("AC-147: accept var / view yok kullanıcı kabul ve ret uçlarında 403 almalı", async () => {
    const { l } = await boot();
    const t = await createTenant();
    const { id } = await createRequestRow(t.id);
    const a = await login(l.app, t.id, { perms: { ...TECH_PERMS, "support_requests.accept": true } });
    expect((await api(l.app, a.s, "GET", "/api/v1/support-requests")).statusCode).toBe(403);
    expect((await api(l.app, a.s, "POST", `/api/v1/support-requests/${id}/reject`, { message: "Şu an müsait değiliz" })).statusCode).toBe(
      403,
    );
    expect((await api(l.app, a.s, "POST", `/api/v1/support-requests/${id}/accept`, {})).statusCode).toBe(403);
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
  });

  it('AC-148: Super Admin firma seçmeden tüm talep ve ayar uçlarında 403 "Önce bir firma seçin."', async () => {
    const { l } = await boot();
    const t = await createTenant();
    const { id } = await createRequestRow(t.id);
    const sa = await login(l.app, null, { role: "SUPER_ADMIN" });
    const calls: [method: "GET" | "POST" | "PUT", url: string, payload?: unknown][] = [
      ["GET", "/api/v1/support-requests"],
      ["GET", "/api/v1/support-requests/count"],
      ["GET", `/api/v1/support-requests/${id}`],
      ["POST", `/api/v1/support-requests/${id}/accept`, {}],
      ["POST", `/api/v1/support-requests/${id}/reject`, { message: "Şu an müsait değiliz" }],
      ["GET", "/api/v1/settings/support-requests"],
      ["POST", "/api/v1/settings/support-requests/rotate-ref", {}],
    ];
    for (const [m, url, p] of calls) {
      const r = await api(l.app, sa.s, m, url, p);
      expect(r.statusCode, `${m} ${url}`).toBe(403);
      expect(errOf(r).message, url).toBe("Önce bir firma seçin.");
    }
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
  });

  it("AC-148: Super Admin seçili tenant bağlamında yalnız o tenant'ın taleplerini görür; başka tenant 404; kabul 403 (sapma 2)", async () => {
    const { l } = await boot();
    const a = await createTenant();
    const b = await createTenant();
    const ra = await createRequestRow(a.id);
    const rb = await createRequestRow(b.id);
    const sa = await login(l.app, null, { role: "SUPER_ADMIN" });
    await testDb().authSession.update({ where: { tokenHash: sha256Hex(sa.s.token) }, data: { actingTenantId: a.id } });
    const list = await api(l.app, sa.s, "GET", "/api/v1/support-requests");
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain(ra.id);
    expect(list.body).not.toContain(rb.id);
    expect((await api(l.app, sa.s, "GET", "/api/v1/support-requests/count")).json()).toEqual({ pending: 1 });
    expect((await api(l.app, sa.s, "GET", `/api/v1/support-requests/${ra.id}`)).statusCode).toBe(200);
    expect((await api(l.app, sa.s, "GET", `/api/v1/support-requests/${rb.id}`)).statusCode).toBe(404);
    const acc = await api(l.app, sa.s, "POST", `/api/v1/support-requests/${ra.id}/accept`, {});
    expect(acc.statusCode).toBe(403);
    expect(errOf(acc).message).toBe("Talep yalnız kendi firmanızda kabul edilebilir.");
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id: ra.id } })).status).toBe("PENDING");
    expect(await testDb().supportSession.count({ where: { requestId: ra.id } })).toBe(0);
  });

  // Sapma 2 (implementation.md) "kabul/ret yapamaz" — düzeltme turu 1: rejectRequest'te de Super Admin kontrolü.
  it("AC-148: Super Admin seçili tenant'ta ret 403 almalı", async () => {
    const { l } = await boot();
    const a = await createTenant();
    const ra = await createRequestRow(a.id);
    const sa = await login(l.app, null, { role: "SUPER_ADMIN" });
    await testDb().authSession.update({ where: { tokenHash: sha256Hex(sa.s.token) }, data: { actingTenantId: a.id } });
    const rej = await api(l.app, sa.s, "POST", `/api/v1/support-requests/${ra.id}/reject`, { message: "Şu an müsait değiliz" });
    expect(rej.statusCode).toBe(403);
  });
});

describe("AC-157 / AC-160 kabul-ret audit ve PII", () => {
  it("AC-160/157: request.accepted{sessionId, waitSec} ve request.rejected{message} yazılır; ad/telefon/e-posta/açıklama hiçbir request.* audit'inde yok, müşteri IP'si yalnız request.created'da", async () => {
    const { l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const ip = "198.51.111.9";
    const extra = {
      customerName: "Zeliha Testoğlu",
      phone: "0532 987 65 43",
      email: "zeliha.p8b5@qx7-musteri.test",
      description: "Benzersiz-aciklama-QX7 ekran donuyor",
    };
    const mk = async () => (await rc.createReq(ref, ip, { extra })).json<{ requestId: string; requestSecret: string }>();
    const r1 = await mk();
    const r2 = await mk();
    const r3 = await mk();
    const x = await login(l.app, t.id, { perms: REQ_PERMS });
    const acc = await rc.accept(x.s.headers, r1.requestId);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const message = "Şu an müsait değiliz, sizi arayacağız";
    expect((await api(l.app, x.s, "POST", `/api/v1/support-requests/${r2.requestId}/reject`, { message })).statusCode).toBe(204);
    expect((await rc.cancel(r3.requestSecret, ip)).statusCode).toBe(204);

    const accepted = await testDb().auditLog.findFirstOrThrow({ where: { entityId: r1.requestId, action: "request.accepted" } });
    expect(accepted).toMatchObject({
      tenantId: t.id,
      userId: x.user.id,
      entity: "support_requests",
      result: "success",
      oldValue: { status: "PENDING" },
      newValue: { status: "ACCEPTED", sessionId },
    });
    expect(typeof (accepted.newValue as { waitSec?: unknown }).waitSec).toBe("number");
    const rejected = await testDb().auditLog.findFirstOrThrow({ where: { entityId: r2.requestId, action: "request.rejected" } });
    expect(rejected).toMatchObject({
      tenantId: t.id,
      userId: x.user.id,
      entity: "support_requests",
      result: "success",
      newValue: { status: "REJECTED", message },
    });

    const rows = await testDb().auditLog.findMany({ where: { tenantId: t.id, action: { startsWith: "request." } } });
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set(["request.created", "request.accepted", "request.rejected", "request.cancelled"]),
    );
    for (const r of rows) {
      const text = json(r);
      for (const pii of [
        "Zeliha",
        "Testoğlu",
        "9876543",
        "987 65 43",
        "zeliha.p8b5",
        "qx7-musteri",
        "Benzersiz-aciklama-QX7",
        "ekran donuyor",
        r1.requestSecret,
        r2.requestSecret,
        r3.requestSecret,
      ]) {
        expect(text, `${r.action} içinde ${pii}`).not.toContain(pii);
      }
      if (r.action !== "request.created") expect(json(r.newValue), r.action).not.toContain(ip);
    }
  });
});

describe("AC-143 bekleyen talep sınırları", () => {
  it("AC-143: aynı IP'den 4. bekleyen 429 (genel mesaj); biri kapanınca yer açılır; aynı /24'ten 11. bekleyen 429, komşu /24 serbest; IPv6 /64 tek IP sayılır", async () => {
    const { rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const a = "198.51.120.10";
    const first: { requestSecret: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await rc.createReq(ref, a);
      expect(r.statusCode).toBe(201);
      first.push(r.json());
    }
    const fourth = await rc.createReq(ref, a);
    expect(fourth.statusCode).toBe(429);
    expect(errOf(fourth)).toMatchObject({ code: "RATE_LIMITED", message: REQUEST_BUSY_MESSAGE });
    expect((await rc.cancel(first[0]?.requestSecret ?? "", a)).statusCode).toBe(204);
    expect((await rc.createReq(ref, a)).statusCode).toBe(201); // bekleyen sayılır, toplam değil

    for (const h of [11, 12]) for (let i = 0; i < 3; i++) expect((await rc.createReq(ref, `198.51.120.${h}`)).statusCode).toBe(201);
    expect((await rc.createReq(ref, "198.51.120.13")).statusCode).toBe(201); // /24'te 10. bekleyen
    const eleventh = await rc.createReq(ref, "198.51.120.13");
    expect(eleventh.statusCode).toBe(429);
    expect(errOf(eleventh)).toMatchObject({ code: "RATE_LIMITED", message: REQUEST_BUSY_MESSAGE });
    expect((await rc.createReq(ref, "198.51.120.14")).statusCode).toBe(429);
    expect((await rc.createReq(ref, "198.51.121.5")).statusCode).toBe(201);
    expect(await testDb().supportRequest.count({ where: { tenantId: t.id, status: "PENDING" } })).toBe(11);
    expect(await testDb().auditLog.count({ where: { tenantId: t.id, action: "request.rate_limited" } })).toBeGreaterThanOrEqual(1);

    for (const s of ["a", "b", "c"]) expect((await rc.createReq(ref, `2001:db8:5:7::${s}`)).statusCode).toBe(201);
    expect((await rc.createReq(ref, "2001:db8:5:7::d")).statusCode).toBe(429);
    expect((await rc.createReq(ref, "2001:db8:5:8::a")).statusCode).toBe(201);
  });

  it("AC-143: güvenilen CIDR kaynağı IP (3) ve önek (10) bekleyen sınırlarından muaf; örnek sınırı (1) yine uygulanır", async () => {
    const { rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id, { trustedCidrs: ["198.51.122.0/24"] });
    for (let i = 0; i < 5; i++) expect((await rc.createReq(ref, "198.51.122.10")).statusCode).toBe(201);
    for (let i = 0; i < 7; i++) expect((await rc.createReq(ref, "198.51.122.11")).statusCode).toBe(201);
    const rows = await testDb().supportRequest.findMany({ where: { tenantId: t.id, status: "PENDING" } });
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.networkMatch === "TRUSTED")).toBe(true);
    const inst = "inst-p8b5-trusted-0001";
    expect((await rc.createReq(ref, "198.51.122.12", { instance: inst })).statusCode).toBe(201);
    const again = await rc.createReq(ref, "198.51.122.12", { instance: inst });
    expect(again.statusCode).toBe(409);
    expect(errOf(again).code).toBe("REQUEST_PENDING");
  });
});

describe("AC-129 tenantRef ve ayar uçları yetkisi", () => {
  it("AC-129: settings.edit yetkili Admin indirme bağlantısını alır — ref 16 karakter base32 (80 bit), tenant'lar arası farklı; yetkisiz kullanıcı tüm ayar uçlarında 403, oturumsuz 401", async () => {
    const { l } = await boot();
    const refs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = await createTenant();
      const admin = await login(l.app, t.id, { role: "ADMIN" });
      const r = await api(l.app, admin.s, "GET", "/api/v1/settings/support-requests");
      expect(r.statusCode).toBe(200);
      const body = r.json<{ downloadUrl: string; fileName: string; refPrefix: string }>();
      const m = /\/api\/v1\/public\/agent\/request-download\?ref=([a-z2-7]+)$/.exec(body.downloadUrl);
      const ref = m?.[1] ?? "";
      expect(ref).toMatch(/^[a-z2-7]{16}$/); // 16 × 5 bit = 80 bit ≥ 64
      expect(body.fileName).toBe(`NoktaDestek-${body.fileName.split("-")[1]}-${ref}.exe`);
      expect(body.refPrefix).toBe(ref.slice(0, 4));
      expect((await testDb().tenantRequestSettings.findUniqueOrThrow({ where: { tenantId: t.id } })).requestRef).toBe(ref);
      refs.push(ref);

      const user = await login(l.app, t.id, { perms: { ...REQ_PERMS, "settings.view": true } });
      const calls: [method: "GET" | "POST" | "PUT", url: string, payload?: unknown][] = [
        ["GET", "/api/v1/settings/support-requests"],
        [
          "PUT",
          "/api/v1/settings/support-requests",
          { waitMinutes: 30, trustedCidrs: [], whatsapp: { enabled: false, recipients: [] }, email: { enabled: false, recipients: [] } },
        ],
        ["POST", "/api/v1/settings/support-requests/rotate-ref", {}],
        ["POST", "/api/v1/settings/support-requests/whatsapp/test", { phone: "05321234567" }],
      ];
      for (const [mth, url, p] of calls) {
        const res = await api(l.app, user.s, mth, url, p);
        expect(res.statusCode, `${mth} ${url}`).toBe(403);
        expect(res.body).not.toContain(ref);
        expect((await l.app.inject({ method: mth, url, headers: { origin: ORIGIN } })).statusCode).toBe(401);
      }
    }
    expect(new Set(refs).size).toBe(3);
  });
});

describe("AC-158 / AC-159 geçmiş ve anonimleştirme", () => {
  it("AC-158: geçmiş detayında talep bölümü (zaman, bekleme, ad, telefon, e-posta, açıklama); CSV Kaynak=Talep, Bekleme ve talepten gelen müşteri adında formül kaçışı", async () => {
    const { l, rc } = await boot();
    const t = await createTenant();
    const x = await login(l.app, t.id, { perms: REQ_PERMS });
    const createdAt = new Date(Date.now() - 90_000);
    const name = '=HYPERLINK("http://x")';
    const { id } = await createRequestRow(t.id, {
      createdAt,
      customerName: name,
      customerEmail: "musteri@example.test",
      description: "+cmd yazıcı çalışmıyor lütfen",
    });
    const acc = await rc.accept(x.s.headers, id);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const admin = await login(l.app, t.id, { role: "ADMIN" });

    const detail = await api(l.app, admin.s, "GET", `/api/v1/sessions/${sessionId}/history`);
    expect(detail.statusCode).toBe(200);
    const req = detail.json<{ request: Record<string, unknown> }>().request;
    expect(req).toMatchObject({
      id,
      createdAt: createdAt.toISOString(),
      customerName: name,
      customerPhone: "+905321234567",
      customerEmail: "musteri@example.test",
      description: "+cmd yazıcı çalışmıyor lütfen",
    });
    expect(typeof req.acceptedAt).toBe("string");
    expect(req.waitSec).toBeGreaterThanOrEqual(89);
    expect(req.waitSec).toBeLessThanOrEqual(95);

    const csv = await api(l.app, admin.s, "GET", "/api/v1/sessions/export.csv?source=REQUEST");
    expect(csv.statusCode, csv.body).toBe(200);
    const lines = csv.rawPayload.toString("utf8").slice(1).split("\r\n").filter(Boolean);
    expect(lines[0]).toContain(";Mod;Kaynak;Müşteri firma;Bekleme;"); // P8c AC-179: Kaynak'tan sonra "Müşteri firma";
    const row = lines.find((ln) => ln.startsWith(sessionId));
    expect(row).toBeDefined();
    expect(row).toMatch(/;Talep;;00:01:(29|3\d);/);
    expect(row).toContain(';"\'=HYPERLINK(""http://x"")";');
    expect(row).not.toMatch(/;=HYPERLINK/);
  });

  it("AC-159: retention sonrası ad, telefon, e-posta, açıklama, IP, ip_key, net_key, device_hash boşaltılır; süre tenant retention_days'e göre (90 / 730)", async () => {
    const { l } = await boot();
    const day = 86_400_000;
    const short = await createTenant();
    const long = await createTenant();
    await testDb().tenantSettings.update({ where: { tenantId: short.id }, data: { retentionDays: 90 } });
    await testDb().tenantSettings.update({ where: { tenantId: long.id }, data: { retentionDays: 730 } });
    const mk = async (tenantId: string, ageDays: number) => {
      const at = new Date(Date.now() - ageDays * day);
      const { id } = await createRequestRow(tenantId, { createdAt: at, customerEmail: "anon@example.test", deviceHash: "a".repeat(64) });
      await testDb().supportRequest.update({ where: { id }, data: { status: "EXPIRED", closedAt: at } });
      return id;
    };
    const old90 = await mk(short.id, 100);
    const young90 = await mk(short.id, 80);
    const mid730 = await mk(long.id, 400);
    const old730 = await mk(long.id, 740);
    await forEachRetentionTenant(l.app.requests, anonymizeRequestsOf);
    const pii = {
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      description: null,
      ip: null,
      ipKey: null,
      netKey: null,
      deviceHash: null,
    };
    for (const id of [old90, old730]) {
      const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject(pii);
      expect(row.anonymizedAt).not.toBeNull();
      expect(row.requestCode).toMatch(/^\d{6}$/); // kayıt silinmez
    }
    for (const id of [young90, mid730]) {
      const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ customerEmail: "anon@example.test", deviceHash: "a".repeat(64), anonymizedAt: null });
      expect(row.ipKey).not.toBeNull();
      expect(row.netKey).not.toBeNull();
    }
  });
});
