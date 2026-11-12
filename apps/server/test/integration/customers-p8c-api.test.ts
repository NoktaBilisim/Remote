// P8c-1 müşteriler API'si — gerçek MySQL + dinleyen sunucu. AC-165 (yetki), 166 (liste/arama), 167 (form kuralları),
// 168 (ref ad alanı, tek 404), 170 (yenileme), 171 (pasif/aktif), 172 (tenant izolasyonu), 173/195 (audit, PII),
// 175/176 (Genel/müşteri filtresi), 177 (kabulde kopya), 178 (sekme sayaçları), 179 (CSV), 180 (POST /sessions customerId).
import { afterEach, describe, expect, it } from "vitest";
import { anonymizeCustomers, sweepCustomerPassive } from "../../src/customers/service.ts";
import { sha256Hex } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginAs, testDb, type Session } from "../helpers/app.ts";
import { createCustomerRow, createRequestRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const C = "/api/v1/customers";
type ErrBody = { error: { code: string; message: string; fields?: Record<string, string> } };
const errOf = (r: { json: <T>() => T }) => r.json<ErrBody>().error;
const asText = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? String(x) : x));
let ipSeq = 0;
const strip = (b: string) => b.replace(/"requestId":"[0-9A-Z]{26}"/, "");
const nextIp = () => `198.51.120.${(++ipSeq % 250) + 1}`;

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});
async function boot() {
  live = await startLive({ env: PROXY });
  return { l: live, rc: requestClient(live.app, live.base) };
}

