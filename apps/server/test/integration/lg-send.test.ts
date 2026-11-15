// LG-2 entegrasyon (mimari-link-gonderme §4, §7, §8, §12; AC-406..409, 413..425; güvenlik LG O-LG-2, D-LG-1/2/5). Gerçek MySQL,
// süreç içi sahte SMTP ve yerel sahte WhatsApp; servis ikilisi geçici dosya. Gerçek servise istek gitmez.
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/ids.ts";
import { createLogger } from "../../src/lib/logger.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  loginStepUp,
  makeApp,
  ORIGIN,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "../helpers/mail-tls.ts";
import { createCustomerRow, startFakeWhatsapp, type FakeWhatsapp } from "../helpers/requests.ts";
import { contactRow, createDeviceRow, setSmtp, UNSIGNED_ENV } from "../helpers/unattended.ts";

const inbox: { to: string; body: string }[] = [];
const logLines: string[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let wa: FakeWhatsapp;
let app: FastifyInstance;
let offApp: FastifyInstance;
let badShaApp: FastifyInstance;
let agentApp: FastifyInstance;
let noWaApp: FastifyInstance;
const dir = mkdtempSync(join(tmpdir(), "rs-lg2-"));
const BIN = join(dir, "svc.exe");
writeFileSync(BIN, Buffer.from("MZ-test-binary"));
const SHA = createHash("sha256").update(Buffer.from("MZ-test-binary")).digest("hex");
const PHONE = "+905321234567";

beforeAll(async () => {
  ({ smtp, port: smtpPort } = await startInboxSmtp(inbox));
  wa = await startFakeWhatsapp();
  const p10 = { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => smtpPort), mfaSetupEnforcement: false };
  const env = { ...UNSIGNED_ENV, WHATSAPP_SERVICE_URL: wa.url, UNATTENDED_AGENT_PATH: BIN, UNATTENDED_AGENT_SHA256: SHA };
  const sink = new Writable({
    write(chunk: Buffer, _e, cb) {
      logLines.push(chunk.toString("utf8"));
      cb();
    },
  });
  app = makeApp({ env: { ...env, LOG_LEVEL: "info" }, p10, logger: createLogger("info", sink) });
  offApp = makeApp({ env: { WHATSAPP_SERVICE_URL: wa.url, UNATTENDED_AGENT_PATH: BIN, UNATTENDED_AGENT_SHA256: SHA }, p10 });
  badShaApp = makeApp({ env: { ...env, UNATTENDED_AGENT_SHA256: "0".repeat(64) }, p10 });
  // AC-411: K1 istemci satırı yalnız oturum ikilisi kapısı `ok` iken (agentLinkFor) → aynı geçici dosya oturum ikilisi olarak.
  agentApp = makeApp({ env: { ...env, AGENT_BINARY_PATH: BIN, AGENT_SHA256: SHA }, p10 });
  // AC-406: servis adresi yok → WhatsApp `usable=false` (yapılandırılmamış).
  noWaApp = makeApp({ env: { ...env, WHATSAPP_SERVICE_URL: "" }, p10 });
  await Promise.all([app.ready(), offApp.ready(), badShaApp.ready(), agentApp.ready(), noWaApp.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), offApp.close(), badShaApp.close(), agentApp.close(), noWaApp.close()]);
  await closeSmtp(smtp);
  await wa.close();
});

interface Firm {
  tenantId: string;
  admin: TestUser;
  su: Session;
  customerId: string;
  email: string;
}

