// P14a A2 + P14b B2 — firma pasife alma tek TX (AC-205), tenant ayar audit'i (AC-224), firma seçici (AC-226).
// Gerçek MySQL + inject.
import type { TenantOptionsResponse, TenantSettingsView } from "@remote/contracts/api/tenants";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSession } from "../../src/auth/session.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { deactivateTenant, type TenantLiveEffects } from "../../src/tenants/service.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginRequest,
  makeApp,
  ORIGIN,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { createRequestRow } from "../helpers/requests.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

const db = () => testDb();
let ipSeq = 0;
async function signIn(user: TestUser): Promise<Session> {
  const res = await app.inject(
    loginRequest(user.email, user.password, { remoteAddress: `10.16.${Math.floor(++ipSeq / 250) + 1}.${(ipSeq % 250) + 1}` }),
  );
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}`);
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const token = jar[SESSION_COOKIE] ?? "";
  const csrf = jar[CSRF_COOKIE] ?? "";
  return { token, headers: { cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN } };
}
const call = (s: Session, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: s.headers, ...(payload === undefined ? {} : { payload }) });

async function bindingRow(tenantId: string, technicianId: string) {
  const done = await createSupportSessionRow({ tenantId, technicianId, status: "ENDED" });
  return db().deviceBinding.create({
    data: {
      id: newId(),
      tenantId,
      keyHash: sha256Hex(newId()),
      clientVersion: "0.10.0",
      firstSessionId: done.id,
      lastSessionId: done.id,
      lastUsedAt: new Date(),
    },
  });
}

describe("AC-205 firma pasife alma — talep iptali ve kayıt geçersizleştirme aynı commit'te", () => {
  it("AC-205: commit sonrası bildirim adımlarının hepsi düşse de bekleyen talepler CANCELLED(TENANT_PASSIVE) ve kayıtlar geçersiz; hemen yeniden etkinleştirmede hiçbiri geri gelmez", async () => {
    const t = await createTenant();
    const tech = await createUser({ tenantId: t.id, role: "ADMIN" });
    const reqs = [await createRequestRow(t.id), await createRequestRow(t.id)];
    const bindings = [await bindingRow(t.id, tech.id), await bindingRow(t.id, tech.id)];
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const s = await signIn(sa);
    const auth = await resolveSession(db(), s.token, new Date(), { setupEnforced: false });
    if (!auth) throw new Error("oturum");
    const boom = async (): Promise<never> => {
      throw new Error("bildirim düştü");
    };
    const errors: string[] = [];
    const fx: TenantLiveEffects = {
      rooms: { endByTenant: boom },
      hub: {
        closeByTenant: () => {
          throw new Error("hub");
        },
        closeByAuthToken: () => 0,
      },
      requestClosed: boom,
      bindingsRevoked: () => {
        throw new Error("metrik");
      },
      log: { error: (o: object) => errors.push(String((o as { step?: string }).step)), info: () => undefined },
    };
    const out = await deactivateTenant(db(), fx, { ip: "10.16.0.1", userAgent: "vitest", requestId: "ac205" }, auth, t.id);
    expect(out.status).toBe("PASSIVE");
    expect(errors).toEqual(["rooms", "panels", "requests", "requests", "bindings"]);
    // 30 sn içinde yeniden aktif (süpürücü çalışmadan) — pasif anından önceki talep/kayıt geçerli kalmaz
    expect((await call(s, "POST", `/admin/tenants/${t.id}/reactivate`, {})).statusCode).toBe(200);
    for (const r of reqs)
      expect(await db().supportRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({
        status: "CANCELLED",
        cancelReason: "TENANT_PASSIVE",
      });
    for (const b of bindings)
      expect(await db().deviceBinding.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
        revokeReason: "TENANT_PASSIVE",
        keyHash: null,
      });
    const audit = await db().auditLog.findFirstOrThrow({ where: { entityId: t.id, action: "tenant.deactivated" } });
    expect(audit.newValue).toMatchObject({ status: "PASSIVE", cancelledRequests: 2, revokedBindings: 2 });
    expect(audit.correlationId).toBe("ac205");
    // talep ve kayıt audit'leri aynı TX'te (aynı istek kimliği)
    expect(await db().auditLog.count({ where: { correlationId: "ac205", action: "request.cancelled", tenantId: t.id } })).toBe(2);
    expect(
      await db().auditLog.findFirstOrThrow({ where: { correlationId: "ac205", action: "binding.revoked", tenantId: t.id } }),
    ).toMatchObject({ newValue: { reason: "TENANT_PASSIVE", count: 2 } });
  });

  it("AC-205: HTTP yolu — pasif yanıtı döndüğünde DB zaten son durumda; başka firmanın talep/kaydı etkilenmez", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const tech = await createUser({ tenantId: t.id, role: "ADMIN" });
    const otherTech = await createUser({ tenantId: other.id, role: "ADMIN" });
    const mine = await createRequestRow(t.id);
    const theirs = await createRequestRow(other.id);
    const b1 = await bindingRow(t.id, tech.id);
    const b2 = await bindingRow(other.id, otherTech.id);
    const s = await signIn(await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    expect((await call(s, "POST", `/admin/tenants/${t.id}/deactivate`, {})).statusCode).toBe(200);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("CANCELLED");
    expect((await db().deviceBinding.findUniqueOrThrow({ where: { id: b1.id } })).revokedAt).not.toBeNull();
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("PENDING");
    expect((await db().deviceBinding.findUniqueOrThrow({ where: { id: b2.id } })).revokedAt).toBeNull();
  });
});

describe("AC-224 tenant ayarları (Ayarlar > Genel)", () => {
  it("AC-224: sessionTtlMin, maxActiveHours, maxOpenSessions, maxFileMb alan bazlı doğrulanır (400 fields.<alan>); kayıt audit'e eski → yeni; değişmeyen kayıtta audit yok", async () => {
    const t = await createTenant();
    const s = await signIn(await createUser({ tenantId: t.id, role: "ADMIN" }));
    for (const [k, v] of [
      ["sessionTtlMin", 14],
      ["sessionTtlMin", 31],
      ["maxActiveHours", 0],
      ["maxActiveHours", 9],
      ["maxOpenSessions", 0],
      ["maxOpenSessions", 11],
      ["maxFileMb", 0],
      ["maxFileMb", 2049],
    ] as const) {
      const r = await call(s, "PUT", "/settings/tenant", { [k]: v });
      expect(r.statusCode, `${k}=${v}`).toBe(400);
      expect(r.json().error.fields).toHaveProperty(k);
    }
    const body = { sessionTtlMin: 30, maxActiveHours: 8, maxOpenSessions: 10, maxFileMb: 2048 };
    const ok = await call(s, "PUT", "/settings/tenant", body);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<TenantSettingsView>()).toMatchObject(body);
    const rows = await db().auditLog.findMany({ where: { tenantId: t.id, action: "tenant_settings.updated" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      result: "success",
      oldValue: { sessionTtlMin: 15, maxActiveHours: 4, maxOpenSessions: 3, maxFileMb: expect.any(Number) },
      newValue: body,
    });
    expect((await call(s, "PUT", "/settings/tenant", body)).statusCode).toBe(200);
    expect(await db().auditLog.count({ where: { tenantId: t.id, action: "tenant_settings.updated" } })).toBe(1);
  });
});

describe("AC-226 GET /admin/tenants/options (firma seçici)", () => {
  // Benzersiz, i/ı içermeyen küçük harfli belirteç: diğer testlerin firmalarından ayrışır, harf duyarsızlığı sınanır.
  const tok = Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 23)]).join("");
  let sa: Session;
  beforeAll(async () => {
    sa = await signIn(await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const rows = Array.from({ length: 250 }, (_, i) => {
      const id = newId();
      const n = String(i).padStart(3, "0");
      // 0..99 önek eşleşmesi, 100..249 içerir; her 10'dan biri pasif; 0..4 silinmiş
      const name = i < 100 ? `${tok} Bilişim ${n}` : `Çağrı ${n} ${tok} Teknoloji`;
      return {
        id,
        name,
        slug: `opt-${id.toLowerCase()}`,
        status: i % 10 === 3 ? "PASSIVE" : "ACTIVE",
        ...(i < 5 ? { deletedAt: new Date() } : {}),
      };
    });
    await db().tenant.createMany({ data: rows });
  });

  const opts = (q: Record<string, string>) => call(sa, "GET", `/admin/tenants/options?${new URLSearchParams(q).toString()}`);

  it("AC-226: q ile ≤ 20 sonuç; önek eşleşmesi önce, aktif önce, ada göre; harf duyarsız (BÜYÜK/Türkçe); silinmiş yok; limit 1..20", async () => {
    const r = await opts({ q: tok.toUpperCase() });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const items = r.json<TenantOptionsResponse>().items;
    expect(items).toHaveLength(20);
    expect(items.every((i) => i.name.startsWith(tok))).toBe(true); // önek önce
    expect(items.every((i) => i.status === "ACTIVE")).toBe(true); // aktif önce
    expect(items.map((i) => i.name)).toEqual([...items.map((i) => i.name)].sort());
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(["id", "name", "slug", "status"]);
    expect(items.some((i) => i.name.endsWith(" 000"))).toBe(false); // silinmiş
    const contains = (await opts({ q: `${tok} TEKNOLOJİ`, limit: "5" })).json<TenantOptionsResponse>().items;
    expect(contains).toHaveLength(5);
    expect(contains.every((i) => i.name.startsWith("Çağrı"))).toBe(true);
    // Ç/Ğ/İ büyük-küçük eşleşir (unicode_ci). Not: noktasız ı ↔ I eşleşmez (harmanlama sınırı, db-notlari B1).
    const tr = (await opts({ q: `ÇAĞ` })).json<TenantOptionsResponse>().items;
    expect(tr.length).toBeGreaterThan(0);
    expect(tr.every((i) => i.name.toLocaleLowerCase("tr").includes("çağ"))).toBe(true);
    for (const bad of [{ limit: "0" }, { limit: "21" }, { q: "x".repeat(121) }, { x: "1" }] as Record<string, string>[])
      expect((await opts(bad)).statusCode, JSON.stringify(bad)).toBe(400);
  });

  it("AC-226: LIKE jokerleri kaçışlı (q='%' / '_' her şeyi eşlemez); boş q → ilk 20 (aktif önce)", async () => {
    expect((await opts({ q: `${tok}%Bilişim` })).json<TenantOptionsResponse>().items).toEqual([]);
    expect((await opts({ q: `${tok}_` })).json<TenantOptionsResponse>().items).toEqual([]);
    const all = (await opts({})).json<TenantOptionsResponse>().items;
    expect(all).toHaveLength(20);
    const firstPassive = all.findIndex((i) => i.status === "PASSIVE");
    if (firstPassive >= 0) expect(all.slice(firstPassive).every((i) => i.status === "PASSIVE")).toBe(true);
  });

  it("AC-226: 250 firmalı fixture'da sunucu süresi p95 ≤ 500 ms (40 ölçüm)", async () => {
    const ms: number[] = [];
    for (let i = 0; i < 40; i++) {
      const q = i % 2 ? tok.slice(0, 3 + (i % 5)) : `${tok} bil`;
      const t0 = performance.now();
      expect((await opts({ q })).statusCode).toBe(200);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    expect(ms[Math.ceil(ms.length * 0.95) - 1]).toBeLessThanOrEqual(500);
  });

  it("AC-226: yalnız SUPER_ADMIN — tenant Admin'i 403, kimliksiz 401", async () => {
    const t = await createTenant();
    const admin = await signIn(await createUser({ tenantId: t.id, role: "ADMIN" }));
    expect((await call(admin, "GET", "/admin/tenants/options")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/tenants/options" })).statusCode).toBe(401);
  });
});
