// P22-B2 — oturum geçmişinde sohbet REST ucu, geçmiş özeti, chatRetentionDays, aydınlatma metni yeni sistem sürümü,
// anonimleştirme partisinin mesaj bütçesi (mimari-p22 §3.3, §3.4, §5, r2 §15.3, §15.6 S-P22-11; AC-264, AC-255, AC-291,
// AC-292, AC-127). Gerçek MySQL: app (TEST_DATABASE_URL) + migrator fikstürü (TEST_MIGRATE_DATABASE_URL).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionChatResponse, SessionHistoryDetail } from "@remote/contracts/api/sessions";
import type { ConsentTextSettings } from "@remote/contracts/api/system-settings";
import { CHAT_AUDIT } from "@remote/contracts/audit";
import { CHAT_CONSENT_KEY_SENTENCE, CHAT_CONSENT_PARAGRAPH } from "@remote/contracts/chat";
import { seedTenantConsent } from "../../prisma/seed-consent.ts";
import { anonymizeSessionBatch, trimByMessageBudget } from "../../src/jobs/retention-repo.ts";
import { aadFor } from "../../src/lib/crypto.ts";
import { newId } from "../../src/lib/ids.ts";
import { acceptConsent, defaultConsentBody } from "../../src/public/consent.ts";
import { chatParagraphMissing } from "../../src/settings/consent.ts";
import {
  ORIGIN,
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  makeApp,
  testDb,
  testFixtureDb,
  type Session,
} from "../helpers/app.ts";
import { createRequestRow, createRequestSettings } from "../helpers/requests.ts";

const DAY = 86_400_000;
const ADMIN_TEXT = "Firmamızın kendi aydınlatma metnidir. Verileriniz KVKK kapsamında işlenir ve saklama süresi sonunda anonimleştirilir.";
let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(async () => {
  await app?.close();
});

let ipSeq = 0;
const nextIp = (): string => `192.0.2.${(++ipSeq % 250) + 1}`;

/** Oturum sohbeti satırı (gerçek şifreleme, AAD üst bağı oturum). `badAad` → çözülemez satır. */
async function addSessionMessages(
  tenantId: string,
  sessionId: string,
  msgs: { sender: "TECH" | "CUSTOMER"; userId?: string; body: string; badAad?: boolean }[],
  base = Date.now() - 60_000,
): Promise<string[]> {
  const ids: string[] = [];
  const data = msgs.map((m, i) => {
    const id = newId();
    ids.push(id);
    const parent = m.badAad ? newId() : sessionId;
    return {
      id,
      tenantId,
      sessionId,
      sender: m.sender,
      senderUserId: m.sender === "TECH" ? (m.userId ?? null) : null,
      clientMsgId: `cm-${id}`,
      bodyEnc: app.secrets.encrypt(m.body, aadFor.sessionMessage(tenantId, parent, id)),
      bodyChars: [...m.body].length,
      createdAt: new Date(base + i),
    };
  });
  await testFixtureDb().sessionMessage.createMany({ data });
  return ids;
}

/** Hızlı toplu satır (gövde içeriği önemsiz; bütçe testleri). */
async function addBulk(tenantId: string, sessionId: string, n: number): Promise<void> {
  for (let off = 0; off < n; off += 5000) {
    const data = Array.from({ length: Math.min(5000, n - off) }, () => {
      const id = newId();
      return {
        id,
        tenantId,
        sessionId,
        sender: "CUSTOMER",
        senderUserId: null,
        clientMsgId: `b-${id}`,
        bodyEnc: new Uint8Array(31),
        bodyChars: 2,
      };
    });
    await testFixtureDb().sessionMessage.createMany({ data });
  }
}

const chatUrl = (id: string, q = ""): string => `/api/v1/sessions/${id}/chat${q}`;
const get = (s: Session, url: string) => app.inject({ method: "GET", url, headers: s.headers });
const viewedAudits = (sessionId: string) =>
  testDb().auditLog.findMany({ where: { entityId: sessionId, action: CHAT_AUDIT.VIEWED }, select: { newValue: true, userId: true } });

async function firm() {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const s = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id, status: "ENDED" });
  return { t, admin, s, as: await loginAs(app, admin) };
}