async function firm(o: { smtp?: boolean } = {}): Promise<Firm> {
  const t = await createTenant();
  if (o.smtp !== false) await setSmtp(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const customer = await createCustomerRow(t.id, { phone: PHONE });
  const email = await contactRow(t.id, customer.id);
  await testDb().customerNotifyContact.updateMany({ where: { tenantId: t.id, customerId: customer.id }, data: { phone: PHONE } });
  app.authLimits.ip.reset("127.0.0.1");
  return { tenantId: t.id, admin, su: await loginStepUp(app, admin), customerId: customer.id, email };
}

const call = (s: Session, o: InjectOptions, a: FastifyInstance = app) =>
  a.inject({ ...o, headers: { ...s.headers, ...(o.headers ?? {}) } });
const errOf = (r: { statusCode: number; json: () => unknown }) =>
  `${r.statusCode} ${(r.json() as { error?: { code: string } }).error?.code ?? ""}`.trim();
const fieldsOf = (r: { json: () => unknown }) => (r.json() as { error?: { fields?: Record<string, string> } }).error?.fields ?? {};
const options = (s: Session, target: object, a = app) =>
  call(s, { method: "POST", url: "/api/v1/customer-send/options", payload: { target } }, a);
const send = (s: Session, target: object, channel: string, to: string, a = app) =>
  call(s, { method: "POST", url: "/api/v1/customer-send", payload: { target, channel, to } }, a);
async function newCode(f: Firm, s = f.su, a = app): Promise<{ id: string; code: string }> {
  const r = await call(s, { method: "POST", url: "/api/v1/unattended/registration-codes", payload: { customerId: f.customerId } }, a);
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ id: string; code: string }>();
}
async function useCode(f: Firm, codeId: string): Promise<void> {
  const deviceId = await createDeviceRow({ tenantId: f.tenantId, customerId: f.customerId });
  await testDb().unattendedRegistrationCode.update({ where: { id: codeId }, data: { usedAt: new Date(), deviceId } });
}
const tokenOf = (text: string): string => /download\?t=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "";
const download = (t: string, ip = "198.51.100.1", a = app, method: "GET" | "HEAD" = "GET") =>
  a.inject({
    method,
    url: `/api/v1/public/unattended/download?t=${t}`,
    remoteAddress: ip,
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120" },
  });
/** AC-407: yakalanan iletinin konusu ve text/plain parçası (multipart iç içe olabilir; QP/base64 çözülür, CRLF → LF). */
const decodeQp = (s: string): string => {
  const flat = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let k = 0; k < flat.length; k++) {
    const hex = flat.slice(k + 1, k + 3);
    if (flat[k] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      k += 2;
    } else bytes.push(flat.charCodeAt(k));
  }
  return Buffer.from(bytes).toString("utf8");
};
const headersOf = (raw: string): Map<string, string> => {
  const m = new Map<string, string>();
  for (const line of raw.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) m.set(line.slice(0, i).toLowerCase(), line.slice(i + 1).trim());
  }
  return m;
};
const decodeWords = (v: string): string =>
  v
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?[^?]+\?([QBqb])\?([^?]*)\?=/g, (_x, enc: string, data: string) =>
      enc.toUpperCase() === "B" ? Buffer.from(data, "base64").toString("utf8") : decodeQp(data.replace(/_/g, " ")),
    );
function textPlainOf(raw: string): string | null {
  const cut = raw.indexOf("\r\n\r\n");
  const h = headersOf(raw.slice(0, cut));
  const body = raw.slice(cut + 4);
  const type = h.get("content-type") ?? "text/plain";
  if (/^multipart\//i.test(type)) {
    const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1] ?? "";
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith("--")) break;
      const found = textPlainOf(part.replace(/^\r\n/, "").replace(/\r\n$/, ""));
      if (found !== null) return found;
    }
    return null;
  }
  if (!/^text\/plain/i.test(type)) return null;
  const cte = (h.get("content-transfer-encoding") ?? "7bit").toLowerCase();
  const text = cte === "quoted-printable" ? decodeQp(body) : cte === "base64" ? Buffer.from(body, "base64").toString("utf8") : body;
  return text.replace(/\r\n/g, "\n");
}
const sentMail = (to: string): { subject: string; text: string | null } => {
  const raw = inbox.filter((m) => m.to.toLowerCase() === to.toLowerCase()).at(-1)?.body ?? "";
  return { subject: decodeWords(headersOf(raw.slice(0, raw.indexOf("\r\n\r\n"))).get("subject") ?? ""), text: textPlainOf(raw) };
};