type Method = "GET" | "POST" | "PATCH";
const api = (l: Live, s: Session, method: Method, url: string, payload?: unknown) =>
  l.app.inject({ method, url, headers: s.headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

async function login(l: Live, tenantId: string | null, o: { role?: "SUPER_ADMIN" | "ADMIN" | "USER"; perms?: Record<string, boolean> } = {}) {
  const user = await createUser({ tenantId, role: o.role ?? "USER", ...(o.perms ? { perms: o.perms } : {}) });
  return { user, s: await loginAs(l.app, user) };
}

async function adminOf(l: Live) {
  const t = await createTenant();
  const a = await login(l, t.id, { role: "ADMIN" });
  return { tenantId: t.id, ...a };
}
async function create(l: Live, s: Session, body: Record<string, unknown>) {
  const r = await api(l, s, "POST", C, body);
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ id: string; name: string; downloadUrl: string; fileName: string; fileLabel: string; status: string }>();
}
const refOf = (downloadUrl: string | null): string => {
  const m = /\?ref=([a-z2-7]{16})$/.exec(downloadUrl ?? "");
  if (!m?.[1]) throw new Error(`ref yok: ${downloadUrl}`);
  return m[1];
};

describe("AC-165 yetki anahtarları", () => {
  it("AC-165: customers.view yoksa tüm müşteri uçları 403", async () => {
    const { l } = await boot();
    const t = await createTenant();
    const c = await createCustomerRow(t.id);
    const u = await login(l, t.id, { perms: { ...TECH_PERMS } });
    const calls: [Method, string, unknown?][] = [
      ["GET", C],
      ["GET", `${C}/general-link`],
      ["GET", `${C}/${c.id}`],
      ["GET", `${C}/${c.id}/requests`],
      ["GET", `${C}/${c.id}/sessions`],
    ];
    for (const [m, url, p] of calls) expect((await api(l, u.s, m, url, p)).statusCode, url).toBe(403);
    // options: talep/geçmiş yetkisi de yoksa 403
    expect((await api(l, u.s, "GET", `${C}/options`)).statusCode).toBe(403);
  });

  it("AC-165: customers.create yoksa POST /customers 403, kayıt yazılmaz", async () => {
    const { l } = await boot();
    const t = await createTenant();
    const u = await login(l, t.id, { perms: { "customers.view": true, "customers.edit": true, "customers.delete": true } });
    expect((await api(l, u.s, "POST", C, { name: "Yetkisiz Ltd" })).statusCode).toBe(403);
    expect(await testDb().customer.count({ where: { tenantId: t.id } })).toBe(0);
  });

  it("AC-165: customers.edit yoksa PATCH / rotate-ref / reactivate 403", async () => {
    const { l } = await boot();
    const t = await createTenant();
    const c = await createCustomerRow(t.id);
    const u = await login(l, t.id, { perms: { "customers.view": true, "customers.create": true, "customers.delete": true } });
    expect((await api(l, u.s, "PATCH", `${C}/${c.id}`, { note: "x" })).statusCode).toBe(403);
    expect((await api(l, u.s, "POST", `${C}/${c.id}/rotate-ref`, {})).statusCode).toBe(403);
    expect((await api(l, u.s, "POST", `${C}/${c.id}/reactivate`, {})).statusCode).toBe(403);
    expect((await testDb().customer.findUniqueOrThrow({ where: { id: c.id } })).requestRef).toBe(c.requestRef);
  });

  it("AC-165: customers.delete yoksa pasife alma 403; Admin varsayılan tüm anahtarlar açık", async () => {
    const { l } = await boot();
    const t = await createTenant();
    const c = await createCustomerRow(t.id);
    const u = await login(l, t.id, { perms: { "customers.view": true, "customers.create": true, "customers.edit": true } });
    expect((await api(l, u.s, "POST", `${C}/${c.id}/deactivate`, {})).statusCode).toBe(403);
    const a = await login(l, t.id, { role: "ADMIN" });
    expect((await api(l, a.s, "POST", `${C}/${c.id}/deactivate`, {})).statusCode).toBe(200);
    expect((await api(l, a.s, "POST", `${C}/${c.id}/reactivate`, {})).statusCode).toBe(200);
    expect((await api(l, a.s, "POST", C, { name: "Admin Firma" })).statusCode).toBe(201);
  });
});

describe("AC-167 form kuralları", () => {
  it("AC-167: ad tenant içinde harf/Türkçe duyarsız tekil (pasif dahil) → 409 fields.name; başka tenant'ta serbest", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const first = await create(l, a.s, { name: "Şişli Yazılım" });
    expect(first.fileLabel).toBe("SisliYazilim");
    const dup = await api(l, a.s, "POST", C, { name: "  ŞİŞLİ yazılım " });
    expect(dup.statusCode).toBe(409);
    expect(errOf(dup).fields?.name).toBe("Bu adla bir müşteri zaten var");
    expect((await api(l, a.s, "POST", `${C}/${first.id}/deactivate`, {})).statusCode).toBe(200);
    expect((await api(l, a.s, "POST", C, { name: "şişli YAZILIM" })).statusCode).toBe(409);
    const other = await create(l, a.s, { name: "Başka Firma" });
    expect((await api(l, a.s, "PATCH", `${C}/${other.id}`, { name: "Şişli Yazılım" })).statusCode).toBe(409);
    const b = await adminOf(l);
    await create(l, b.s, { name: "Şişli Yazılım" });
  });

  it("AC-167: istemci atlatılsa da sunucu 400 + alan bazında hata; kayıt yazılmaz", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const bad: [Record<string, unknown>, string][] = [
      [{ name: "A" }, "name"],
      [{ name: "x".repeat(101) }, "name"],
      [{ name: "Firma", fileLabel: "Ğüş" }, "fileLabel"],
      [{ name: "Firma", fileLabel: "a".repeat(21) }, "fileLabel"],
      [{ name: "Firma", email: "bozuk" }, "email"],
      [{ name: "Firma", phone: "12" }, "phone"],
      [{ name: "Firma", contactName: "y".repeat(81) }, "contactName"],
      [{ name: "Firma", note: "sekme\tyasak" }, "note"],
      [{ name: "Firma", note: "n".repeat(1001) }, "note"],
    ];
    for (const [body, field] of bad) {
      const r = await api(l, a.s, "POST", C, body);
      expect(r.statusCode, asText(body)).toBe(400);
      expect(errOf(r).fields?.[field], asText(body)).toBeTruthy();
    }
    expect((await api(l, a.s, "POST", C, { name: "Firma", extra: 1 })).statusCode).toBe(400);
    expect(await testDb().customer.count({ where: { tenantId: a.tenantId } })).toBe(0);
    const ok = await create(l, a.s, { name: "Firma", fileLabel: "Ozel1", contactName: "Ali Veli", phone: "0532 111 22 33", email: "ali@ornek.com", note: "satır1\r\nsatır2" });
    const d = (await api(l, a.s, "GET", `${C}/${ok.id}`)).json<Record<string, unknown>>();
    expect(d).toMatchObject({ fileLabel: "Ozel1", contactName: "Ali Veli", phone: "+905321112233", email: "ali@ornek.com", note: "satır1\nsatır2" });
    expect((await api(l, a.s, "PATCH", `${C}/${ok.id}`, {})).statusCode).toBe(400);
  });
});