describe("AC-264 GET /sessions/:id/chat — yetki, IDOR, historyScope", () => {
  it("AC-264 T-P22-10: view_chat yok → 403; history detayında `chat` alanı yok", async () => {
    const { t, admin, s } = await firm();
    const u = await createUser({ tenantId: t.id, role: "USER", perms: { "session_history.view": true } });
    const own = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED" });
    await addSessionMessages(t.id, own.id, [{ sender: "CUSTOMER", body: "merhaba" }]);
    const us = await loginAs(app, u);
    expect((await get(us, chatUrl(own.id))).statusCode).toBe(403);
    const h = await get(us, `/api/v1/sessions/${own.id}/history`);
    expect(h.statusCode, h.body).toBe(200);
    expect(h.json<SessionHistoryDetail>()).not.toHaveProperty("chat");
    expect(admin.id).not.toBe(u.id);
    expect(s.id).not.toBe(own.id);
  });

  it("AC-264 K-P22-4: yetkili USER yalnız kendi oturumu (başkasının → 404); başka tenant ADMIN → 404", async () => {
    const { t, s } = await firm();
    const u = await createUser({ tenantId: t.id, role: "USER", perms: { "session_history.view": true, "sessions.view_chat": true } });
    const own = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED" });
    const us = await loginAs(app, u);
    expect((await get(us, chatUrl(own.id))).statusCode).toBe(200);
    expect((await get(us, chatUrl(s.id))).statusCode).toBe(404);
    const other = await firm();
    expect((await get(other.as, chatUrl(s.id))).statusCode).toBe(404);
    expect((await get(other.as, chatUrl("not-a-ulid"))).statusCode).toBe(404);
  });

  it("AC-264: çözülmüş gövdeler artan sırada; TECH adı, senderUserId dışarı verilmez; çözülemeyen → body null", async () => {
    const { t, admin, s, as } = await firm();
    await addSessionMessages(t.id, s.id, [
      { sender: "CUSTOMER", body: "Yazıcı çalışmıyor" },
      { sender: "TECH", userId: admin.id, body: "<img src=x onerror=alert(1)>" },
      { sender: "CUSTOMER", body: "bozuk", badAad: true },
    ]);
    const r = await get(as, chatUrl(s.id));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const body = r.json<SessionChatResponse>();
    expect(body.request).toBeNull();
    expect(body.session.more).toBe(false);
    expect(body.session.items.map((i) => [i.sender, i.body, i.senderName])).toEqual([
      ["CUSTOMER", "Yazıcı çalışmıyor", null],
      ["TECH", "<img src=x onerror=alert(1)>", "Test Kullanıcı"],
      ["CUSTOMER", null, null],
    ]);
    for (const i of body.session.items) expect(Object.keys(i).sort()).toEqual(["body", "createdAt", "id", "sender", "senderName"]);
  });

  it("AC-264 §5.3: ilk çağrı session.chat_viewed (sayılar, gövde yok); 10 dk içinde ikinci yok; after çağrısı audit'siz, request null", async () => {
    const { t, admin, s, as } = await firm();
    const ids = await addSessionMessages(t.id, s.id, [
      { sender: "CUSTOMER", body: "gizli-1" },
      { sender: "TECH", userId: admin.id, body: "gizli-2" },
    ]);
    expect((await get(as, chatUrl(s.id))).statusCode).toBe(200);
    expect((await get(as, chatUrl(s.id))).statusCode).toBe(200);
    const after = await get(as, chatUrl(s.id, `?after=${ids[0]}`));
    expect(after.statusCode).toBe(200);
    const a = after.json<SessionChatResponse>();
    expect(a.request).toBeNull();
    expect(a.session.items.map((i) => i.id)).toEqual([ids[1]]);
    const audits = await viewedAudits(s.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: admin.id, newValue: { messages: 2, requestMessages: 0 } });
    expect(JSON.stringify(audits[0])).not.toContain("gizli");
  });

  it("S-P22-11: başka oturumun mesaj id'si `after` olarak yok sayılır; biçimsiz `after` / ek alan → 400", async () => {
    const { t, s, as } = await firm();
    const other = await createSupportSessionRow({
      tenantId: t.id,
      technicianId: (await createUser({ tenantId: t.id })).id,
      status: "ENDED",
    });
    const [foreign] = await addSessionMessages(t.id, other.id, [{ sender: "CUSTOMER", body: "öteki" }]);
    await addSessionMessages(t.id, s.id, [{ sender: "CUSTOMER", body: "bu" }]);
    const r = await get(as, chatUrl(s.id, `?after=${foreign}`));
    expect(r.json<SessionChatResponse>().session.items.map((i) => i.body)).toEqual(["bu"]);
    expect((await get(as, chatUrl(s.id, "?after=xyz"))).statusCode).toBe(400);
    expect((await get(as, chatUrl(s.id, "?foo=1"))).statusCode).toBe(400);
  });

  it("AC-264 büyük sayfa: 201 mesaj → 200 öğe + more; son öğeden sonra kalan 1", async () => {
    const { t, s, as } = await firm();
    const ids = await addSessionMessages(
      t.id,
      s.id,
      Array.from({ length: 201 }, (_, i) => ({ sender: "CUSTOMER" as const, body: `m${i}` })),
    );
    const first = (await get(as, chatUrl(s.id))).json<SessionChatResponse>();
    expect(first.session.items).toHaveLength(200);
    expect(first.session.more).toBe(true);
    const rest = (await get(as, chatUrl(s.id, `?after=${first.session.items.at(-1)?.id}`))).json<SessionChatResponse>();
    expect(rest.session.items.map((i) => i.id)).toEqual([ids[200]]);
    expect(rest.session.more).toBe(false);
  });

  it("AC-264 boş liste: mesajsız oturum → items [], more false", async () => {
    const { s, as } = await firm();
    const r = (await get(as, chatUrl(s.id))).json<SessionChatResponse>();
    expect(r).toEqual({ request: null, session: { items: [], more: false } });
  });

  it("AC-264: 60/dk/kullanıcı — 61. istek 429", async () => {
    const { s, as } = await firm();
    for (let i = 0; i < 60; i++) expect((await get(as, chatUrl(s.id, `?after=${newId()}`))).statusCode).toBe(200);
    expect((await get(as, chatUrl(s.id, `?after=${newId()}`))).statusCode).toBe(429);
  });
});