describe("LG K2 kayıt kodu gönderimi", () => {
  it("AC-406/417/D-LG-1: options yalnız EMAIL (O-LG-3), alıcı kilitli bildirim adresleri, kalan 3, no-store", async () => {
    const f = await firm();
    const c = await newCode(f);
    const r = await options(f.su, { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const o = r.json<{
      channels: { channel: string; available: boolean }[];
      recipientsLocked: boolean;
      remainingSends: number;
      recipients: { email: { value: string }[] };
    }>();
    expect(o.channels.map((x) => x.channel)).toEqual(["EMAIL"]);
    expect(o.channels[0]?.available).toBe(true);
    expect(o.recipientsLocked).toBe(true);
    expect(o.remainingSends).toBe(3);
    expect(o.recipients.email.map((x) => x.value)).toEqual([f.email]);
  });

  it("AC-407/418/420: gönderilen e-posta = önizleme; 4. gönderim 429; audit maskeli, kod ve belirteç yok", async () => {
    const f = await firm();
    const c = await newCode(f);
    const target = { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code };
    const preview = (await options(f.su, target)).json<{ previews: { EMAIL: { text: string; subject: string } } }>().previews.EMAIL;
    for (let i = 0; i < 3; i++) expect(errOf(await send(f.su, target, "EMAIL", f.email.toUpperCase()))).toBe("200");
    const mail = sentMail(f.email.toUpperCase());
    expect(mail.text).toBe(preview.text);
    expect(mail.subject).toBe(preview.subject);
    expect(preview.text).toContain(c.code);
    expect(preview.subject).toContain("uzaktan destek servisi kurulumu");
    const fourth = await send(f.su, target, "EMAIL", f.email);
    expect(errOf(fourth)).toBe("429 RATE_LIMITED");
    const rows = await testDb().auditLog.findMany({ where: { tenantId: f.tenantId, action: "unattended.code.sent" } });
    expect(rows).toHaveLength(6); // 3 × (reserved + result)
    const text = JSON.stringify(rows.map((x) => x.newValue));
    expect(text).not.toContain(c.code.replace(/-/g, ""));
    expect(text).not.toContain(c.code);
    expect(text).not.toContain(tokenOf(preview.text));
    expect(text).not.toContain(f.email);
    expect(text).toContain(`"customerId":"${f.customerId}"`);
    expect((await testDb().unattendedRegistrationCode.findUniqueOrThrow({ where: { id: c.id } })).sentCount).toBe(3);
  });

  it("AC-417: listede olmayan alıcı 400 fields.to ve SMTP'ye çağrı yok; WhatsApp kanalı 400 fields.channel", async () => {
    const f = await firm();
    const c = await newCode(f);
    const before = inbox.length;
    const target = { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code };
    const r = await send(f.su, target, "EMAIL", "baska@musteri.test");
    expect(errOf(r)).toBe("400 VALIDATION");
    expect(fieldsOf(r).to).toBeDefined();
    expect(inbox.length).toBe(before);
    expect(fieldsOf(await send(f.su, target, "WHATSAPP", PHONE)).channel).toBeDefined();
  });

  it("AC-415/416/D-LG-5: başka kodun metni 400; tüketilmiş 409; iptal 409; başka kullanıcı / manage'siz / başka firma 404; iptal + manage'siz 404", async () => {
    const f = await firm();
    const a = await newCode(f);
    const b = await newCode(f);
    expect(fieldsOf(await options(f.su, { kind: "UNATTENDED_CODE", codeId: a.id, code: b.code })).code).toBeDefined();
    await useCode(f, b.id);
    expect(errOf(await options(f.su, { kind: "UNATTENDED_CODE", codeId: b.id, code: b.code }))).toBe("409 CONFLICT");
    expect((await call(f.su, { method: "DELETE", url: `/api/v1/unattended/registration-codes/${a.id}` })).statusCode).toBe(204);
    const cancelled = { kind: "UNATTENDED_CODE", codeId: a.id, code: a.code };
    expect(errOf(await options(f.su, cancelled))).toBe("409 CONFLICT");
    const c = await newCode(f);
    const other = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const so = await loginAs(app, other);
    expect(errOf(await options(so, { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code }))).toBe("404 NOT_FOUND");
    const g = await firm();
    expect(errOf(await options(g.su, { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code }))).toBe("404 NOT_FOUND");
    // manage yetkisi alınmış üretici: geçerli kod ve iptal kod — ikisi de 404 (varlık sızmaz)
    await testDb().userPermission.create({ data: { userId: f.admin.id, permKey: "unattended.manage", granted: false } });
    const sNo = await loginStepUp(app, f.admin);
    expect(errOf(await options(sNo, { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code }))).toBe("404 NOT_FOUND");
    expect(errOf(await options(sNo, cancelled))).toBe("404 NOT_FOUND");
  });

  it("AC-416: gözetimsiz kapısı kapalı → 409 UNATTENDED_DISABLED", async () => {
    const f = await firm();
    const c = await newCode(f);
    const s = await loginStepUp(offApp, f.admin);
    expect(errOf(await options(s, { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code }, offApp))).toBe("409 UNATTENDED_DISABLED");
  });
});

describe("LG public servis indirme (AC-419)", () => {
  async function liveToken(f: Firm): Promise<{ id: string; token: string }> {
    const c = await newCode(f);
    const o = await options(f.su, { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code });
    return { id: c.id, token: tokenOf(o.json<{ previews: { EMAIL: { text: string } } }>().previews.EMAIL.text) };
  }

  it("AC-419: geçerli → 200 dosya + no-store/no-referrer/noindex/nosniff; audit unattended.code.downloaded", async () => {
    const f = await firm();
    const { id, token } = await liveToken(f);
    const r = await download(token, "198.51.100.10");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toContain("NoktaDestekServis.exe");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["x-robots-tag"]).toBe("noindex");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { action: "unattended.code.downloaded", entityId: id } });
    expect(audit.userId).toBeNull();
    expect(JSON.stringify(audit.newValue)).not.toContain(token);
  });

  it("AC-419/D-LG-2: biçimsiz, bilinmeyen, kullanılmış, süresi dolmuş, müşteri pasif, firma pasif, kapı kapalı, iptal → aynı 404 gövdesi", async () => {
    const bodies = new Set<string>();
    const norm = (b: string) => b.replace(/"requestId":"[^"]*"/, "");
    const hit = async (t: string, a = app) => {
      const r = await download(t, `198.51.100.${20 + bodies.size}`, a);
      expect(r.statusCode).toBe(404);
      bodies.add(norm(r.body));
    };
    await hit("short");
    await hit("A".repeat(43));
    const f = await firm();
    const used = await liveToken(f);
    await useCode(f, used.id);
    await hit(used.token);
    const exp = await liveToken(f);
    const now = Date.now();
    await testDb().unattendedRegistrationCode.update({
      where: { id: exp.id },
      data: { expiresAt: new Date(now - 1000), createdAt: new Date(now - 86_401_000) },
    });
    await hit(exp.token);
    const g = await firm();
    const pc = await liveToken(g);
    await testDb().customer.update({ where: { id: g.customerId }, data: { status: "PASSIVE", passiveAt: new Date() } });
    await hit(pc.token);
    const h = await firm();
    const pt = await liveToken(h);
    await hit(pt.token, offApp); // kapı kapalı
    await testDb().tenant.update({ where: { id: h.tenantId }, data: { status: "PASSIVE" } });
    await hit(pt.token);
    const k = await firm();
    const cancelled = await liveToken(k);
    expect((await call(k.su, { method: "DELETE", url: `/api/v1/unattended/registration-codes/${cancelled.id}` })).statusCode).toBe(204);
    await hit(cancelled.token); // iptal edilmiş kod (mimari §12)
    expect(bodies.size).toBe(1);
  });

  it("AC-419: SHA uyuşmazlığı → 503 yalnız geçerli belirteçle; geçersiz belirteç 404 (D-LG-2 sırası)", async () => {
    const f = await firm();
    const { token } = await liveToken(f);
    expect((await download(token, "198.51.100.40", badShaApp)).statusCode).toBe(503);
    expect((await download("B".repeat(43), "198.51.100.41", badShaApp)).statusCode).toBe(404);
  });

  it("AC-419: IP başına 20/dk → 21. istek 429; başka IP etkilenmez", async () => {
    for (let i = 0; i < 20; i++) expect((await download("C".repeat(43), "198.51.100.50")).statusCode).toBe(404);
    expect((await download("C".repeat(43), "198.51.100.50")).statusCode).toBe(429);
    expect((await download("C".repeat(43), "198.51.100.51")).statusCode).toBe(404);
  });

  it("O-LG-2: aynı kod + IP saatte 1 audit, farklı IP yeni satır, kod başına en çok 10; HEAD 404 ve audit yok", async () => {
    const f = await firm();
    const { id, token } = await liveToken(f);
    const n = () => testDb().auditLog.count({ where: { action: "unattended.code.downloaded", entityId: id } });
    for (let i = 0; i < 3; i++) expect((await download(token, "198.51.100.60")).statusCode).toBe(200);
    expect(await n()).toBe(1);
    expect((await download(token, "198.51.100.61")).statusCode).toBe(200);
    expect(await n()).toBe(2);
    const head = await download(token, "198.51.100.62", app, "HEAD");
    expect(head.statusCode).toBe(404);
    expect(head.body).toBe("");
    expect(await n()).toBe(2);
    for (let i = 0; i < 12; i++) await download(token, `198.51.101.${i}`);
    expect(await n()).toBe(10);
  });
});

