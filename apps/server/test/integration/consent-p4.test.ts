// P4 backend: karşılama onayı (G-24, AC-127), onay kaydı (AC-29), paylaşım durumu (AC-31), oturumu bitir
// (AC-32/59), Admin zorla sonlandırma yetki/tenant sınırı (AC-114), dolandırıcılık bildirimi adresi (AC-125).
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex, newId } from "../../src/lib/ids.ts";
import { createConsentText, createTenant, createUser, loginAs, ORIGIN, testDb } from "../helpers/app.ts";
import { admitted, joinGuest, startLive, techSession, type Live, type TechSide } from "../helpers/signal-flow.ts";
import { connect, techHeaders } from "../helpers/ws.ts";

let live: Live | undefined;
afterEach(async () => live?.close());

const headers = { origin: ORIGIN, "x-forwarded-for": "203.0.113.61", "user-agent": "P4-Test-UA" };
const ABUSE = "abuse@example.test";

async function resolve(l: Live, t: Pick<TechSide, "token">) {
  const r = await l.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers,
    payload: { token: t.token, clientKind: "BROWSER" },
  });
  expect(r.statusCode).toBe(200);
  return r.json<{
    joinNonce: string;
    consentText: { id: string; version: number; body: string; sha256: string };
    abuseEmail: string | null;
  }>();
}

const join = (l: Live, joinNonce: string, extra: Record<string, unknown>) =>
  l.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/join",
    headers,
    payload: { joinNonce, customerName: "Ayşe Müşteri", consentAccepted: true, ...extra },
  });

/** v1 eski, v2 güncel metinli tenant (app kullanıcısı is_current UPDATE edemez — P11; doğrudan iki sürüm). */
async function tenantWithOldVersion() {
  const id = newId();
  await testDb().tenant.create({
    data: { id, name: `Firma ${id.slice(-6)}`, slug: `t-${id.toLowerCase()}`, status: "ACTIVE", settings: { create: {} } },
  });
  const v1 = await createConsentText(id, { version: 1, isCurrent: false });
  const v2 = await createConsentText(id, { version: 2, isCurrent: true });
  return { id, v1, v2 };
}