describe("AC-255 (K-P18-2): bağlı talebin kabul öncesi yazışması", () => {
  async function linked() {
    const f = await firm();
    await createRequestSettings(f.t.id);
    const req = await createRequestRow(f.t.id);
    // ttl_chk: talep oturumu 60 sn TTL'li.
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: f.s.id }, select: { createdAt: true } });
    await testDb().supportSession.update({
      where: { id: f.s.id },
      data: { requestId: req.id, expiresAt: new Date(row.createdAt.getTime() + 60_000) },
    });
    const rid = newId();
    await testFixtureDb().sessionMessage.create({
      data: {
        id: rid,
        tenantId: f.t.id,
        requestId: req.id,
        sender: "CUSTOMER",
        clientMsgId: "r-1",
        bodyEnc: app.secrets.encrypt("talep yazışması", aadFor.sessionMessage(f.t.id, req.id, rid)),
        bodyChars: 15,
      },
    });
    await addSessionMessages(f.t.id, f.s.id, [{ sender: "CUSTOMER", body: "oturum yazışması" }]);
    return { ...f, req };
  }

  it("AC-255: talepten doğan oturumda kabul öncesi mesajlar request.items içinde (AAD talep id'si), audit requestMessages", async () => {
    const { s, as } = await linked();
    const r = (await get(as, chatUrl(s.id))).json<SessionChatResponse>();
    expect(r.request).toMatchObject({ total: 1, items: [{ sender: "CUSTOMER", body: "talep yazışması" }] });
    expect(r.session.items.map((i) => i.body)).toEqual(["oturum yazışması"]);
    expect((await viewedAudits(s.id))[0]?.newValue).toEqual({ messages: 1, requestMessages: 1 });
  });

  it("S-P22-11: anonim talep → request null", async () => {
    const { s, req, as } = await linked();
    await testDb().$executeRaw`UPDATE support_requests
      SET customer_name = NULL, customer_phone = NULL, customer_email = NULL, description = NULL, ip = NULL, ip_key = NULL,
          net_key = NULL, device_hash = NULL, anonymized_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
      WHERE id = ${req.id}`;
    expect((await get(as, chatUrl(s.id))).json<SessionChatResponse>().request).toBeNull();
  });
});