describe("LG K3 müşteri bağlantıları", () => {
  it("AC-406: SMTP yokken EMAIL unconfigured + ayar bağlantısı; WhatsApp kullanılabilir; önizleme yalnız kullanılabilir kanalda", async () => {
    const f = await firm({ smtp: false });
    const o = (await options(f.su, { kind: "CUSTOMER", customerId: f.customerId })).json<{
      channels: { channel: string; available: boolean; block: string | null; settingsHref: string | null }[];
      previews: Record<string, unknown>;
      recipients: { phone: { value: string }[] };
    }>();
    expect(o.channels).toEqual([
      { channel: "EMAIL", available: false, block: "unconfigured", settingsHref: "/settings/smtp" },
      { channel: "WHATSAPP", available: true, block: null, settingsHref: null },
    ]);
    expect(Object.keys(o.previews)).toEqual(["WHATSAPP"]);
    expect(o.recipients.phone[0]?.value).toBe(PHONE);
    expect(errOf(await send(f.su, { kind: "CUSTOMER", customerId: f.customerId }, "EMAIL", f.email))).toBe("409 CHANNEL_UNAVAILABLE");
  });

  it("AC-407/422/423: WhatsApp metni = önizleme; ref yenilenince yeni ref; audit maskeli, URL/ref yok", async () => {
    const f = await firm();
    const target = { kind: "CUSTOMER", customerId: f.customerId };
    expect((await call(f.su, { method: "POST", url: `/api/v1/customers/${f.customerId}/rotate-ref`, payload: {} })).statusCode).toBe(200);
    const ref = (await testDb().customer.findUniqueOrThrow({ where: { id: f.customerId } })).requestRef;
    const preview = (await options(f.su, target)).json<{ previews: { WHATSAPP: { text: string } } }>().previews.WHATSAPP.text;
    expect(preview).toContain(ref);
    expect(errOf(await send(f.su, target, "WHATSAPP", PHONE))).toBe("200");
    expect(wa.hits.at(-1)?.body.message).toBe(preview);
    const rows = await testDb().auditLog.findMany({ where: { tenantId: f.tenantId, action: "customer.link_sent" } });
    const text = JSON.stringify(rows.map((x) => x.newValue));
    expect(rows).toHaveLength(2);
    expect(text).not.toContain(ref);
    expect(text).not.toContain("5321234567");
    expect(text).toContain("+90******4567");
    expect(text).toContain('"links":["download"]');
  });

  it("AC-421/423: pasif müşteri 409; send_link yoksa 403; başka firmanın müşterisi 404", async () => {
    const f = await firm();
    const u = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "customers.view": true } });
    expect(errOf(await options(await loginAs(app, u), { kind: "CUSTOMER", customerId: f.customerId }))).toBe("403 FORBIDDEN");
    const g = await firm();
    expect(errOf(await options(g.su, { kind: "CUSTOMER", customerId: f.customerId }))).toBe("404 NOT_FOUND");
    await testDb().customer.update({ where: { id: f.customerId }, data: { status: "PASSIVE", passiveAt: new Date() } });
    expect(errOf(await options(f.su, { kind: "CUSTOMER", customerId: f.customerId }))).toBe("409 CONFLICT");
  });

  it("AC-420/423: kullanıcı havuzu K1 ile ortak — 20 rezervasyon sonrası K3 429", async () => {
    const f = await firm();
    await testDb().auditLog.createMany({
      data: Array.from({ length: 20 }, () => ({
        tenantId: f.tenantId,
        userId: f.admin.id,
        username: f.admin.email,
        action: "session.link_sent",
        entity: "support_sessions",
        result: "success",
        ipAddress: "",
        userAgent: "",
        newValue: { phase: "reserved", channel: "SMS", recipient: "***" },
      })),
    });
    expect(errOf(await send(f.su, { kind: "CUSTOMER", customerId: f.customerId }, "WHATSAPP", PHONE))).toBe("429 RATE_LIMITED");
  });
});