describe("AC-172 tenant izolasyonu", () => {
  it("AC-172: B kullanıcısı A müşterisini listeleyemez/görüntüleyemez/düzenleyemez/yenileyemez/pasife alamaz/oturumda seçemez → 404", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const b = await adminOf(l);
    const ca = await create(l, a.s, { name: "A Firması" });
    const list = await api(l, b.s, "GET", `${C}?status=all`);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(ca.id);
    expect((await api(l, b.s, "GET", `${C}/options?status=all`)).body).not.toContain(ca.id);
    const calls: [Method, string, unknown?][] = [
      ["GET", `${C}/${ca.id}`],
      ["PATCH", `${C}/${ca.id}`, { note: "x" }],
      ["POST", `${C}/${ca.id}/rotate-ref`, {}],
      ["POST", `${C}/${ca.id}/deactivate`, {}],
      ["POST", `${C}/${ca.id}/reactivate`, {}],
      ["GET", `${C}/${ca.id}/requests`],
      ["GET", `${C}/${ca.id}/sessions`],
      ["POST", "/api/v1/sessions", { customerId: ca.id }],
    ];
    for (const [m, url, p] of calls) expect((await api(l, b.s, m, url, p)).statusCode, `${m} ${url}`).toBe(404);
    expect((await api(l, b.s, "GET", `/api/v1/support-requests?customer=${ca.id}`)).json<{ items: unknown[] }>().items).toEqual([]);
    expect(await testDb().customer.findUniqueOrThrow({ where: { id: ca.id } })).toMatchObject({ status: "ACTIVE", note: null });
  });

  it("AC-172: Super Admin firma seçmeden 403; seçili tenant bağlamında yalnız o tenant'ın müşterileri, diğeri 404", async () => {
    const { l } = await boot();
    const a = await createTenant();
    const b = await createTenant();
    const ca = await createCustomerRow(a.id);
    const cb = await createCustomerRow(b.id);
    const sa = await login(l, null, { role: "SUPER_ADMIN" });
    for (const url of [C, `${C}/${ca.id}`, `${C}/general-link`]) {
      const r = await api(l, sa.s, "GET", url);
      expect(r.statusCode, url).toBe(403);
      expect(errOf(r).message).toBe("Önce bir firma seçin.");
    }
    expect((await api(l, sa.s, "POST", C, { name: "SA Firma" })).statusCode).toBe(403);
    await testDb().authSession.update({ where: { tokenHash: sha256Hex(sa.s.token) }, data: { actingTenantId: a.id } });
    const list = await api(l, sa.s, "GET", C);
    expect(list.body).toContain(ca.id);
    expect(list.body).not.toContain(cb.id);
    expect((await api(l, sa.s, "GET", `${C}/${cb.id}`)).statusCode).toBe(404);
    expect((await api(l, sa.s, "PATCH", `${C}/${ca.id}`, { note: "SA notu" })).statusCode).toBe(200);
  });
});