describe("P4 karşılama onayı ve consent kaydı", () => {
  it("AC-127/AC-125: resolve güncel metni (id, version, body, sha256) ve ABUSE_EMAIL adresini döner", async () => {
    live = await startLive({ env: { ABUSE_EMAIL: ABUSE } });
    const ten = await tenantWithOldVersion();
    const t = await techSession(live, ten.id);
    const r = await resolve(live, t);
    expect(r.consentText).toEqual({ id: ten.v2.id, version: 2, body: ten.v2.body, sha256: sha256Hex(ten.v2.body) });
    expect(r.abuseEmail).toBe(ABUSE);
  });

  it("AC-127/G-24: consentTextId yoksa, eski sürümse, başka tenant'ınsa veya bilinmiyorsa 400; doğru id 200", async () => {
    live = await startLive();
    const ten = await tenantWithOldVersion();
    const other = await createTenant();
    const otherText = await testDb().consentText.findFirstOrThrow({ where: { tenantId: other.id, isCurrent: true } });
    const t = await techSession(live, ten.id);

    const missing = await join(live, (await resolve(live, t)).joinNonce, {});
    expect(missing.statusCode).toBe(400);
    for (const bad of [ten.v1.id, otherText.id, newId()]) {
      const res = await join(live, (await resolve(live, t)).joinNonce, { consentTextId: bad });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: { code: string; fields: Record<string, string> } }>().error).toMatchObject({
        code: "VALIDATION",
        fields: { consentTextId: expect.any(String) },
      });
    }
    const r = await resolve(live, t);
    const ok = await join(live, r.joinNonce, { consentTextId: r.consentText.id });
    expect(ok.statusCode).toBe(200);
    const pending = await testDb().auditLog.findFirstOrThrow({ where: { entityId: t.sessionId, action: "guest.pending" } });
    expect(pending.newValue).toMatchObject({ consentTextId: ten.v2.id, consentVersion: "2" });
    expect(await testDb().sessionConsent.count({ where: { sessionId: t.sessionId } })).toBe(0); // join tüketmez, kayıt admit'te
  });

  it("AC-29: admit TX'i VIEW/GRANTED/UI onay kaydını metin özeti, IP ve UA ile yazar; audit guest.admitted özeti taşır", async () => {
    live = await startLive();
    const t = await techSession(live);
    await admitted(live, t);
    const rows = await testDb().sessionConsent.findMany({
      where: { sessionId: t.sessionId, tenantId: t.tenantId },
      orderBy: { createdAt: "asc" },
    });
    const text = await testDb().consentText.findUniqueOrThrow({ where: { id: t.consentTextId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      level: "VIEW",
      decision: "GRANTED",
      source: "UI",
      consentTextId: text.id,
      consentSha256: text.sha256,
      ip: "127.0.0.1",
      userAgent: expect.any(String),
    }); // TRUSTED_PROXY_CIDR yok → soket IP
    const s = await testDb().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } });
    expect(rows[0]?.createdAt.getTime()).toBeLessThanOrEqual(s.consumedAt?.getTime() ?? 0); // join anı ≤ admit anı
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: t.sessionId, action: "guest.admitted" } });
    expect(audit.newValue).toMatchObject({ consentTextId: text.id, consentVersion: "1", consentSha256: text.sha256 });
  });

  it("AC-31: share.state stopped → sharing teknisyene aynen iletilir (yeniden paylaşım aynı oturumda)", async () => {
    live = await startLive();
    const t = await techSession(live);
    const { guest } = await admitted(live, t);
    guest.send({ t: "share.state", state: "stopped" });
    expect(await t.ws.waitFor("share.state")).toEqual({ t: "share.state", state: "stopped" });
    t.ws.msgs.length = 0;
    guest.send({ t: "share.state", state: "sharing" });
    expect((await t.ws.waitFor("share.state")).state).toBe("sharing");
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })).status).toBe("ACTIVE");
  });

  it("AC-32/AC-59: müşteri session.end → iki tarafa session.ended{customer}, DB ENDED/CUSTOMER", async () => {
    live = await startLive();
    const t = await techSession(live);
    const { guest } = await admitted(live, t);
    guest.send({ t: "session.end" });
    expect((await t.ws.waitFor("session.ended")).reason).toBe("customer");
    expect((await guest.waitFor("session.ended")).reason).toBe("customer");
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })).toMatchObject({
      status: "ENDED",
      endedBy: "CUSTOMER",
    });
  });

  it("AC-114: başka tenant'ın Admin'i zorla sonlandıramaz (404), oturum ACTIVE kalır; USER 403", async () => {
    live = await startLive();
    const t = await techSession(live);
    await admitted(live, t);
    const foreign = await loginAs(live.app, await createUser({ tenantId: (await createTenant()).id, role: "ADMIN" }));
    const user = await loginAs(live.app, await createUser({ tenantId: t.tenantId, role: "USER", perms: { "sessions.view": true } }));
    const url = `/api/v1/sessions/${t.sessionId}/terminate`;
    expect((await live.app.inject({ method: "POST", url, headers: foreign.headers, payload: {} })).statusCode).toBe(404);
    expect((await live.app.inject({ method: "POST", url, headers: user.headers, payload: {} })).statusCode).toBe(403);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })).status).toBe("ACTIVE");
  });
});