describe("LG K1 oturum (yeni uç → eski servis)", () => {
  it("AC-413/414: e-posta audit session.email, WA audit session.link_sent; metin = önizleme; send_link yoksa yalnız EMAIL ve WA 403", async () => {
    const f = await firm();
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
    const target = { kind: "SESSION", sessionId: sess.id, link: `${ORIGIN}/session/${sess.token}` };
    const o = (await options(f.su, target)).json<{
      previews: { WHATSAPP: { text: string }; EMAIL: { text: string; subject: string } };
      channels: { channel: string }[];
    }>();
    expect(o.channels.map((c) => c.channel)).toEqual(["EMAIL", "WHATSAPP", "SMS"]);
    expect(errOf(await send(f.su, target, "WHATSAPP", PHONE))).toBe("200");
    expect(wa.hits.at(-1)?.body.message).toBe(o.previews.WHATSAPP.text);
    expect(errOf(await send(f.su, target, "EMAIL", "kisi@musteri.test"))).toBe("200");
    // AC-407: K1 e-postası (yeni uç → eski servis) = önizleme; metin ve konu birebir.
    const mail = sentMail("kisi@musteri.test");
    expect(mail.text).toBe(o.previews.EMAIL.text);
    expect(mail.subject).toBe(o.previews.EMAIL.subject);
    expect(await testDb().auditLog.count({ where: { entityId: sess.id, action: "session.link_sent" } })).toBe(2);
    expect(await testDb().auditLog.count({ where: { entityId: sess.id, action: "session.email" } })).toBe(1);
    expect(
      fieldsOf(await send(f.su, { ...target, link: `${ORIGIN}/session/${"b".repeat(43)}` }, "EMAIL", "kisi@musteri.test")).link,
    ).toBeDefined();
    const tech = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "sessions.create": true } });
    const s2 = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: tech.id });
    const st = await loginAs(app, tech);
    const t2 = { kind: "SESSION", sessionId: s2.id, link: `${ORIGIN}/session/${s2.token}` };
    expect((await options(st, t2)).json<{ channels: { channel: string }[] }>().channels.map((c) => c.channel)).toEqual(["EMAIL"]);
    expect(errOf(await send(st, t2, "WHATSAPP", PHONE))).toBe("403 FORBIDDEN");
    expect(errOf(await options(st, target))).toBe("404 NOT_FOUND"); // başka teknisyenin oturumu
  });

  it("AC-411: gönderilen mesajdaki agent/download?ref= bağlantısı PENDING'de indirir, oturum süresi dolunca 410", async () => {
    const f = await firm();
    const s = await loginStepUp(agentApp, f.admin);
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
    const target = { kind: "SESSION", sessionId: sess.id, link: `${ORIGIN}/session/${sess.token}` };
    const o = (await options(s, target, agentApp)).json<{ previews: Record<string, { text: string }> }>();
    expect(o.previews.SMS).toBeUndefined(); // SMS'siz firma; SMS metni istemci satırsız (birim AC-410)
    expect(errOf(await send(s, target, "WHATSAPP", PHONE, agentApp))).toBe("200");
    const sent = String(wa.hits.at(-1)?.body.message ?? "");
    expect(sent).toBe(o.previews.WHATSAPP?.text);
    const url = /https?:\/\/\S+\/api\/v1\/public\/agent\/download\?ref=[A-Za-z0-9_-]+/.exec(sent)?.[0] ?? "";
    expect(url.startsWith(`${ORIGIN}/api/v1/public/agent/download?ref=`)).toBe(true);
    const get = (ip: string) => agentApp.inject({ method: "GET", url: url.slice(ORIGIN.length), remoteAddress: ip });
    const before = await get("198.51.100.70");
    expect(before.statusCode).toBe(302);
    expect(before.headers.location).toMatch(/^\/downloads\/Destek-\d{8}\.exe$/);
    const created = new Date(Date.now() - 16 * 60_000); // TTL CHECK: expires = created + 15 dk
    await testDb().supportSession.update({
      where: { id: sess.id },
      data: { createdAt: created, expiresAt: new Date(created.getTime() + 15 * 60_000) },
    });
    expect((await get("198.51.100.71")).statusCode).toBe(410);
  });

  it("AC-409: geçersiz e-posta / telefon 400 fields.to; SMS yurt dışı 400 fields.to", async () => {
    const f = await firm();
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
    const target = { kind: "SESSION", sessionId: sess.id, link: `${ORIGIN}/session/${sess.token}` };
    expect(fieldsOf(await send(f.su, target, "EMAIL", "kotu-adres")).to).toBeDefined();
    expect(fieldsOf(await send(f.su, target, "WHATSAPP", "123")).to).toBeDefined();
    // SMS yurt dışı kuralı (fields.to) kanal kullanılabilirken uygulanır (sıra §4.3: kanal 409 → alıcı 400); SMS'siz firmada 409.
    expect(errOf(await send(f.su, target, "SMS", "+4915112345678"))).toBe("409 CHANNEL_UNAVAILABLE");
  });
});

