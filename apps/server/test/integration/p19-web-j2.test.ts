// P19 J2 — web talep formu, /ws/request BROWSER yolu, BROWSER ön-kabul (mimari-e11 §8c.2, §8c.6, §8c.9; AC-259,
// S-P19-1/2/3/4/9/12/13/15, T4/T10/T11/T12). Gerçek MySQL + gerçek dinleyen sunucu (WS).
import type {
  CreateRequestResponse,
  SupportRequestListResponse,
  SupportRequestSettings,
  WebFormInfo,
} from "@remote/contracts/api/requests";
import { WEB_REQUEST_AUDIT } from "@remote/contracts/audit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { aadFor, SecretBox } from "../../src/lib/crypto.ts";
import { newId, newSecretToken } from "../../src/lib/ids.ts";
import { netKey, prefixKey } from "../../src/lib/ip.ts";
import { FormTokens } from "../../src/requests/form-token.ts";
import { sweepRequests } from "../../src/requests/jobs.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import { createCustomerRow, createRequestRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders } from "../helpers/ws.ts";

const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
let live: Live;
const db = testDb;
const box = new SecretBox(null);
/** Form token'ı 3 sn geriye tarihli üretilir (2 sn kuralını test başına beklemeden geçmek için); doğrulama gerçek saatle. */
function backdatedTokens(maxNonces?: number, tenantMaxNonces?: number): FormTokens {
  let skew = 0;
  const ft = new FormTokens(box, () => Date.now() + skew, maxNonces, tenantMaxNonces);
  const issue = ft.issue.bind(ft);
  ft.issue = (ref: string, tenantId: string) => {
    skew = -3000;
    try {
      return issue(ref, tenantId);
    } finally {
      skew = 0;
    }
  };
  return ft;
}

beforeAll(async () => {
  // MIN_AGENT_VERSION yüksek: WEB hiçbir sürüm kapısından geçmez (S-P19-13); AGENT talepleri bu testte 9.9.9 beyan eder.
  live = await startLive({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32", MIN_AGENT_VERSION: "9.9.9" } });
  live.app.requests.formTokens = backdatedTokens();
});
afterAll(() => live.close());

let ipSeq = 0;
const nextIp = () => `10.19.${Math.floor(++ipSeq / 250) + 1}.${(ipSeq % 250) + 1}`;
const errOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string; message: string; fields?: Record<string, string> } }>().error;

async function webTenant(o: { trustedCidrs?: string[]; sms?: boolean; email?: boolean; formEnabled?: boolean } = {}) {
  const t = await createTenant();
  const ref = await createRequestSettings(t.id, { trustedCidrs: o.trustedCidrs ?? [] });
  await db().tenantRequestSettings.update({
    where: { tenantId: t.id },
    data: { webFormEnabled: o.formEnabled ?? true, notifySmsEnabled: o.sms ?? false, notifyEmailEnabled: o.email ?? false },
  });
  // J3: SMS kanalı kullanılabilir sayılması için firma adresi + çözülebilir anahtar (gönderim bu testlerde yapılmaz).
  if (o.sms) {
    const url = "https://sms.example.com";
    const enc = Buffer.from(live.app.secrets.encrypt("sms-test-key-0123456789", aadFor.smsApiKey(t.id, url)));
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { smsUrl: url, smsApiKeyEnc: enc } });
  }
  return { t, ref };
}

const form = (ref: string, ip: string) =>
  live.app.inject({ method: "GET", url: `/api/v1/public/web-requests/form?ref=${ref}`, headers: { "x-forwarded-for": ip } });

async function token(ref: string, ip: string): Promise<WebFormInfo> {
  const r = await form(ref, ip);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<WebFormInfo>();
}