describe("AC-166 liste, arama, sayfalama", () => {
  it("AC-166: arama ad/yetkili/telefonda, harf ve Türkçe duyarsız; durum filtresi; sayfa 50 / üst 100; listede PII yok", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const s1 = await create(l, a.s, { name: "Şişli Yazılım Ltd.", contactName: "İsmail Öz", phone: "0532 111 22 33", email: "gizli@ornek.com" });
    const s2 = await create(l, a.s, { name: "Ankara Tekstil" });
    const s3 = await create(l, a.s, { name: "Izmir Gıda" });
    await api(l, a.s, "POST", `${C}/${s3.id}/deactivate`, {});
    const ids = async (qs: string) => (await api(l, a.s, "GET", `${C}?${qs}`)).json<{ items: { id: string }[]; total: number }>();
    expect((await ids("q=%C5%9E%C4%B0%C5%9EL%C4%B0")).items.map((x) => x.id)).toEqual([s1.id]); // "ŞİŞLİ"
    expect((await ids("q=sisli")).items.map((x) => x.id)).toEqual([s1.id]);
    expect((await ids("q=ismail")).items.map((x) => x.id)).toEqual([s1.id]);
    expect((await ids("q=0532%20111")).items.map((x) => x.id)).toEqual([s1.id]);
    expect((await ids("q=5321112233")).items.map((x) => x.id)).toEqual([s1.id]);
    expect((await ids("q=gizli")).items).toEqual([]); // e-posta aranmaz
    expect((await ids("q=%20%20")).total).toBe(2); // boş q yok sayılır
    expect((await ids("")).items.map((x) => x.id)).toEqual([s2.id, s1.id]); // vars. aktif, ad sırası
    expect((await ids("status=passive")).items.map((x) => x.id)).toEqual([s3.id]);
    expect((await ids("status=all")).total).toBe(3);
    expect((await ids("status=all&sort=createdAt:desc")).items[0]?.id).toBe(s3.id);
    expect((await ids("pageSize=1&page=2")).items.map((x) => x.id)).toEqual([s1.id]);
    for (const qs of ["q=a", "pageSize=101", "status=x", "sort=name:desc", "foo=1"]) expect((await api(l, a.s, "GET", `${C}?${qs}`)).statusCode, qs).toBe(400);
    const list = await api(l, a.s, "GET", C);
    expect(list.json<{ pageSize: number }>().pageSize).toBe(50);
    for (const pii of ["İsmail", "gizli@", "905321112233"]) expect(list.body).not.toContain(pii);
  });

  it("AC-166 / AC-176: 1.000 müşteri + 10.000 talepte liste ve talep müşteri filtresi < 500 ms", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const db = testDb();
    const consent = await db.consentText.findFirstOrThrow({ where: { tenantId: a.tenantId, isCurrent: true }, select: { id: true, sha256: true } });
    const { customerKeys, suggestFileLabel } = await import("@remote/contracts/api/customers");
    const { newId, newTenantRef, newSecretToken } = await import("../../src/lib/ids.ts");
    const customers = Array.from({ length: 1000 }, (_, i) => {
      const name = `Perf Firma ${String(i).padStart(4, "0")}`;
      return { id: newId(), tenantId: a.tenantId, name, ...customerKeys(name, `Yetkili ${i}`, null), contactName: `Yetkili ${i}`, fileLabel: suggestFileLabel(name), requestRef: newTenantRef() };
    });
    await db.customer.createMany({ data: customers });
    await db.requestRef.createMany({ data: customers.map((c) => ({ ref: c.requestRef, tenantId: a.tenantId, customerId: c.id })) });
    const base = Date.now() - 86_400_000;
    for (let k = 0; k < 10; k++) {
      await db.supportRequest.createMany({
        data: Array.from({ length: 1000 }, (_, j) => {
          const i = k * 1000 + j;
          const at = new Date(base + i * 1000);
          return {
            id: newId(),
            tenantId: a.tenantId,
            customerId: i % 10 === 0 ? null : customers[i % 1000]?.id ?? null,
            requestCode: String(100000 + (i % 900000)),
            secretHash: sha256Hex(newSecretToken()),
            clientInstance: newSecretToken().slice(0, 22),
            clientVersion: "0.10.0",
            status: "EXPIRED",
            closedAt: new Date(at.getTime() + 1_800_000),
            customerName: "Perf",
            customerPhone: "+905321234567",
            description: "Performans ölçümü talebi",
            consentTextId: consent.id,
            consentSha256: consent.sha256,
            consentedAt: at,
            ip: "198.51.100.1",
            ipKey: "198.51.100.1",
            netKey: "198.51.100.0/24",
            expiresAt: new Date(at.getTime() + 1_800_000),
            createdAt: at,
          };
        }),
      });
    }
    const median = async (url: string) => {
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await api(l, a.s, "GET", url);
        ms.push(performance.now() - t0);
        expect(r.statusCode, r.body).toBe(200);
      }
      return ms.sort((x, y) => x - y)[2] ?? Infinity;
    };
    const c0 = customers[1];
    if (!c0) throw new Error("müşteri yok");
    const first = (await api(l, a.s, "GET", `${C}?pageSize=1&page=2`)).json<{ total: number; items: { requestCount: number }[] }>();
    expect(first.total).toBe(1000);
    expect(first.items[0]?.requestCount).toBe(10);
    const m = {
      list: await median(C),
      search: await median(`${C}?q=firma%2005`),
      newest: await median(`${C}?sort=createdAt:desc&pageSize=100`),
      reqFilter: await median(`/api/v1/support-requests?tab=history&customer=${c0.id}`),
      reqGeneral: await median("/api/v1/support-requests?tab=history&customer=general"),
    };
    process.stdout.write(`AC-166/176 ölçüm (ms, medyan): ${JSON.stringify(m)}\n`);
    for (const [k, v] of Object.entries(m)) expect(v, k).toBeLessThan(500);
  }, 120_000);
});