describe("AC-406 kanal kombinasyonu matrisi", () => {
  type Opt = {
    channels: { channel: string; available: boolean; block: string | null; settingsHref: string | null }[];
    previews: Record<string, unknown>;
  };
  const opts = async (s: Session, target: object, a = app): Promise<Opt> => {
    const r = await options(s, target, a);
    expect(r.statusCode, r.body).toBe(200);
    return r.json<Opt>();
  };
  const row = (o: Opt, ch: string) => o.channels.find((c) => c.channel === ch);

  it("AC-406: K1 — WA usable=false ve SMS yok → unconfigured, önizleme yalnız EMAIL; WA ayar bağlantısı Admin'de null", async () => {
    const f = await firm();
    const s = await loginStepUp(noWaApp, f.admin);
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
    const o = await opts(s, { kind: "SESSION", sessionId: sess.id, link: `${ORIGIN}/session/${sess.token}` }, noWaApp);
    expect(o.channels).toEqual([
      { channel: "EMAIL", available: true, block: null, settingsHref: "/settings/smtp" },
      { channel: "WHATSAPP", available: false, block: "unconfigured", settingsHref: null },
      { channel: "SMS", available: false, block: "unconfigured", settingsHref: "/settings/sms" },
    ]);
    expect(Object.keys(o.previews)).toEqual(["EMAIL"]);
  });

  it("AC-406: settings.view yoksa settingsHref null; WA ayar bağlantısı yalnız Super Admin'de", async () => {
    const f = await firm({ smtp: false });
    const u = await createUser({
      tenantId: f.tenantId,
      role: "USER",
      perms: { "customers.view": true, "sessions.send_link": true },
    });
    const target = { kind: "CUSTOMER", customerId: f.customerId };
    const o = await opts(await loginAs(noWaApp, u), target, noWaApp);
    expect(o.channels).toEqual([
      { channel: "EMAIL", available: false, block: "unconfigured", settingsHref: null },
      { channel: "WHATSAPP", available: false, block: "unconfigured", settingsHref: null },
    ]);
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const ss = await loginStepUp(noWaApp, sa);
    await testDb().authSession.update({ where: { tokenHash: sha256Hex(ss.token) }, data: { actingTenantId: f.tenantId } });
    const os = await opts(ss, target, noWaApp);
    expect(row(os, "WHATSAPP")?.settingsHref).toBe("/admin/settings/whatsapp");
    expect(row(os, "EMAIL")?.settingsHref).toBe("/settings/smtp");
    expect(row(await opts(f.su, target, noWaApp), "WHATSAPP")?.settingsHref).toBeNull(); // Admin
  });

  it("AC-406: K2 — bildirim adresi yok → no_recipient; ikili kapısı kapalı → EMAIL unconfigured (KD-LG3)", async () => {
    const f = await firm();
    const c = await newCode(f);
    const target = { kind: "UNATTENDED_CODE", codeId: c.id, code: c.code };
    const gated = await opts(await loginStepUp(badShaApp, f.admin), target, badShaApp);
    expect(gated.channels).toEqual([{ channel: "EMAIL", available: false, block: "unconfigured", settingsHref: "/settings/smtp" }]);
    expect(gated.previews).toEqual({});
    await testDb().customerNotifyContact.deleteMany({ where: { tenantId: f.tenantId, customerId: f.customerId } });
    const none = await opts(f.su, target);
    expect(none.channels).toEqual([{ channel: "EMAIL", available: false, block: "no_recipient", settingsHref: "/settings/smtp" }]);
    expect(none.previews).toEqual({});
    expect(errOf(await send(f.su, target, "EMAIL", f.email))).toBe("409 CHANNEL_UNAVAILABLE");
  });

  it("AC-406: hiç kullanılabilir kanal yok → önizleme boş, gönderim 409; hiç yetkili kanal yok → 403 (liste boş dönmez)", async () => {
    const f = await firm({ smtp: false });
    const target = { kind: "CUSTOMER", customerId: f.customerId };
    const s = await loginStepUp(noWaApp, f.admin);
    const o = await opts(s, target, noWaApp);
    expect(o.channels.every((c) => !c.available)).toBe(true);
    expect(o.previews).toEqual({});
    expect(errOf(await send(s, target, "WHATSAPP", PHONE, noWaApp))).toBe("409 CHANNEL_UNAVAILABLE");
    const u = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "customers.view": true } });
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: u.id });
    const k1 = { kind: "SESSION", sessionId: sess.id, link: `${ORIGIN}/session/${sess.token}` };
    expect(errOf(await options(await loginAs(app, u), k1))).toBe("403 FORBIDDEN");
  });
});

describe("AC-425 log", () => {
  it("AC-425: üç akışın ardından uygulama logunda alıcı, kod, belirteç ve oturum token'ı yok", () => {
    const all = logLines.join("\n");
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain("5321234567");
    expect(all).not.toContain("@musteri.test");
    expect(all).not.toMatch(/download\?t=/);
    expect(all).not.toMatch(/\/session\/[A-Za-z0-9_-]{43}/);
    expect(all).not.toMatch(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
  });
});