type Extra = Record<string, unknown>;
function webBody(ref: string, info: WebFormInfo, extra: Extra = {}) {
  return {
    ref,
    formToken: info.formToken,
    website: "",
    clientInstanceId: newSecretToken().slice(0, 22),
    customerName: "Ayşe Web",
    phone: "0532 111 22 33",
    description: "Tarayıcıdan destek istiyorum lütfen",
    consentTextId: info.consentText.id,
    consentAccepted: true,
    notify: { sms: false, whatsapp: false, email: false },
    ...extra,
  };
}
const postWeb = (payload: object, ip: string, headers: Record<string, string> = { origin: ORIGIN }) =>
  live.app.inject({ method: "POST", url: "/api/v1/public/web-requests", headers: { ...headers, "x-forwarded-for": ip }, payload });
async function createWeb(ref: string, ip = nextIp(), extra: Extra = {}) {
  const info = await token(ref, ip);
  return postWeb(webBody(ref, info, extra), ip);
}
const reqWs = (secret: string, headers: Record<string, string>) =>
  connect(`${live.base}/ws/request`, ["rs.v1", `rs.req.${secret}`, "rs.cap.chat1"], headers);

async function tech(tenantId: string): Promise<Session> {
  return loginAs(live.app, await createUser({ tenantId, role: "USER", perms: REQ_PERMS }));
}