describe("P4 düzeltme turu 1", () => {
  it("S-P4-3/S-P4-T2-1: customerName'de kontrol/bidi/sıfır genişlikli karakter ve trim sonrası boş/kısa ad 400 fields.customerName", async () => {
    live = await startLive();
    const t = await techSession(live);
    const bad = [
      "Ay\u0000şe",
      "Ayşe\u0007",
      "Ay\u0085şe",
      "\u202EesyA",
      "Ayşe\u2066x\u2069",
      "Ay\u200Bşe",
      "Ay\u200Fşe",
      "\uFEFFAyşe",
      "Ayşe\n",
      "   ",
      " a ",
      // S-P4-T2-1: Cf/Zl/Zp kategori tabanlı
      "Ah\u00ADmet",
      "\u061CAhmet",
      "Ahmet\u2028",
      "Ahmet\u2060",
      "Ah\u2064met",
      "Ahmet\u{E0041}",
    ];
    for (const customerName of bad) {
      const r = await resolve(live, t);
      const res = await join(live, r.joinNonce, { consentTextId: r.consentText.id, customerName });
      expect(res.statusCode, JSON.stringify(customerName)).toBe(400);
      expect(res.json<{ error: { code: string; fields: Record<string, string> } }>().error).toMatchObject({
        code: "VALIDATION",
        fields: { customerName: expect.any(String) },
      });
    }
    const r = await resolve(live, t);
    expect((await join(live, r.joinNonce, { consentTextId: r.consentText.id, customerName: "  Çağrı Öztürk  " })).statusCode).toBe(200);
  });

  it("AC-125/S-P4-1: dev/test'te ABUSE_EMAIL yoksa ilk aktif Super Admin e-postasına düşer", async () => {
    live = await startLive();
    const sa = await testDb().user.findFirst({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
    const t = await techSession(live);
    expect((await resolve(live, t)).abuseEmail).toBe(sa?.email ?? null);
  });

  it("QA-P4-12: peer.joined guestName; teknisyen yeniden bağlanınca hello guestName + son share; misafir ayrılınca share stopped", async () => {
    const l = await startLive();
    live = l;
    const t = await techSession(l);
    const g = await joinGuest(l, t);
    await t.ws.waitFor("peer.pending");
    t.ws.send({ t: "guest.admit", admitCode: g.admitCode });
    await g.ws.waitFor("hello");
    expect(await t.ws.waitFor("peer.joined")).toEqual({
      t: "peer.joined",
      role: "guest",
      guestKind: "BROWSER",
      guestName: "Ayşe Müşteri",
      maxEndsAt: expect.any(String),
      maxFileMb: 100,
      fileMode: "P2P", // P28b §5.1
      guestFeatures: ["fsrv"], // P28b K-P28b-20: tarayıcı misafiri belirteçsiz yetenekli
      guestMulti: false, // P28c K1c AC-372: bu misafir rs.cap.multi1 bildirmiyor
      guestVoice: true, // P28d AC-379: tarayıcı misafiri belirteçsiz sesli görüşme destekli
      guestChat: "outdated", // P22 §4.1 (K-P22-10): bu misafir rs.cap.schat1 bildirmiyor — tarayıcı istisnası yok
    });

    const share = { state: "sharing", monitors: [{ id: 0, name: "Ekran 1", w: 1920, h: 1080, primary: true }], activeMonitor: 0 } as const;
    g.ws.send({ t: "share.state", ...share });
    await t.ws.waitFor("share.state");

    const reconnectTech = async () => {
      const ws = await connect(`${l.base}/ws/tech?sessionId=${t.sessionId}`, ["rs.v1"], techHeaders(t.techAuth.token, ORIGIN));
      return { ws, hello: await ws.waitFor("hello") };
    };
    t.ws.ws.close();
    await g.ws.waitFor("peer.left");
    const a = await reconnectTech();
    expect(a.hello).toMatchObject({ role: "tech", peerPresent: true, guestName: "Ayşe Müşteri", share });

    g.ws.ws.close();
    expect(await a.ws.waitFor("peer.left")).toMatchObject({ role: "guest" });
    a.ws.ws.close();
    await a.ws.closed;
    const b = await reconnectTech();
    expect(b.hello).toMatchObject({ peerPresent: false, guestName: "Ayşe Müşteri", share: { state: "stopped" } });
    expect(b.hello.share).toEqual({ state: "stopped" });
    b.ws.ws.close();
  });

  it("QA-P4-12: PENDING oturumda teknisyen hello'sunda guestName/share yok", async () => {
    live = await startLive();
    const t = await techSession(live);
    t.ws.ws.close();
    await t.ws.closed;
    const ws = await connect(`${live.base}/ws/tech?sessionId=${t.sessionId}`, ["rs.v1"], techHeaders(t.techAuth.token, ORIGIN));
    const hello = await ws.waitFor("hello");
    expect(hello).not.toHaveProperty("guestName");
    expect(hello).not.toHaveProperty("share");
    ws.ws.close();
  });
});