describe("AC-168 / AC-170 / AC-171 ref, yenileme, pasif/aktif", () => {
  async function bootAgent() {
    const { createHash } = await import("node:crypto");
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "rs-p8c-"));
    const exe = Buffer.from("MZ test ikilisi — P8c");
    await writeFile(join(dir, "NoktaDestek.exe"), exe);
    live = await startLive({ env: { ...PROXY, SESSION_REF_KEY: "r".repeat(40), AGENT_BINARY_PATH: join(dir, "NoktaDestek.exe"), AGENT_SHA256: createHash("sha256").update(exe).digest("hex") } });
    return { l: live, rc: requestClient(live.app, live.base) };
  }
  const dl = (l: Live, ref: string) => l.app.inject({ method: "GET", url: `/api/v1/public/agent/request-download?ref=${ref}`, headers: { "x-forwarded-for": nextIp() } });
  const info = (l: Live, ref: string) => l.app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, headers: { "x-forwarded-for": nextIp() } });

  it("AC-168: müşteri ref'i [a-z2-7]{16}, tek ad alanında; indirme adı NoktaDestek-<etiket>-<ref>.exe; tenant bilgisi Genel ile aynı şekil; geçersiz/pasif aynı 404", async () => {
    const { l } = await bootAgent();
    const a = await adminOf(l);
    const genRef = await createRequestSettings(a.tenantId);
    const c = await create(l, a.s, { name: "Gizli Müşteri AŞ", fileLabel: "GizliMus" });
    const ref = refOf(c.downloadUrl);
    expect(ref).toMatch(/^[a-z2-7]{16}$/);
    expect(c.fileName).toBe(`NoktaDestek-GizliMus-${ref}.exe`);
    expect(await testDb().requestRef.findUniqueOrThrow({ where: { ref } })).toMatchObject({ tenantId: a.tenantId, customerId: c.id });
    const r = await dl(l, ref);
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`/downloads/NoktaDestek-GizliMus-${ref}.exe`);
    const gi = await info(l, genRef);
    const ci = await info(l, ref);
    expect(ci.statusCode).toBe(200);
    expect(Object.keys(ci.json<object>()).sort()).toEqual(Object.keys(gi.json<object>()).sort());
    expect(ci.body).not.toContain("Gizli Müşteri");
    expect(ci.json()).toEqual(gi.json()); // ref'in müşteriye mi Genel'e mi ait olduğu anlaşılmaz
    const unknown = await info(l, "abcdefghijklmnop");
    await api(l, a.s, "POST", `${C}/${c.id}/deactivate`, {});
    const passive = await info(l, ref);
    expect(unknown.statusCode).toBe(404);
    expect(passive.statusCode).toBe(404);
    expect(strip(passive.body)).toBe(strip(unknown.body));
    const pdl = await dl(l, ref);
    const udl = await dl(l, "abcdefghijklmnop");
    expect(pdl.statusCode).toBe(404);
    expect(strip(pdl.body)).toBe(strip(udl.body));
    // tek ad alanı: aynı ref ikinci kez yazılamaz (DB kısıtı)
    await expect(testDb().requestRef.create({ data: { ref, tenantId: a.tenantId, customerId: null } })).rejects.toThrow();
  });

  it("AC-170: bağlantı yenileme — yeni ref, eski ref 404, eski dosyadan talep reddi; audit'te ref yalnız 4 karakter", async () => {
    const { l, rc } = await boot();
    const a = await adminOf(l);
    await createRequestSettings(a.tenantId);
    const c = await create(l, a.s, { name: "Yenilenen Firma" });
    const oldRef = refOf(c.downloadUrl);
    const consentId = await rc.consentId(oldRef, nextIp());
    const r = await api(l, a.s, "POST", `${C}/${c.id}/rotate-ref`, {});
    expect(r.statusCode).toBe(200);
    const newRef = refOf(r.json<{ downloadUrl: string }>().downloadUrl);
    expect(newRef).not.toBe(oldRef);
    expect(r.json<{ refRotatedAt: string | null }>().refRotatedAt).not.toBeNull();
    expect((await info(l, oldRef)).statusCode).toBe(404);
    expect((await info(l, newRef)).statusCode).toBe(200);
    const stale = await rc.createReq(oldRef, nextIp(), { consentTextId: consentId });
    expect(stale.statusCode).toBe(404);
    expect(await testDb().supportRequest.count({ where: { tenantId: a.tenantId } })).toBe(0);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: a.tenantId, action: "customer.ref_rotated" } });
    expect(audit).toMatchObject({ entity: "customer", entityId: c.id, result: "success" });
    expect(asText(audit)).toContain(oldRef.slice(0, 4));
    expect(asText(audit)).not.toContain(oldRef);
    expect(asText(audit)).not.toContain(newRef);
    // eski ref ad alanında kalır (append-only) → yeniden kullanılamaz
    expect(await testDb().requestRef.findUnique({ where: { ref: oldRef } })).not.toBeNull();
  });

  it("AC-171: pasife alma — ref 404, bekleyen talepler CUSTOMER_PASSIVE, options'ta görünmez; aktif etmede YENİ ref; süpürücü yarışta kalanı iptal eder", async () => {
    const { l, rc } = await boot();
    const a = await adminOf(l);
    await createRequestSettings(a.tenantId);
    const c = await create(l, a.s, { name: "Pasif Olacak" });
    const ref = refOf(c.downloadUrl);
    const created = await rc.createReq(ref, nextIp());
    expect(created.statusCode, created.body).toBe(201);
    const reqId = created.json<{ requestId: string }>().requestId;
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id: reqId } })).customerId).toBe(c.id);
    const d = await api(l, a.s, "POST", `${C}/${c.id}/deactivate`, {});
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({ status: "PASSIVE", downloadUrl: null, fileName: null });
    expect(await testDb().supportRequest.findUniqueOrThrow({ where: { id: reqId } })).toMatchObject({ status: "CANCELLED", cancelReason: "CUSTOMER_PASSIVE" });
    expect((await info(l, ref)).statusCode).toBe(404);
    expect((await api(l, a.s, "GET", `${C}/options`)).body).not.toContain(c.id);
    expect((await api(l, a.s, "GET", `${C}/options?status=all`)).body).toContain(c.id);
    expect((await api(l, a.s, "POST", "/api/v1/sessions", { customerId: c.id })).statusCode).toBe(404);
    expect((await api(l, a.s, "POST", `${C}/${c.id}/deactivate`, {})).statusCode).toBe(409);
    // yarış: pasif müşteriye bağlı PENDING satırı (doğrudan DB) süpürücüde düşer
    const raced = await createRequestRow(a.tenantId);
    await testDb().supportRequest.update({ where: { id: raced.id }, data: { customerId: c.id } });
    expect(await sweepCustomerPassive(l.app.requests)).toBeGreaterThanOrEqual(1);
    expect(await testDb().supportRequest.findUniqueOrThrow({ where: { id: raced.id } })).toMatchObject({ status: "CANCELLED", cancelReason: "CUSTOMER_PASSIVE" });

    const re = await api(l, a.s, "POST", `${C}/${c.id}/reactivate`, {});
    expect(re.statusCode).toBe(200);
    const newRef = refOf(re.json<{ downloadUrl: string }>().downloadUrl);
    expect(newRef).not.toBe(ref);
    expect((await info(l, ref)).statusCode).toBe(404);
    expect((await info(l, newRef)).statusCode).toBe(200);
    expect(await testDb().customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "ACTIVE", passiveAt: null });
  });
});