describe("AC-259 web talep formu", () => {
  it("AC-259: form → kuyruk source=WEB (sürüm NULL); panel request.new source=WEB + customerChat SUPPORTED; kabul → /ws/guest BROWSER (hello), oturum mode=BROWSER", async () => {
    const { t, ref } = await webTenant();
    const rc = requestClient(live.app, live.base);
    const ts = await tech(t.id);
    const panel = await rc.panelWs(ts.token);
    await waitMsg(panel, "queue.count");
    const info = await token(ref, nextIp());
    expect(info).toMatchObject({ tenant: { name: expect.any(String) as string }, minDelayMs: 2000, channels: { sms: false } });
    expect(info.chatRetentionDays).toBeGreaterThan(0);
    expect(JSON.stringify(info)).not.toContain("Musteri");
    const res = await postWeb(webBody(ref, info), nextIp());
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    const c = res.json<CreateRequestResponse>();
    const row = await db().supportRequest.findUniqueOrThrow({ where: { id: c.requestId } });
    expect(row).toMatchObject({ source: "WEB", clientVersion: null, status: "PENDING", notifySms: false });
    const news = await waitMsg<{ id: string; source: string; customerChat: string }>(panel, "request.new");
    expect(news).toMatchObject({ id: c.requestId, source: "WEB", customerChat: "SUPPORTED" });
    const audit = await db().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.created" } });
    expect(audit.newValue).toMatchObject({ source: "WEB", clientVersion: null, notify: { sms: false, whatsapp: false, email: false } });
    expect(audit.newValue).not.toHaveProperty("notifySuppressed");

    // WEB soketi MIN_AGENT_VERSION=9.9.9 iken de 426 almaz (S-P19-13).
    const rws = await reqWs(c.requestSecret, { origin: ORIGIN });
    await waitMsg(rws, "request.state");
    const list = await live.app.inject({ method: "GET", url: "/api/v1/support-requests?source=WEB", headers: ts.headers });
    expect(list.json<SupportRequestListResponse>().items.map((i) => [i.id, i.source])).toEqual([[c.requestId, "WEB"]]);
    expect(
      (
        await live.app.inject({ method: "GET", url: "/api/v1/support-requests?source=AGENT", headers: ts.headers })
      ).json<SupportRequestListResponse>().items,
    ).toEqual([]);

    const acc = await rc.accept(ts.headers, c.requestId);
    expect(acc.statusCode, acc.body).toBe(200);
    const accepted = await waitMsg<{ wsTicket: string; admitCode?: string }>(rws, "request.accepted");
    expect(accepted).not.toHaveProperty("admitCode");
    const g = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${accepted.wsTicket}`], { origin: ORIGIN });
    await g.waitFor("hello");
    const sessionId = acc.json<{ sessionId: string }>().sessionId;
    expect((await db().supportSession.findUniqueOrThrow({ where: { id: sessionId } })).mode).toBe("BROWSER");
    const ga = await db().auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: "guest.admitted" } });
    expect(ga.newValue).toMatchObject({ via: "request", guestKind: "BROWSER" });
  });

  it("AC-259 / S-P19-13: mesai REJECT → 409 OUTSIDE_HOURS (QUEUE_FULL eşlemesi yok); talep yazılmaz", async () => {
    const { t, ref } = await webTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const localDay = (d: number) => new Date(Date.now() + 3 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);
    await db().tenantRequestSettings.update({
      where: { tenantId: t.id },
      data: {
        hoursEnabled: true,
        afterHoursMode: "REJECT",
        businessHours: [0, 1, 2, 3, 4, 5, 6].map(() => [{ from: "00:00", to: "24:00" }]),
      },
    });
    for (const d of [0, 1])
      await db().businessHoliday.create({
        data: { id: newId(), tenantId: t.id, day: new Date(`${localDay(d)}T00:00:00.000Z`), name: "Tatil", createdBy: admin.id },
      });
    live.app.requests.calendars.invalidate(t.id);
    const r = await createWeb(ref);
    expect(r.statusCode, r.body).toBe(409);
    expect(errOf(r).code).toBe("OUTSIDE_HOURS");
    expect(await db().supportRequest.count({ where: { tenantId: t.id } })).toBe(0);
  });

  it("S-P19-9: `<img onerror>` ad/açıklama düz metin olarak saklanır ve JSON'da aynen döner (sunucu HTML üretmez)", async () => {
    const { t, ref } = await webTenant();
    const xss = "<img src=x onerror=alert(1)>";
    const r = await createWeb(ref, nextIp(), { customerName: xss, description: `${xss} yardım lütfen` });
    expect(r.statusCode, r.body).toBe(201);
    const ts = await tech(t.id);
    const items = (
      await live.app.inject({ method: "GET", url: "/api/v1/support-requests", headers: ts.headers })
    ).json<SupportRequestListResponse>().items;
    expect(items[0]).toMatchObject({ customerName: xss, description: `${xss} yardım lütfen`, source: "WEB" });
  });

  it("AC-259: ayar ucu webFormEnabled/notify* yazar, webFormUrl + channelWarnings döner; verilmeyen alan korunur; audit", async () => {
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const admin = await loginAs(live.app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const base = {
      waitMinutes: 30,
      trustedCidrs: [],
      whatsapp: { enabled: false, recipients: [] },
      email: { enabled: false, recipients: [] },
    };
    const put = await live.app.inject({
      method: "PUT",
      url: "/api/v1/settings/support-requests",
      headers: admin.headers,
      payload: { ...base, webFormEnabled: true, notifySmsEnabled: true, notifyEmailEnabled: true },
    });
    expect(put.statusCode, put.body).toBe(200);
    const v = put.json<SupportRequestSettings>();
    expect(v).toMatchObject({ webFormEnabled: true, webFormUrl: `${ORIGIN}/r/${ref}`, notifySmsEnabled: true, notifyEmailEnabled: true });
    expect(v.channelWarnings).toEqual(["sms", "email"]); // J3: SMS adresi/anahtarı yok, SMTP yok
    const again = await live.app.inject({ method: "PUT", url: "/api/v1/settings/support-requests", headers: admin.headers, payload: base });
    expect(again.json<SupportRequestSettings>()).toMatchObject({ webFormEnabled: true, notifySmsEnabled: true });
    const a = await db().auditLog.findFirstOrThrow({
      where: { tenantId: t.id, action: "settings.support_requests.updated" },
      orderBy: { id: "asc" },
    });
    expect(a.oldValue).toMatchObject({ webFormEnabled: false });
    expect(a.newValue).toMatchObject({ webFormEnabled: true, notifySmsEnabled: true });
  });
});

describe("S-P19-1 bot kapısı", () => {
  it("S-P19-1: 1,8 sn → 429 RATE_LIMITED retryAfterSec ≤ 2 (tüketilmez), aynı token 2 sn sonra 201; yeniden kullanım 400 FORM_TOKEN_INVALID", async () => {
    const { ref } = await webTenant();
    const skew = { v: 0 };
    const prev = live.app.requests.formTokens;
    live.app.requests.formTokens = new FormTokens(box, () => Date.now() + skew.v);
    try {
      const ip = nextIp();
      const info = await token(ref, ip);
      const body = webBody(ref, info);
      skew.v = 1800;
      const fast = await postWeb(body, ip);
      expect(fast.statusCode, fast.body).toBe(429);
      expect(errOf(fast)).toMatchObject({ code: "RATE_LIMITED", message: "Lütfen birkaç saniye sonra tekrar deneyin." });
      expect(Number(fast.headers["retry-after"])).toBeLessThanOrEqual(2);
      skew.v = 2100;
      expect((await postWeb(body, ip)).statusCode).toBe(201);
      const again = await postWeb({ ...body, clientInstanceId: newSecretToken().slice(0, 22) }, ip);
      expect(again.statusCode).toBe(400);
      expect(errOf(again).code).toBe("FORM_TOKEN_INVALID");
    } finally {
      live.app.requests.formTokens = prev;
    }
    expect(live.app.metrics.render()).toMatch(/rs_web_form_rejected_total\{reason="fast"\} \d+/);
  });

  it("S-P19-1 (T4): aynı token 10 paralel → tam 1 × 201, 9 × 400", async () => {
    const { t, ref } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    const info = await token(ref, nextIp());
    const res = await Promise.all(Array.from({ length: 10 }, () => postWeb(webBody(ref, info), nextIp())));
    const codes = res.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, ...Array<number>(9).fill(400)]);
    expect(res.filter((r) => r.statusCode === 400).every((r) => errOf(r).code === "FORM_TOKEN_INVALID")).toBe(true);
    expect(await db().supportRequest.count({ where: { tenantId: t.id } })).toBe(1);
  });

  it("S-P19-1 (T4): yeniden başlatma (yeni bootId) sonrası eski token 400; küme dolu (sınır 3) → 400 token_store_full; başka ref'in token'ı 400; website dolu → 400 VALIDATION (alan adı yok)", async () => {
    const { ref } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    const { ref: ref2 } = await webTenant();
    const old = await token(ref, nextIp());
    const prev = live.app.requests.formTokens;
    live.app.requests.formTokens = backdatedTokens(); // yeni süreç
    try {
      const r1 = await postWeb(webBody(ref, old), nextIp());
      expect(errOf(r1).code).toBe("FORM_TOKEN_INVALID");
      const other = await token(ref2, nextIp());
      expect(errOf(await postWeb(webBody(ref, other), nextIp())).code).toBe("FORM_TOKEN_INVALID");
      const hp = await postWeb(webBody(ref, await token(ref, nextIp()), { website: "http://spam" }), nextIp());
      expect(hp.statusCode).toBe(400);
      expect(errOf(hp).code).toBe("VALIDATION");
      expect(errOf(hp).fields).toBeUndefined();

      live.app.requests.formTokens = backdatedTokens(3); // test sınırı 3
      for (let i = 0; i < 3; i++) expect((await createWeb(ref)).statusCode).toBe(201);
      const full = await createWeb(ref);
      expect(full.statusCode).toBe(400);
      expect(errOf(full).code).toBe("FORM_TOKEN_INVALID");
    } finally {
      live.app.requests.formTokens = prev;
    }
    const m = live.app.metrics.render();
    expect(m).toMatch(/rs_web_form_rejected_total\{reason="token_store_full"\} \d+/);
    expect(m).toMatch(/rs_web_form_rejected_total\{reason="honeypot"\} \d+/);
    const a = await db().auditLog.findFirst({ where: { action: WEB_REQUEST_AUDIT.WEB_FORM_REJECTED } });
    expect(a?.newValue).toMatchObject({ reason: expect.any(String) as string });
    expect(JSON.stringify(a?.newValue)).not.toContain(old.formToken);
  });

  it("AC-143/144: 20 AGENT bekleyen + 60 paralel WEB → tam 30 WEB (toplam 50), kalanı 429 QUEUE_FULL", async () => {
    const { t, ref } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    for (let i = 0; i < 20; i++) await createRequestRow(t.id);
    const infos = await Promise.all(Array.from({ length: 60 }, () => token(ref, nextIp())));
    // 503 NOT_READY'de token harcanmıştır → istemci yeni token alır (web kuralı).
    const res = await Promise.all(
      infos.map(async (info) => {
        let cur = info;
        for (;;) {
          const r = await postWeb(webBody(ref, cur), nextIp());
          if (r.statusCode !== 503) return r.statusCode;
          await new Promise((ok) => setTimeout(ok, 50 + Math.random() * 200));
          cur = await token(ref, nextIp());
        }
      }),
    );
    expect(res.filter((c) => c === 201)).toHaveLength(30);
    expect(res.filter((c) => c === 429)).toHaveLength(30);
    expect(await db().supportRequest.count({ where: { tenantId: t.id, status: "PENDING" } })).toBe(50);
  });

  it("AC-143: IP kovası güvenilmeyen kaynakta; sahte XFF etkisiz (güvenilmeyen uzak adresten XFF yok sayılır) → 4. bekleyen 429", async () => {
    const { t, ref } = await webTenant();
    const remote = "203.0.113.77";
    const call = async (i: number) => {
      const info = (
        await live.app.inject({
          method: "GET",
          url: `/api/v1/public/web-requests/form?ref=${ref}`,
          remoteAddress: remote,
          headers: { "x-forwarded-for": `198.51.100.${i}` },
        })
      ).json<WebFormInfo>();
      return live.app.inject({
        method: "POST",
        url: "/api/v1/public/web-requests",
        remoteAddress: remote,
        headers: { origin: ORIGIN, "x-forwarded-for": `198.51.100.${i}` },
        payload: webBody(ref, info),
      });
    };
    for (let i = 1; i <= 3; i++) expect((await call(i)).statusCode).toBe(201);
    const fourth = await call(4);
    expect(fourth.statusCode).toBe(429);
    const rows = await db().supportRequest.findMany({ where: { tenantId: t.id }, select: { ipKey: true } });
    expect(new Set(rows.map((r) => r.ipKey))).toEqual(new Set([remote]));
  });
});

describe("S-P19-K1 nonce kümesi firma bölmeli + token ucu ağ kovaları", () => {
  it("S-P19-K1: A firmasının bölmesi dolunca (sınır 3) A 400 token_store_full; B firmasının formu 201", async () => {
    const { ref: refA } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    const { ref: refB } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    const prev = live.app.requests.formTokens;
    live.app.requests.formTokens = backdatedTokens(100, 3);
    try {
      for (let i = 0; i < 3; i++) expect((await createWeb(refA)).statusCode).toBe(201);
      const full = await createWeb(refA);
      expect(full.statusCode).toBe(400);
      expect(errOf(full).code).toBe("FORM_TOKEN_INVALID");
      const b = await createWeb(refB);
      expect(b.statusCode, b.body).toBe(201);
    } finally {
      live.app.requests.formTokens = prev;
    }
  });

  it("S-P19-K1: kilitli ipKey'den gönderim token'ı TÜKETMEDEN 429; kilit kalkınca aynı token 201", async () => {
    const { ref } = await webTenant();
    const ip = nextIp();
    const info = await token(ref, ip);
    const body = webBody(ref, info);
    const ft = live.app.requests.formTokens;
    const before = ft.nonces.size;
    for (let i = 0; i < 6; i++) live.app.requests.d.limits.createIp.hit(ip); // 6. olay kilidi başlatır
    const r = await postWeb(body, ip);
    expect(r.statusCode, r.body).toBe(429);
    expect(errOf(r).code).toBe("RATE_LIMITED");
    expect(ft.nonces.size).toBe(before);
    expect((await postWeb(body, nextIp())).statusCode).toBe(201); // aynı token başka adresten geçer (tüketilmemişti)
  });

  it("S-P19-K1: IPv6 — aynı /48'in farklı /56'larından token ucu 240/dk sonrası 429 (req.web_form.net48); başka /48 etkilenmez", async () => {
    const { t, ref } = await webTenant();
    for (let i = 0; i < 240; i++) live.app.requests.d.limits.webFormNet48.hit(netKey("2001:db8:4801::1"));
    const r = await form(ref, "2001:db8:4801:aa00::1");
    expect(r.statusCode, r.body).toBe(429);
    expect(errOf(r).code).toBe("RATE_LIMITED");
    expect((await form(ref, "2001:db8:4802:aa00::1")).statusCode).toBe(200);
    const a = await db().auditLog.findFirst({ where: { tenantId: t.id, action: "request.rate_limited" }, orderBy: { id: "desc" } });
    expect(a?.newValue).toMatchObject({ bucket: "req.web_form.net48", keyType: "net48" });
  });

  it("S-P19-K1: IPv6 /56 kovası 120/dk sonrası 429; aynı /48'in başka /56'sı 200", async () => {
    const { ref } = await webTenant();
    for (let i = 0; i < 120; i++) live.app.requests.d.limits.webFormPrefix.hit(prefixKey("2001:db8:5601:1100::1"));
    expect((await form(ref, "2001:db8:5601:11ff::1")).statusCode).toBe(429);
    expect((await form(ref, "2001:db8:5601:1200::1")).statusCode).toBe(200);
  });
});

describe("S-P19-2 / S-P19-3 / S-P19-4 public yüzey", () => {
  it("S-P19-2: geçersiz ref, pasif müşteri, form kapalı → aynı 404 gövdesi (form ve POST); yanıt müşteri adı içermez", async () => {
    const { t, ref } = await webTenant();
    const passive = await createCustomerRow(t.id, { name: "Gizli Müşteri AŞ" });
    await db().customer.update({ where: { id: passive.id }, data: { status: "PASSIVE", passiveAt: new Date() } });
    const { ref: closedRef } = await webTenant({ formEnabled: false });
    const bodies = [];
    for (const r of ["zzzzzzzzzzzzzzzz", passive.requestRef, closedRef]) {
      const res = await form(r, nextIp());
      expect(res.statusCode).toBe(404);
      bodies.push(JSON.stringify({ ...res.json<{ error: object }>().error, requestId: "" }));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("REQUEST_REF_INVALID");
    // POST: başka ref'in token'ı ile değil — form kapalı ref için token alınamaz; açık ref'in token'ı kapalı ref'te HMAC'te düşer.
    const ok = await token(ref, nextIp());
    expect(JSON.stringify(ok)).not.toContain("Gizli Müşteri");
  });

  it("S-P19-15: web_form_enabled=false → form 404 (kill switch); WEB firma kovası dolu → WEB 429, AGENT 201; 30 WEB bekleyen → 31. WEB 429 QUEUE_FULL, AGENT 201", async () => {
    const { t, ref } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    const rc = requestClient(live.app, live.base);
    for (let i = 0; i < 60; i++) live.app.requests.d.limits.tenantWebAll.add(t.id);
    const w = await createWeb(ref);
    expect(w.statusCode).toBe(429);
    expect((await rc.createReq(ref, nextIp(), { version: "9.9.9" })).statusCode).toBe(201);

    const { t: t2, ref: ref2 } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    for (let i = 0; i < 30; i++) await createRequestRow(t2.id, { source: "WEB" });
    const w31 = await createWeb(ref2);
    expect(w31.statusCode).toBe(429);
    expect(errOf(w31).code).toBe("QUEUE_FULL");
    expect((await rc.createReq(ref2, nextIp(), { version: "9.9.9" })).statusCode).toBe(201);
    expect(live.app.requests.d.limits.tenantAll.count(t2.id)).toBe(1); // WEB AGENT kovasına dokunmadı

    await db().tenantRequestSettings.update({ where: { tenantId: t2.id }, data: { webFormEnabled: false } });
    expect((await form(ref2, nextIp())).statusCode).toBe(404);
  });

  it("S-P19-3: yabancı Origin → 403; Origin'siz POST → 403; WS Origin'siz + WEB sırrı → 403; AGENT sırrı + Origin → 403; yabancı Origin WS → 403", async () => {
    const { t, ref } = await webTenant();
    const info = await token(ref, nextIp());
    const bad = await postWeb(webBody(ref, info), nextIp(), { origin: "https://evil.example" });
    expect(bad.statusCode).toBe(403);
    expect((await postWeb(webBody(ref, info), nextIp(), {})).statusCode).toBe(403);
    const web = await createRequestRow(t.id, { source: "WEB" });
    const agent = await createRequestRow(t.id);
    await expect(reqWs(web.secret, {})).rejects.toThrow("HTTP 403");
    await expect(reqWs(agent.secret, { origin: ORIGIN })).rejects.toThrow("HTTP 403");
    await expect(reqWs(web.secret, { origin: "https://evil.example" })).rejects.toThrow("HTTP 403");
  });

  it("S-P19-4 / §8c.2 m.4: iptal ucu tür ↔ kaynak uyuşmazlığında sessizce 204 (talep değişmez); doğru türde iptal edilir", async () => {
    const { t } = await webTenant();
    const web = await createRequestRow(t.id, { source: "WEB" });
    const cancel = (secret: string, headers: Record<string, string>) =>
      live.app.inject({
        method: "POST",
        url: "/api/v1/public/requests/cancel",
        headers: { ...headers, "x-forwarded-for": nextIp() },
        payload: { requestSecret: secret },
      });
    expect((await cancel(web.secret, {})).statusCode).toBe(204);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: web.id } })).status).toBe("PENDING");
    expect((await cancel(web.secret, { origin: ORIGIN })).statusCode).toBe(204);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: web.id } })).status).toBe("CANCELLED");
  });
});

describe("S-P19-12 bildirim bastırma (talep tarafı) + kapalı kanal", () => {
  it("S-P19-12 (T10): aynı numarayla bekleyen WEB → yeni talep 201 + notify_sms=0; yanıt alanları ilkiyle aynı; audit notifySuppressed", async () => {
    const { t, ref } = await webTenant({ sms: true });
    const first = await createWeb(ref, nextIp(), { notify: { sms: true, whatsapp: false, email: false } });
    expect(first.statusCode, first.body).toBe(201);
    const second = await createWeb(ref, nextIp(), { phone: "+90 532 111 22 33", notify: { sms: true, whatsapp: false, email: false } });
    expect(second.statusCode).toBe(201);
    expect(Object.keys(second.json<object>()).sort()).toEqual(Object.keys(first.json<object>()).sort());
    const [a, b] = [first, second].map((r) => r.json<CreateRequestResponse>().requestId);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: a ?? "" } })).notifySms).toBe(true);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: b ?? "" } })).notifySms).toBe(false);
    const au = await db().auditLog.findFirstOrThrow({ where: { entityId: b ?? "", action: "request.created" } });
    expect(au.newValue).toMatchObject({ notifySuppressed: true, notify: { sms: false } });
    expect(JSON.stringify(au.newValue)).not.toContain("532");
    expect(live.app.metrics.render()).toMatch(/rs_notify_suppressed_total\{reason="pending_duplicate"\} \d+/);
    expect(t.id).toBeTruthy();
  });

  it("S-P19-12 (T11): e-posta karşılaştırması `+` eki ve büyük harf normalize; kapalı/kullanılamaz kanal → 400", async () => {
    const { ref } = await webTenant({ email: true });
    expect(
      errOf(await createWeb(ref, nextIp(), { email: "a@x.test", notify: { sms: true, whatsapp: false, email: false } })).fields,
    ).toHaveProperty("notify.sms");
    expect((await createWeb(ref, nextIp(), { email: "a@x.test", notify: { sms: false, whatsapp: false, email: true } })).statusCode).toBe(
      400,
    ); // SMTP yok
    const spy = vi.spyOn(live.app.requests.d.mail, "configFor").mockResolvedValue({} as never);
    try {
      const one = await createWeb(ref, nextIp(), {
        phone: "0532 000 00 01",
        email: "Ad@X.test",
        notify: { sms: false, whatsapp: false, email: true },
      });
      expect(one.statusCode, one.body).toBe(201);
      const two = await createWeb(ref, nextIp(), {
        phone: "0532 000 00 02",
        email: "ad+promo@x.test",
        notify: { sms: false, whatsapp: false, email: true },
      });
      expect(two.statusCode).toBe(201);
      const id = two.json<CreateRequestResponse>().requestId;
      expect((await db().supportRequest.findUniqueOrThrow({ where: { id } })).notifyEmail).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("S-P19-13 kabul kodu (WEB)", () => {
  it("S-P19-13: kabul kodu açık + WEB → 200 + admitCode; kodsuz misafir lobide bekler, yanlış kod reddedilir, doğru kodla hello", async () => {
    const { t, ref } = await webTenant();
    await db().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { requireAcceptCode: true } });
    const rc = requestClient(live.app, live.base);
    const c = (await createWeb(ref)).json<CreateRequestResponse>();
    const rws = await reqWs(c.requestSecret, { origin: ORIGIN });
    await waitMsg(rws, "request.state");
    const ts = await tech(t.id);
    const acc = await rc.accept(ts.headers, c.requestId);
    expect(acc.statusCode, acc.body).toBe(200);
    const accepted = await waitMsg<{ wsTicket: string; admitCode?: string }>(rws, "request.accepted");
    expect(accepted.admitCode).toMatch(/^\d{4}$/);
    const sessionId = acc.json<{ sessionId: string }>().sessionId;
    const techWs = await connect(`${live.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(ts.token, ORIGIN));
    await techWs.waitFor("hello");
    const g = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${accepted.wsTicket}`], { origin: ORIGIN });
    await g.waitFor("lobby.wait");
    await techWs.waitFor("peer.pending");
    techWs.send({ t: "guest.admit", admitCode: accepted.admitCode === "0000" ? "1111" : "0000" });
    expect((await techWs.waitFor("error")).code).toBe("ADMIT_CODE_INVALID");
    techWs.send({ t: "guest.admit", admitCode: accepted.admitCode ?? "" });
    await g.waitFor("hello");
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.accepted" } });
    expect(a.result).toBe("success");
    expect(a.newValue).toMatchObject({ acceptVerification: true });
  });
});

describe("S-P19-T12 kilit sırası", () => {
  it("S-P19-T12: aynı firmada eşzamanlı 20 WEB oluşturma + 5 kabul + süpürücü turu → 1213 yok, 500 yok", async () => {
    const { t, ref } = await webTenant({ trustedCidrs: ["10.0.0.0/8"] });
    const pend = await Promise.all(Array.from({ length: 5 }, () => createRequestRow(t.id)));
    for (let i = 0; i < 3; i++) await createRequestRow(t.id, { createdAt: new Date(Date.now() - 3_600_000), waitMinutes: 10 });
    const techs = await Promise.all(pend.map(() => tech(t.id)));
    const rc = requestClient(live.app, live.base);
    const infos = await Promise.all(Array.from({ length: 20 }, () => token(ref, nextIp())));
    const [creates, accepts, sweep] = await Promise.all([
      Promise.all(
        infos.map(async (info) => {
          let cur = info;
          for (;;) {
            const r = await postWeb(webBody(ref, cur), nextIp());
            if (r.statusCode !== 503) return r.statusCode;
            await new Promise((ok) => setTimeout(ok, 50 + Math.random() * 200));
            cur = await token(ref, nextIp());
          }
        }),
      ),
      Promise.all(pend.map((p, i) => rc.accept(techs[i]?.headers ?? {}, p.id).then((r) => r.statusCode))),
      sweepRequests(live.app.requests),
    ]);
    expect(creates.every((c) => c === 201)).toBe(true);
    expect(accepts.every((c) => c === 200)).toBe(true);
    expect(sweep.expired).toBeGreaterThanOrEqual(3);
  });
});