describe("AC-264 history detayı `chat` özeti", () => {
  it("AC-264 r2 §15.4: count = satır sayısı; legacy session.chat_legacy audit satırından", async () => {
    const { t, admin, s, as } = await firm();
    await addSessionMessages(t.id, s.id, [
      { sender: "CUSTOMER", body: "a" },
      { sender: "TECH", userId: admin.id, body: "b" },
    ]);
    const h1 = (await get(as, `/api/v1/sessions/${s.id}/history`)).json<SessionHistoryDetail>();
    expect(h1.chat).toEqual({ count: 2, legacy: false });
    await testDb().auditLog.create({
      data: { tenantId: t.id, action: CHAT_AUDIT.LEGACY, entity: "support_sessions", entityId: s.id, result: "success", newValue: {} },
    });
    const h2 = (await get(as, `/api/v1/sessions/${s.id}/history`)).json<SessionHistoryDetail>();
    expect(h2.chat).toEqual({ count: 2, legacy: true });
  });
});

describe("AC-292 chatRetentionDays", () => {
  it("AC-292: resolve ve /public/requests/tenant yanıtı tenant_settings.retention_days taşır", async () => {
    const t = await createTenant();
    await testDb().tenantSettings.update({ where: { tenantId: t.id }, data: { retentionDays: 123 } });
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/public/sessions/resolve",
      headers: { origin: ORIGIN },
      remoteAddress: nextIp(),
      payload: { token: s.token, clientKind: "BROWSER" },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<{ chatRetentionDays: number }>().chatRetentionDays).toBe(123);
    const ref = await createRequestSettings(t.id);
    const info = await app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, remoteAddress: nextIp() });
    expect(info.statusCode, info.body).toBe(200);
    expect(info.json<{ chatRetentionDays: number }>().chatRetentionDays).toBe(123);
  });
});

describe("AC-291 aydınlatma metni yeni sistem sürümü", () => {
  it("AC-291: sistem metni sohbet paragrafını 'Ekranınız yalnız…' paragrafından sonra içerir", () => {
    const parts = defaultConsentBody("X Firma").split("\n\n");
    const i = parts.findIndex((p) => p.startsWith("Ekranınız yalnız"));
    expect(parts[i + 1]).toBe(CHAT_CONSENT_PARAGRAPH);
    expect(CHAT_CONSENT_PARAGRAPH).toContain("uçtan uca şifreli değildir");
    expect(CHAT_CONSENT_PARAGRAPH).toContain("anonimleştirilirken silinir");
  });

  it("AC-291 + AC-127: seed sistem metinli firmaya v+1 yayımlar (audit source=seed), idempotent; eski sürüm id'siyle onay 400", async () => {
    const t = await createTenant(); // v1 sistem metni (created_by NULL), paragrafsız
    const v1 = await testDb().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } });
    expect(await seedTenantConsent(testDb(), { id: t.id, name: t.name })).toBe(true);
    const cur = await testDb().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } });
    expect(cur.version).toBe(2);
    expect(cur.body).toContain(CHAT_CONSENT_KEY_SENTENCE);
    expect(cur.createdBy).toBeNull();
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "consent_text.created" } });
    expect(audit.newValue).toEqual({ version: 2, sha256: cur.sha256, source: "seed" });
    expect(await seedTenantConsent(testDb(), { id: t.id, name: t.name })).toBe(false);
    expect(await testDb().consentText.count({ where: { tenantId: t.id } })).toBe(2);
    await expect(acceptConsent(testDb(), t.id, v1.id, { ip: "203.0.113.1", userAgent: "t" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(acceptConsent(testDb(), t.id, cur.id, { ip: "203.0.113.1", userAgent: "t" })).resolves.toMatchObject({ version: 2 });
  });

  it("AC-291 K-P22-5: Admin metnine seed dokunmaz; ayar ucu chatParagraphMissing=true + chatParagraph; paragraf eklenince false", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const as = await loginAs(app, admin);
    const save = (body: string) =>
      app.inject({ method: "PUT", url: "/api/v1/settings/consent-text", headers: as.headers, payload: { body } });
    expect((await save(ADMIN_TEXT)).statusCode).toBe(200); // created_by = Admin
    const own = await testDb().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } });
    expect(own.createdBy).toBe(admin.id);
    expect(await seedTenantConsent(testDb(), { id: t.id, name: t.name })).toBe(false);
    expect((await testDb().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } })).id).toBe(own.id);
    const r = await get(as, "/api/v1/settings/consent-text");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<ConsentTextSettings>()).toMatchObject({ chatParagraphMissing: true, chatParagraph: CHAT_CONSENT_PARAGRAPH });
    const put = await save(`${ADMIN_TEXT}\n\n${CHAT_CONSENT_PARAGRAPH}`);
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<ConsentTextSettings>().chatParagraphMissing).toBe(false);
  });

  it("K-P22-5: anahtar cümle araması NFC + boşluk tekleştirmeli", () => {
    expect(chatParagraphMissing("x Sohbet  uçtan\nuca şifreli değildir: y")).toBe(false);
    expect(chatParagraphMissing("Sohbet uçtan uca şifrelidir")).toBe(true);
    expect(chatParagraphMissing("Sohbet uçtan uca şifreli değildir".normalize("NFD"))).toBe(false);
    expect(chatParagraphMissing(null)).toBe(true);
  });
});