describe("AC-173 / AC-195 audit ve kişisel veri", () => {
  it("AC-173/195: oluşturma/güncelleme/yenileme/pasif/aktif audit entity=customer; ham PII hiçbir audit satırında yok; boşaltma audit'e yazılır", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const pii = { contactName: "Zeynep Kişisel", phone: "0532 987 65 43", email: "zeynep.kisisel@ornek.com", note: "Özel not içeriği 4242" };
    const c = await create(l, a.s, { name: "Audit Firma", ...pii });
    expect((await api(l, a.s, "PATCH", `${C}/${c.id}`, { contactName: "Mehmet Yeni", note: null })).statusCode).toBe(200);
    expect((await api(l, a.s, "PATCH", `${C}/${c.id}`, { phone: "", email: null })).statusCode).toBe(200);
    await api(l, a.s, "POST", `${C}/${c.id}/rotate-ref`, {});
    await api(l, a.s, "POST", `${C}/${c.id}/deactivate`, {});
    await api(l, a.s, "POST", `${C}/${c.id}/reactivate`, {});
    const rows = await testDb().auditLog.findMany({ where: { tenantId: a.tenantId, entity: "customer" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["customer.created", "customer.updated", "customer.updated", "customer.ref_rotated", "customer.deactivated", "customer.reactivated"]);
    for (const r of rows) expect(r).toMatchObject({ entityId: c.id, userId: a.user.id, result: "success", tenantId: a.tenantId });
    expect(rows.every((r) => r.ipAddress)).toBe(true);
    const all = asText(await testDb().auditLog.findMany({ where: { tenantId: a.tenantId } }));
    for (const raw of ["Zeynep", "Kişisel", "Mehmet", "9876543", "905329876543", "zeynep.kisisel", "Özel not", "4242"]) expect(all, raw).not.toContain(raw);
    const upd = rows[1];
    expect(asText(upd?.newValue)).toContain("contactName");
    expect(asText(upd?.newValue)).toContain("note");
    expect(asText(rows[2]?.oldValue)).toMatch(/\*\*\*/); // telefon maskeli eski değer
  });

  it("AC-195: pasif müşterinin kişisel alanları saklama süresi dolunca anonimleşir (saat ileri); aktif müşteriye dokunulmaz", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const p = await create(l, a.s, { name: "Eski Pasif", contactName: "Ali", phone: "0532 111 22 33", email: "a@b.co", note: "not" });
    const act = await create(l, a.s, { name: "Aktif Kalan", contactName: "Veli" });
    await api(l, a.s, "POST", `${C}/${p.id}/deactivate`, {});
    expect(await anonymizeCustomers(l.app.requests, new Date(Date.now() + 10 * 86_400_000))).toBe(0);
    expect(await anonymizeCustomers(l.app.requests, new Date(Date.now() + 731 * 86_400_000))).toBeGreaterThanOrEqual(1);
    const row = await testDb().customer.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ contactName: null, phone: null, email: null, note: null, name: "Eski Pasif" });
    expect(row.anonymizedAt).not.toBeNull();
    expect((await api(l, a.s, "GET", `${C}/${p.id}`)).json()).toMatchObject({ contactName: null, anonymizedAt: expect.any(String) });
    expect((await testDb().customer.findUniqueOrThrow({ where: { id: act.id } })).contactName).toBe("Veli");
    expect(await testDb().auditLog.count({ where: { tenantId: a.tenantId, action: "customer.anonymized" } })).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-175..180 talep/oturum bağlantısı", () => {
  const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true, "customers.view": true, "session_history.view": true };

  it("AC-175/176/177: müşteri ref'inden talep müşteriyi taşır (request.new + liste), Genel ref boş; filtre general/<id>; kabulde oturuma kopya", async () => {
    const { l, rc } = await boot();
    const a = await adminOf(l);
    const genRef = await createRequestSettings(a.tenantId);
    const c = await create(l, a.s, { name: "Talep Firması" });
    const tech = await login(l, a.tenantId, { perms: REQ_PERMS });
    const panel = await rc.panelWs(tech.s.token);
    const cr = (await rc.createReq(refOf(c.downloadUrl), nextIp())).json<{ requestId: string }>();
    const gr = (await rc.createReq(genRef, nextIp())).json<{ requestId: string }>();
    const n1 = await waitMsg<Record<string, unknown>>(panel, "request.new");
    const n2 = await waitMsg<Record<string, unknown>>(panel, "request.new");
    const byId = new Map([n1, n2].map((m) => [m.id, m]));
    expect(byId.get(cr.requestId)).toMatchObject({ customerFirm: { id: c.id, name: "Talep Firması" }, viaBinding: false, bindingRevoked: false, staleSource: false });
    expect(byId.get(gr.requestId)).toMatchObject({ customerFirm: null, viaBinding: false });
    const ids = async (qs: string) => (await api(l, tech.s, "GET", `/api/v1/support-requests?${qs}`)).json<{ items: { id: string }[] }>().items.map((x) => x.id);
    expect(await ids(`customer=${c.id}`)).toEqual([cr.requestId]);
    expect(await ids("customer=general")).toEqual([gr.requestId]);
    expect((await ids("")).sort()).toEqual([cr.requestId, gr.requestId].sort());
    expect((await api(l, tech.s, "GET", "/api/v1/support-requests?customer=xyz")).statusCode).toBe(400);
    const acc = await rc.accept(tech.s.headers, cr.requestId);
    expect(acc.statusCode, acc.body).toBe(200);
    const sid = acc.json<{ sessionId: string }>().sessionId;
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: sid } })).customerId).toBe(c.id);
    expect(await ids(`tab=history&customer=${c.id}`)).toEqual([cr.requestId]);
  });

  it("AC-178: detay sekmesi talep sayısı ve son talep zamanı listeyle tutarlı; yeniden eskiye, vars. 25; sekme yetkileri", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const c = await create(l, a.s, { name: "Sekme Firma" });
    for (let i = 0; i < 3; i++) {
      const r = await createRequestRow(a.tenantId, { createdAt: new Date(Date.now() - (i + 1) * 60_000) });
      await testDb().supportRequest.update({ where: { id: r.id }, data: { customerId: c.id } });
    }
    await createRequestRow(a.tenantId); // Genel
    const item = (await api(l, a.s, "GET", C)).json<{ items: { id: string; requestCount: number; lastRequestAt: string | null }[] }>().items.find((x) => x.id === c.id);
    const tab = (await api(l, a.s, "GET", `${C}/${c.id}/requests`)).json<{ items: { createdAt: string }[]; total: number; pageSize: number }>();
    expect(tab.pageSize).toBe(25);
    expect(item?.requestCount).toBe(3);
    expect(tab.total).toBe(3);
    expect(item?.lastRequestAt).toBe(tab.items[0]?.createdAt);
    expect(tab.items.map((x) => x.createdAt)).toEqual([...tab.items.map((x) => x.createdAt)].sort().reverse());
    expect((await api(l, a.s, "GET", `${C}/${c.id}`)).json()).toMatchObject({ requestCount: 3, sessionCount: 0 });
    const v = await login(l, a.tenantId, { perms: { "customers.view": true } });
    expect((await api(l, v.s, "GET", `${C}/${c.id}/requests`)).statusCode).toBe(403);
    expect((await api(l, v.s, "GET", `${C}/${c.id}/sessions`)).statusCode).toBe(403);
    expect((await api(l, v.s, "GET", `${C}/${c.id}`)).statusCode).toBe(200);
  });

  it("AC-179/180: POST /sessions customerId → customerFirm; liste/CSV 'Müşteri firma' sütunu + filtre (none/<id>), formül kaçışı; yetkisiz 403, geçersiz 404", async () => {
    const { l } = await boot();
    const a = await adminOf(l);
    const c = await create(l, a.s, { name: "=Eşit Firma" });
    const withC = await api(l, a.s, "POST", "/api/v1/sessions", { customerId: c.id });
    expect(withC.statusCode, withC.body).toBe(201);
    expect(withC.json()).toMatchObject({ customerFirm: { id: c.id, name: "=Eşit Firma" } });
    const plain = await api(l, a.s, "POST", "/api/v1/sessions", {});
    expect(plain.statusCode).toBe(201);
    expect(plain.json()).toMatchObject({ customerFirm: null });
    const sid = withC.json<{ id: string }>().id;
    const pid = plain.json<{ id: string }>().id;
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: sid } })).customerId).toBe(c.id);
    expect((await api(l, a.s, "POST", "/api/v1/sessions", { customerId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).statusCode).toBe(404);
    expect((await api(l, a.s, "POST", "/api/v1/sessions", { customerId: c.id, x: 1 })).statusCode).toBe(400);
    const noView = await login(l, a.tenantId, { perms: { ...TECH_PERMS } });
    expect((await api(l, noView.s, "POST", "/api/v1/sessions", { customerId: c.id })).statusCode).toBe(403);
    expect((await api(l, noView.s, "POST", "/api/v1/sessions", {})).statusCode).toBe(201);

    const ids = async (qs: string) => (await api(l, a.s, "GET", `/api/v1/sessions?${qs}`)).json<{ items: { id: string; customerFirm: unknown }[] }>().items;
    const f = await ids(`customerFirm=${c.id}`);
    expect(f.map((x) => x.id)).toEqual([sid]);
    expect(f[0]?.customerFirm).toMatchObject({ id: c.id, name: "=Eşit Firma" });
    expect((await ids("customerFirm=none")).map((x) => x.id)).toContain(pid);
    expect((await ids("customerFirm=none")).map((x) => x.id)).not.toContain(sid);
    const csv = await api(l, a.s, "GET", `/api/v1/sessions/export.csv?customerFirm=${c.id}`);
    expect(csv.statusCode).toBe(200);
    const lines = csv.rawPayload.toString("utf8").slice(1).split("\r\n").filter(Boolean);
    expect(lines[0]).toContain(";Kaynak;Müşteri firma;Bekleme;");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(";'=Eşit Firma;");
    const all = await api(l, a.s, "GET", "/api/v1/sessions/export.csv");
    const row = all.rawPayload.toString("utf8").split("\r\n").find((ln) => ln.startsWith(pid));
    expect(row).toMatch(/;Teknisyen;;/); // müşterisiz oturumda boş, "Genel" değil
  });

  it("AC-191: 0.9.1 gövdesiyle müşteri ref'i müşteriye düşer; pasife almada 0.9.x WS'e TENANT_PASSIVE, ≥0.10.0'a CUSTOMER_PASSIVE", async () => {
    const { l, rc } = await boot();
    const a = await adminOf(l);
    await createRequestSettings(a.tenantId);
    const c = await create(l, a.s, { name: "Eski İstemci Firma" });
    const ref = refOf(c.downloadUrl);
    const old = (await rc.createReq(ref, nextIp(), { version: "0.9.1" })).json<{ requestId: string; requestSecret: string }>();
    const neu = (await rc.createReq(ref, nextIp(), { version: "0.10.0" })).json<{ requestId: string; requestSecret: string }>();
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id: old.requestId } })).customerId).toBe(c.id);
    const wOld = await rc.reqWs(old.requestSecret);
    const wNew = await rc.reqWs(neu.requestSecret);
    await waitMsg(wOld, "request.state");
    await waitMsg(wNew, "request.state");
    await api(l, a.s, "POST", `${C}/${c.id}/deactivate`, {});
    expect(await waitMsg(wOld, "request.closed")).toMatchObject({ status: "CANCELLED", reason: "TENANT_PASSIVE" });
    expect(await waitMsg(wNew, "request.closed")).toMatchObject({ status: "CANCELLED", reason: "CUSTOMER_PASSIVE" });
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id: old.requestId } })).cancelReason).toBe("CUSTOMER_PASSIVE");
  });
});
