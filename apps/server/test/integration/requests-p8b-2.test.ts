// P8b-1 test turu 2 — WhatsApp bildirimi ve talep ayarları (mimari-e9 §6, §13.5, §13.6; AC-131, AC-150, AC-152).
// WhatsApp için yalnız yerel sahte HTTP sunucusu (helpers/requests.ts) kullanılır; gerçek servise istek gitmez.
// Deneme beklemeleri ve 8 sn zaman aşımı sahte saatle (FakeClock) ilerletilir.
import { FAKE_APP_ENCRYPTION_KEYS } from "../helpers/secrets.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInsecureServiceUrl, isPrivateHost } from "../../src/notify/service-url.ts";
import { WhatsappNotifier, type FetchLike } from "../../src/notify/whatsapp.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import { createRequestRow, createRequestSettings, startFakeWhatsapp, type FakeWhatsapp } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { FakeClock } from "../helpers/ws.ts";

const HOUR = 3_600_000;
const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;
const asText = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? String(x) : x));

let fake: FakeWhatsapp;
let live: Live | undefined;
beforeEach(async () => {
  fake = await startFakeWhatsapp();
});
afterEach(async () => {
  await live?.close();
  live = undefined;
  await fake.close();
});

/** Notifier'ı doğrudan kurar (yalnız kendi zamanlayıcıları sahte saatte). Saat, saat başından 1 dk sonraya alınır. */
function makeNotifier(o: { url?: string; production?: boolean; fetch?: FetchLike } = {}) {
  const clock = new FakeClock();
  clock.t = Math.floor(Date.now() / HOUR) * HOUR + 60_000;
  const warns: Record<string, unknown>[] = [];
  const log = { info: () => undefined, warn: (obj: object) => void warns.push(obj as Record<string, unknown>), error: () => undefined };
  const n = new WhatsappNotifier({
    url: o.url ?? fake.url,
    production: o.production ?? false,
    publicBaseUrl: ORIGIN,
    db: testDb(),
    log,
    metrics: createMetrics(),
    clock,
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  return { n, clock, warns };
}

const notifyAudits = (tenantId: string) =>
  testDb().auditLog.findMany({ where: { tenantId, action: "request.notify" }, orderBy: { id: "asc" } });
const nv = (a: { newValue: unknown }) => a.newValue as { channel: string; recipient: string | null; result: string; attempts: number };
const phone = (i: number) => `+90532${String(i).padStart(7, "0")}`;
const sends = () => fake.hits.filter((h) => h.path === "/send-message");

describe("P8b-1 WhatsApp bildirimi (AC-150)", () => {
  it("AC-150: yeni talep her alıcıya ayrı /send-message — kişisel verisiz şablon, alıcı başına maskeli audit", async () => {
    live = await startLive({ env: { ...PROXY, WHATSAPP_SERVICE_URL: fake.url } });
    const t = await createTenant();
    await testDb().tenant.update({ where: { id: t.id }, data: { name: "Örnek *Bilgi*  _İşlem_\t~Ltd~ `A`" } });
    const ref = await createRequestSettings(t.id, { waEnabled: true, waRecipients: ["+905321112233", "+905441112233"] });
    const ip = "198.51.100.77";
    const info = await live.app.inject({
      method: "GET",
      url: `/api/v1/public/requests/tenant?ref=${ref}`,
      headers: { "x-forwarded-for": ip },
    });
    const consentTextId = info.json<{ consentText: { id: string } }>().consentText.id;
    const r = await live.app.inject({
      method: "POST",
      url: "/api/v1/public/requests",
      headers: { "x-forwarded-for": ip },
      payload: {
        ref,
        clientInstanceId: "A".repeat(22),
        clientVersion: "0.9.0",
        customerName: "Ayşe Müşteri",
        phone: "0532 123 45 67",
        email: "ayse@example.test",
        description: "Yazıcı çalışmıyor lütfen yardım",
        consentTextId,
        consentAccepted: true,
      },
    });
    expect(r.statusCode).toBe(201);
    const { requestId, requestCode } = r.json<{ requestId: string; requestCode: string }>();

    await expect.poll(() => sends().length).toBe(2);
    expect(
      sends()
        .map((h) => h.body.phoneNumber)
        .sort(),
    ).toEqual(["905321112233", "905441112233"]);
    const expected = `Yeni destek talebi – Örnek Bilgi İşlem Ltd A – panelde görüntüleyin. Talep kodu: ${requestCode}\n${ORIGIN}/requests`;
    for (const h of sends()) {
      expect(Object.keys(h.body).sort()).toEqual(["message", "phoneNumber"]); // attachments hiç yok
      expect(h.body.message).toBe(expected);
      for (const pii of ["Ayşe", "5321234567", "123 45 67", "ayse@", "Yazıcı", requestId])
        expect(String(h.body.message)).not.toContain(pii);
    }

    await expect.poll(async () => (await notifyAudits(t.id)).length).toBe(2);
    const audits = await notifyAudits(t.id);
    expect(audits.map((a) => nv(a)).sort((a, b) => String(a.recipient).localeCompare(String(b.recipient)))).toEqual([
      { channel: "whatsapp", recipient: "+90******2233", result: "success", attempts: 1 },
      { channel: "whatsapp", recipient: "+90******2233", result: "success", attempts: 1 },
    ]);
    expect(audits.every((a) => a.result === "success" && a.username === "system")).toBe(true);
    expect(asText(audits)).not.toContain("5321112233");
  });

  it("AC-150: WhatsApp kapalıysa (wa_enabled=false) talepte servise istek gitmez", async () => {
    live = await startLive({ env: { ...PROXY, WHATSAPP_SERVICE_URL: fake.url } });
    const t = await createTenant();
    const ref = await createRequestSettings(t.id, { waEnabled: false, waRecipients: ["+905321112233"] });
    const ip = "198.51.100.78";
    const info = await live.app.inject({
      method: "GET",
      url: `/api/v1/public/requests/tenant?ref=${ref}`,
      headers: { "x-forwarded-for": ip },
    });
    const r = await live.app.inject({
      method: "POST",
      url: "/api/v1/public/requests",
      headers: { "x-forwarded-for": ip },
      payload: {
        ref,
        clientInstanceId: "B".repeat(22),
        clientVersion: "0.9.0",
        customerName: "Ayşe Müşteri",
        phone: "0532 123 45 67",
        description: "Yazıcı çalışmıyor lütfen yardım",
        consentTextId: info.json<{ consentText: { id: string } }>().consentText.id,
        consentAccepted: true,
      },
    });
    expect(r.statusCode).toBe(201);
    await new Promise((res) => setTimeout(res, 200));
    expect(fake.hits).toHaveLength(0);
  });

  it("AC-150: servis hata verirse 3 deneme (hemen, +5 sn, +20 sn); sonra fail audit attempts=3, 4. deneme yok", async () => {
    fake.plan = () => 500;
    const t = await createTenant();
    const { n, clock } = makeNotifier();
    n.notifyNewRequest(t.id, "Firma", [phone(1)], "123456");
    await expect.poll(() => fake.hits.length).toBe(1);
    await expect.poll(() => clock.hasTimerIn(5_000)).toBe(true);
    clock.advance(4_999);
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.hits).toHaveLength(1); // 5 sn dolmadan ikinci deneme yok
    clock.advance(1);
    await expect.poll(() => fake.hits.length).toBe(2);
    await expect.poll(() => clock.hasTimerIn(20_000)).toBe(true);
    clock.advance(20_000);
    await expect.poll(() => fake.hits.length).toBe(3);
    await expect.poll(async () => (await notifyAudits(t.id)).length).toBe(1);
    const [a] = await notifyAudits(t.id);
    expect(a?.result).toBe("fail");
    expect(a && nv(a)).toMatchObject({ result: "fail", attempts: 3 });
    clock.advance(120_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.hits).toHaveLength(3);
    n.close();
  });

  it("AC-150: 8 sn zaman aşımında çağrı kesilir ve yeniden denenir; ikinci deneme başarılı → success attempts=2", async () => {
    fake.plan = (i) => (i === 1 ? "hang" : 200);
    const t = await createTenant();
    const { n, clock } = makeNotifier();
    n.notifyNewRequest(t.id, "Firma", [phone(2)], "123456");
    await expect.poll(() => fake.hits.length).toBe(1);
    expect(clock.hasTimerIn(8_000)).toBe(true);
    clock.advance(7_999);
    await new Promise((r) => setTimeout(r, 50));
    expect(clock.hasTimerIn(5_000)).toBe(false); // henüz kesilmedi
    clock.advance(1);
    await expect.poll(() => clock.hasTimerIn(5_000)).toBe(true);
    clock.advance(5_000);
    await expect.poll(() => fake.hits.length).toBe(2);
    await expect.poll(async () => (await notifyAudits(t.id)).length).toBe(1);
    const [a] = await notifyAudits(t.id);
    expect(a && nv(a)).toMatchObject({ result: "success", attempts: 2 });
    n.close();
  });

  it("AC-150: alıcı başına 10/sa — fazlası bastırılır (pencere başına tenant için tek suppressed audit), saat sonunda tek özet", async () => {
    const t = await createTenant();
    const { n, clock } = makeNotifier();
    for (let i = 0; i < 12; i++) n.notifyNewRequest(t.id, "Firma A", [phone(3)], String(100000 + i));
    await expect.poll(() => sends().length).toBe(10);
    await expect.poll(async () => (await notifyAudits(t.id)).length).toBe(11);
    const suppressed = (await notifyAudits(t.id)).filter((a) => nv(a).result === "suppressed");
    expect(suppressed).toHaveLength(1);
    expect(nv(suppressed[0] as { newValue: unknown })).toMatchObject({ recipient: null, attempts: 0 });

    clock.advance(HOUR - 60_000); // pencere sonu → özet
    await expect.poll(() => sends().length).toBe(11);
    expect(sends()[10]?.body).toEqual({
      phoneNumber: phone(3).slice(1),
      message: `Son 1 saatte 2 yeni destek talebi daha – Firma A – panelde görüntüleyin.\n${ORIGIN}/requests`,
    });
    clock.advance(HOUR);
    await new Promise((r) => setTimeout(r, 50));
    expect(sends()).toHaveLength(11); // bastırma yoksa yeni özet yok
    n.close();
  });

  it("AC-150: tenant başına 30/sa (alıcı başına sayılır) — 5 alıcı × 7 talep → 30 gönderim, saat sonunda bastırılan her alıcıya bir özet", async () => {
    const t = await createTenant();
    const { n, clock } = makeNotifier();
    const recipients = [10, 11, 12, 13, 14].map(phone);
    for (let i = 0; i < 7; i++) n.notifyNewRequest(t.id, "Firma B", recipients, String(200000 + i));
    await expect.poll(() => sends().length).toBe(30);
    await expect.poll(async () => (await notifyAudits(t.id)).filter((a) => nv(a).result === "success").length).toBe(30);
    expect((await notifyAudits(t.id)).filter((a) => nv(a).result === "suppressed")).toHaveLength(1);
    clock.advance(HOUR - 60_000); // tam pencere sonu (fazlası uçuştaki çağrıların 8 sn zaman aşımını da tetikler)
    await expect.poll(() => sends().length).toBe(35);
    const summaries = sends().slice(30);
    expect(summaries.map((h) => h.body.phoneNumber).sort()).toEqual(recipients.map((p) => p.slice(1)).sort());
    expect(summaries.every((h) => String(h.body.message).startsWith("Son 1 saatte 1 yeni destek talebi daha – Firma B"))).toBe(true);
    n.close();
  });

  it("AC-150: sistem geneli 300/sa — aşımda gönderim yok, whatsapp_global_cap alarmı pencere başına bir kez", async () => {
    const tenants = await Promise.all(Array.from({ length: 11 }, () => createTenant()));
    const { n, warns } = makeNotifier();
    tenants.slice(0, 10).forEach((t, ti) => {
      const rs = [0, 1, 2].map((r) => phone(1000 + ti * 10 + r));
      for (let i = 0; i < 10; i++) n.notifyNewRequest(t.id, "Firma", rs, "300000");
    });
    await expect.poll(() => sends().length, { timeout: 30_000 }).toBe(300);
    const last = tenants[10];
    if (!last) throw new Error("tenant yok");
    n.notifyNewRequest(last.id, "Firma", [phone(9000)], "300001");
    n.notifyNewRequest(last.id, "Firma", [phone(9001)], "300002");
    await new Promise((r) => setTimeout(r, 100));
    expect(sends()).toHaveLength(300);
    expect(warns.filter((w) => w.alarm === "whatsapp_global_cap")).toHaveLength(1);
    await expect.poll(async () => (await notifyAudits(last.id)).map((a) => nv(a).result), { timeout: 30_000 }).toEqual(["suppressed"]); // 300 audit yazımının arkasında kuyruk
    n.close();
  }, 60_000); // QA-P8b-1: 300 gönderim + 300 audit yazımı yük altında

  it("AC-150 / §13.5: production + http + genel adres → kanal kapalı (fail-closed): gönderim/test yok, alarm logu", async () => {
    const calls: string[] = [];
    const spy: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, status: 200 };
    };
    const t = await createTenant();
    const bad = makeNotifier({ url: "http://203.0.113.10:3000", production: true, fetch: spy });
    expect(bad.n.insecure).toBe(true);
    expect(bad.n.usable).toBe(false);
    expect(bad.warns.some((w) => w.alarm === "whatsapp_insecure")).toBe(true);
    bad.n.notifyNewRequest(t.id, "Firma", [phone(20)], "123456");
    expect(await bad.n.test(phone(20))).toMatchObject({ ok: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
    expect(await notifyAudits(t.id)).toHaveLength(0);

    // production + özel/loopback http veya https → güvenli; staging (production değil) her adresle çalışır
    expect(isInsecureServiceUrl("http://127.0.0.1:3000", true)).toBe(false);
    expect(isInsecureServiceUrl("http://10.1.2.3:3000", true)).toBe(false);
    expect(isInsecureServiceUrl("http://[fd00::1]:3000", true)).toBe(false);
    expect(isInsecureServiceUrl("https://wa.example.com", true)).toBe(false);
    expect(isInsecureServiceUrl("http://wa.example.com", true)).toBe(true); // ad çözülmez → genel sayılır
    expect(isInsecureServiceUrl("http://203.0.113.10:3000", false)).toBe(false);
    expect(["localhost", "192.168.1.1", "::1"].every(isPrivateHost)).toBe(true);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(["169.254.1.1", "fe80::1"].some(isPrivateHost)).toBe(false); // P13a T33: link-local özel sayılmaz

    const ok = makeNotifier({ url: fake.url, production: true });
    expect(ok.n.usable).toBe(true);
    ok.n.notifyNewRequest(t.id, "Firma", [phone(21)], "123456");
    await expect.poll(() => sends().length).toBe(1);
    bad.n.close();
    ok.n.close();
  });
});

// ------------------------------------------------------------------------------------------------ ayarlar

async function settingsAdmin(
  tenantId: string,
  perms: Record<string, boolean> = { "settings.view": true, "settings.edit": true },
): Promise<Session> {
  if (!live) throw new Error("live yok");
  return loginAs(live.app, await createUser({ tenantId, role: "USER", perms }));
}
const S = "/api/v1/settings/support-requests";
const validBody = () => ({
  waitMinutes: 30,
  trustedCidrs: [] as string[],
  whatsapp: { enabled: false, recipients: [] as string[] },
  email: { enabled: false, recipients: [] as string[] },
});
const put = (s: Session, payload: unknown) => {
  if (!live) throw new Error("live yok");
  return live.app.inject({ method: "PUT", url: S, headers: s.headers, payload: payload as object });
};
const refOf = (downloadUrl: string) => /ref=([a-z2-7]{16})$/.exec(downloadUrl)?.[1] ?? "";

describe("P8b-1 talep ayarları (AC-131, AC-152)", () => {
  beforeEach(async () => {
    live = await startLive({ env: { ...PROXY, WHATSAPP_SERVICE_URL: fake.url } });
  });

  it("AC-152: PUT kaydeder (CIDR ağ adresine normalize), audit eski→yeni ve WhatsApp alıcıları maskeli", async () => {
    const t = await createTenant();
    const s = await settingsAdmin(t.id);
    const body = {
      ...validBody(),
      waitMinutes: 45,
      trustedCidrs: ["203.0.113.7/24", "2001:db8:abcd::1/32"],
      whatsapp: { enabled: true, recipients: ["0532 111 22 33", "+90 544 111 22 33"] },
    };
    const r = await put(s, body);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      waitMinutes: 45,
      trustedCidrs: ["203.0.113.0/24", "2001:db8::/32"],
      whatsapp: { enabled: true, recipients: ["+905321112233", "+905441112233"], serviceConfigured: true, insecure: false },
    });
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "settings.support_requests.updated" } });
    expect(a.oldValue).toMatchObject({ waitMinutes: 30, waRecipients: [], trustedCidrs: [] });
    expect(a.newValue).toMatchObject({
      waitMinutes: 45,
      waEnabled: true,
      waRecipients: ["+90******2233", "+90******2233"],
      trustedCidrs: ["203.0.113.0/24", "2001:db8::/32"],
    });
    expect(asText(a)).not.toContain("5321112233");
  });

  it("AC-152: PUT doğrulama — alıcı ≤ 5, CIDR ≤ 10, IPv4 ≥ /16, IPv6 ≥ /32, özel aralık, bekleme 10..120, SMTP'siz e-posta, alıcısız kanal → 400; settings.edit yok → 403", async () => {
    const t = await createTenant();
    const s = await settingsAdmin(t.id);
    const cidrs = (n: number) => Array.from({ length: n }, (_, i) => `198.51.${i}.0/24`);
    const bad: [string, unknown][] = [
      ["6 alıcı", { ...validBody(), whatsapp: { enabled: true, recipients: [1, 2, 3, 4, 5, 6].map((i) => phone(500 + i)) } }],
      ["11 CIDR", { ...validBody(), trustedCidrs: cidrs(11) }],
      ["IPv4 /15", { ...validBody(), trustedCidrs: ["198.50.0.0/15"] }],
      ["IPv6 /31", { ...validBody(), trustedCidrs: ["2001:db8::/31"] }],
      ["özel aralık", { ...validBody(), trustedCidrs: ["10.1.0.0/16"] }],
      ["loopback", { ...validBody(), trustedCidrs: ["::1/128"] }],
      ["yinelenen alıcı", { ...validBody(), whatsapp: { enabled: true, recipients: ["0532 111 22 33", "+905321112233"] } }],
      ["bekleme 9", { ...validBody(), waitMinutes: 9 }],
      ["bekleme 121", { ...validBody(), waitMinutes: 121 }],
      ["alıcısız kanal", { ...validBody(), whatsapp: { enabled: true, recipients: [] } }],
      ["SMTP yokken e-posta", { ...validBody(), email: { enabled: true, recipients: ["a@example.test"] } }],
      ["bilinmeyen alan", { ...validBody(), extra: 1 }],
    ];
    for (const [name, body] of bad) {
      const r = await put(s, body);
      expect(r.statusCode, name).toBe(400);
      expect(errCode(r), name).toBe("VALIDATION");
    }
    // sınırda geçerli: 5 alıcı, 10 CIDR, /16 ve /32
    const edge = await put(s, {
      ...validBody(),
      waitMinutes: 120,
      trustedCidrs: [...cidrs(8), "198.18.0.0/16", "2001:db8::/32"].slice(0, 10),
      whatsapp: { enabled: true, recipients: [1, 2, 3, 4, 5].map((i) => phone(600 + i)) },
    });
    expect(edge.statusCode).toBe(200);
    expect(await testDb().auditLog.count({ where: { tenantId: t.id, action: "settings.support_requests.updated" } })).toBe(1);

    const viewer = await settingsAdmin(t.id, { "settings.view": true, "support_requests.view": true });
    expect((await put(viewer, validBody())).statusCode).toBe(403);
    expect((await live?.app.inject({ method: "GET", url: S, headers: viewer.headers }))?.statusCode).toBe(403);
    expect((await live?.app.inject({ method: "POST", url: `${S}/rotate-ref`, headers: viewer.headers, payload: {} }))?.statusCode).toBe(
      403,
    );
  });

  it("AC-131: rotate-ref — eski ref anında 404 (bilinmeyen ref ile aynı gövde), yeni ref çalışır, bekleyen talep etkilenmez, audit yalnız ilk 4 karakter", async () => {
    if (!live) throw new Error("live yok");
    const app = live.app;
    const t = await createTenant();
    const s = await settingsAdmin(t.id);
    const before = (await app.inject({ method: "GET", url: S, headers: s.headers })).json<{
      downloadUrl: string;
      refPrefix: string;
      refRotatedAt: string | null;
    }>();
    const oldRef = refOf(before.downloadUrl);
    expect(oldRef).toHaveLength(16);
    expect(before.refRotatedAt).toBeNull();
    const pending = await createRequestRow(t.id);
    const info = (ref: string) =>
      app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, headers: { "x-forwarded-for": "198.51.100.90" } });
    expect((await info(oldRef)).statusCode).toBe(200);

    const rot = await app.inject({ method: "POST", url: `${S}/rotate-ref`, headers: s.headers, payload: {} });
    expect(rot.statusCode).toBe(200);
    const after = rot.json<{ downloadUrl: string; refPrefix: string; refRotatedAt: string | null; fileName: string }>();
    const newRef = refOf(after.downloadUrl);
    expect(newRef).not.toBe(oldRef);
    expect(after.refRotatedAt).not.toBeNull();
    expect(after.fileName).toMatch(new RegExp(`^NoktaDestek-[A-Za-z0-9]{1,20}-${newRef}\\.exe$`));

    const stale = await info(oldRef);
    const unknown = await info("abcdefghijklmnop");
    expect(stale.statusCode).toBe(404);
    const strip = (b: string) => b.replace(/"requestId":"[0-9A-Z]{26}"/, "");
    expect(strip(stale.body)).toBe(strip(unknown.body));
    const dl = await app.inject({
      method: "GET",
      url: `/api/v1/public/agent/request-download?ref=${oldRef}`,
      headers: { "x-forwarded-for": "198.51.100.91" },
    });
    expect(dl.statusCode).toBe(404);
    expect((await info(newRef)).statusCode).toBe(200);
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");

    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "settings.support_requests.ref_rotated" } });
    expect(a).toMatchObject({
      result: "success",
      oldValue: { refPrefix: oldRef.slice(0, 4) },
      newValue: { refPrefix: newRef.slice(0, 4) },
    });
    expect(asText(a)).not.toContain(oldRef);
    expect(asText(a)).not.toContain(newRef);
  });

  it("AC-152: WhatsApp test ucu — /test-send tek deneme + maskeli audit; servis hatası ok:false + fail audit; yetkisiz 403; tenant 5/dk → 429", async () => {
    if (!live) throw new Error("live yok");
    const app = live.app;
    const t = await createTenant();
    const s = await settingsAdmin(t.id);
    const test = (sess: Session, payload: object = { phone: "0532 111 22 33" }) =>
      app.inject({ method: "POST", url: `${S}/whatsapp/test`, headers: sess.headers, payload });
    const ok = await test(s);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, message: "Test mesajı gönderildi." });
    expect(fake.hits).toEqual([{ path: "/test-send", body: { phoneNumber: "905321112233" } }]);

    fake.plan = () => 503;
    const failed = await test(s);
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({ ok: false });
    expect(fake.hits).toHaveLength(2); // tek deneme, yeniden deneme yok

    const audits = await testDb().auditLog.findMany({
      where: { tenantId: t.id, action: "settings.whatsapp.test" },
      orderBy: { id: "asc" },
    });
    expect(audits.map((a) => [a.result, a.newValue])).toEqual([
      ["success", { recipient: "+90******2233", result: "success" }],
      ["fail", { recipient: "+90******2233", result: "fail" }],
    ]);

    expect((await test(s, { phone: "123" })).statusCode).toBe(400);
    const viewer = await settingsAdmin(t.id, { "settings.view": true });
    expect((await test(viewer)).statusCode).toBe(403);

    fake.plan = () => 200;
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await test(s)).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]); // önceki 2 + 3 = 5; 6. → 429
    expect(fake.hits).toHaveLength(5);
  });
});