describe("AC-264 S-P22-3 anonimleştirme mesaj bütçesi (parti düzeyi)", () => {
  it("S-P22-3: trimByMessageBudget — sırayı korur, bütçeyi aşmaz, en az 1 oturum", () => {
    const c = new Map([
      ["a", 3],
      ["b", 3],
      ["c", 0],
      ["big", 50],
    ]);
    expect(trimByMessageBudget(["a", "b", "c"], c, 5)).toEqual(["a"]);
    expect(trimByMessageBudget(["b", "c"], c, 5)).toEqual(["b", "c"]);
    expect(trimByMessageBudget(["big", "a"], c, 5)).toEqual(["big"]);
    expect(trimByMessageBudget([], c, 5)).toEqual([]);
  });

  it("AC-264 S-P22-3: bütçe partiyi kısaltır (more), tek büyük oturum yine alınır; anonim oturumda mesaj 0, ACTIVE korunur", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id, role: "ADMIN" });
    const old = new Date(Date.now() - 200 * DAY);
    const mk = async (n: number, minutes: number) => {
      const s = await createSupportSessionRow({
        tenantId: t.id,
        technicianId: u.id,
        status: "ENDED",
        createdAt: new Date(old.getTime() + minutes * 60_000),
      });
      await addBulk(t.id, s.id, n);
      return s.id;
    };
    const big = await mk(8, 0);
    const a = await mk(3, 1);
    const b = await mk(1, 2);
    const live = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE", createdAt: old });
    await addBulk(t.id, live.id, 2);
    const count = (id: string) => testDb().sessionMessage.count({ where: { sessionId: id } });
    const cutoff = new Date(Date.now() - 90 * DAY);

    const r1 = await anonymizeSessionBatch(testDb(), t.id, cutoff, 100, undefined, 5);
    expect(r1).toMatchObject({ sessions: 1, messages: 8, more: true }); // bütçeyi aşan tek oturum yine alındı
    const r2 = await anonymizeSessionBatch(testDb(), t.id, cutoff, 100, undefined, 5);
    expect(r2).toMatchObject({ sessions: 2, messages: 4, more: false });
    const r3 = await anonymizeSessionBatch(testDb(), t.id, cutoff, 100, undefined, 5);
    expect(r3).toMatchObject({ selected: 0, more: false });
    for (const id of [big, a, b]) expect(await count(id)).toBe(0);
    expect(await count(live.id)).toBe(2);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: live.id } })).anonymizedAt).toBeNull();
  });
});