describe("P8b-1 WhatsApp fail-closed (production)", () => {
  it("AC-152 / §13.5: production + http + genel adres → ayarlarda insecure=true, test ucu 502 UPSTREAM, servise istek yok", async () => {
    live = await startLive({
      env: {
        ...PROXY,
        NODE_ENV: "production",
        DEPLOY_ENV: "production",
        SESSION_REF_KEY: "k".repeat(40),
        APP_ENCRYPTION_KEYS: FAKE_APP_ENCRYPTION_KEYS,
        WHATSAPP_SERVICE_URL: "http://203.0.113.10:3000",
      },
    });
    const t = await createTenant();
    await testDb().tenantSettings.update({ where: { tenantId: t.id }, data: { requireTech2fa: false } }); // prod'da 2FA kurulum kapısı açık (B-P10-3)
    const s = await settingsAdmin(t.id);
    const g = await live.app.inject({ method: "GET", url: S, headers: s.headers });
    expect(g.statusCode).toBe(200);
    expect(g.json<{ whatsapp: { insecure: boolean } }>().whatsapp.insecure).toBe(true);
    const r = await live.app.inject({
      method: "POST",
      url: `${S}/whatsapp/test`,
      headers: s.headers,
      payload: { phone: "0532 111 22 33" },
    });
    expect(r.statusCode).toBe(502);
    expect(errCode(r)).toBe("UPSTREAM");
    expect(r.json<{ error: { message: string } }>().error.message).toBe("Servis güvenli yapılandırılmamış.");
  });
});
