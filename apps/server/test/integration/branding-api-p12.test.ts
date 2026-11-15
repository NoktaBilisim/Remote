// P12 uçları (AC-81..85, T16): logo/avatar/sistem logosu yükleme, dosya sunumu ve izolasyon, public marka, tema.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOGO_URL, THEME_COOKIE, UPLOAD_MAX_BYTES } from "@remote/contracts/api/branding";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import {
  ORIGIN,
  TEST_UPLOADS_DIR,
  createSupportSessionRow,
  createTenant,
  createUser,
  loginRequest,
  makeApp,
  testDb,
  testFixtureDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { createRequestSettings } from "../helpers/requests.ts";
import { newBindingKey, newId, sha256Hex } from "../../src/lib/ids.ts";
import { SYSTEM_LOGO_KEY, mailLogoUrl, systemLogoPath, systemLogoUrl } from "../../src/uploads/urls.ts";

let app: FastifyInstance;
const db = () => testDb();

const png = (w = 900, h = 300) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();

function multipart(data: Buffer, opts: { field?: string; filename?: string; type?: string } = {}) {
  const boundary = `----rs${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${opts.field ?? "file"}"; filename="${opts.filename ?? "a.png"}"\r\nContent-Type: ${opts.type ?? "image/png"}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(s: Session | null, url: string, data: Buffer, opts: Parameters<typeof multipart>[1] = {}) {
  const m = multipart(data, opts);
  return app.inject({ method: "POST", url, payload: m.payload, headers: { ...(s?.headers ?? {}), ...m.headers } });
}

// Login IP limiti (20/dk) bu dosyadaki çok sayıda girişte tetiklenmesin: her giriş ayrı test IP'sinden.
let ipSeq = 0;
const nextIp = () => `203.0.113.${(++ipSeq % 250) + 1}`;
async function login(u: TestUser): Promise<Session> {
  const res = await app.inject(loginRequest(u.email, u.password, { remoteAddress: nextIp() }));
  if (res.statusCode !== 200) throw new Error(`login başarısız: ${res.statusCode}`);
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const csrf = jar[CSRF_COOKIE] ?? "";
  return {
    token: jar[SESSION_COOKIE] ?? "",
    headers: { cookie: `${SESSION_COOKIE}=${jar[SESSION_COOKIE] ?? ""}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN },
  };
}

const del = (s: Session, url: string) => app.inject({ method: "DELETE", url, headers: s.headers });
const get = (url: string, s?: Session) => app.inject({ method: "GET", url, ...(s ? { headers: s.headers } : {}) });
const fileOf = (url: string) =>
  join(
    TEST_UPLOADS_DIR,
    url.replace(/^\/api\/v1\/files\/(logo|avatar|system-logo)\//, (_m, k: string) => (k === "system-logo" ? "system/" : "")),
  );

let tA: { id: string; slug: string; name: string };
let tB: { id: string };
let adminA: TestUser;
let userA: TestUser;
let user2A: TestUser;
let userB: TestUser;
let superAdmin: TestUser;

beforeAll(async () => {
  // P13a (B4, ardışık koşu): sistem logosu süreç geneli tek kayıt ve yalnız bu dosya yazar → önceki koşudan kalan satır
  // migrator ile silinir (app'te system_settings DELETE yok). "Sistem logosu yok" ön koşulu yeniden kullanılan DB'de de sağlanır.
  await testFixtureDb().$executeRawUnsafe("DELETE FROM system_settings WHERE `key` = ?", SYSTEM_LOGO_KEY);
  app = makeApp();
  await app.ready();
  tA = await createTenant();
  tB = await createTenant();
  adminA = await createUser({ tenantId: tA.id, role: "ADMIN" });
  userA = await createUser({ tenantId: tA.id });
  user2A = await createUser({ tenantId: tA.id });
  userB = await createUser({ tenantId: tB.id });
  superAdmin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
});
afterAll(async () => {
  await app.close();
  await testFixtureDb().$disconnect();
});

describe("AC-81 firma logosu", () => {
  it("AC-81/84: Admin yükler → PNG ≤512 px; herkese açık sunum, başlıklar; /auth/me, /settings/tenant, branding, e-posta logosu", async () => {
    const s = await login(adminA);
    const res = await upload(s, "/api/v1/settings/logo", await png(), { filename: "logo.jpg", type: "image/jpeg" });
    expect(res.statusCode, res.body).toBe(200);
    const { logoUrl } = res.json<{ logoUrl: string }>();
    expect(logoUrl).toMatch(new RegExp(`^/api/v1/files/logo/${tA.id}/[A-Za-z0-9_-]{24}\\.png$`));
    expect(existsSync(fileOf(logoUrl))).toBe(true);

    const f = await get(logoUrl); // oturumsuz
    expect(f.statusCode).toBe(200);
    expect(f.headers["content-type"]).toBe("image/png");
    expect(f.headers["x-content-type-options"]).toBe("nosniff");
    expect(f.headers["content-disposition"]).toBe("inline");
    expect(f.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(f.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(f.headers["cache-control"]).toMatch(/^public, max-age=\d+$/);
    const meta = await sharp(f.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 512, 171]);
    const again = await app.inject({ method: "GET", url: logoUrl, headers: { "if-none-match": String(f.headers.etag) } });
    expect(again.statusCode).toBe(304);

    expect((await get("/api/v1/auth/me", s)).json<{ logoUrl: string }>().logoUrl).toBe(logoUrl);
    expect((await get("/api/v1/settings/tenant", s)).json<{ logoUrl: string }>().logoUrl).toBe(logoUrl);
    expect((await get(`/api/v1/public/branding?tenant=${tA.slug}`)).json()).toEqual({ name: tA.name, logoUrl });
    expect(await mailLogoUrl(db(), "https://rs.test:4450/", tA.id)).toBe(`https://rs.test:4450${logoUrl}`);
    const audit = await db().auditLog.findFirstOrThrow({
      where: { action: "tenant.logo_updated", entityId: tA.id },
      orderBy: { id: "desc" },
    });
    expect(audit).toMatchObject({ userId: adminA.id, tenantId: tA.id, result: "success" });
  });

  it("AC-81: değiştirince eski dosya silinir ve eski URL 404; kaldırınca null + sistem logosu; tekrar kaldırma idempotent", async () => {
    const s = await login(adminA);
    const first = (await upload(s, "/api/v1/settings/logo", await png())).json<{ logoUrl: string }>().logoUrl;
    const second = (await upload(s, "/api/v1/settings/logo", await png(200, 200))).json<{ logoUrl: string }>().logoUrl;
    expect(second).not.toBe(first);
    expect(existsSync(fileOf(first))).toBe(false);
    expect((await get(first)).statusCode).toBe(404);
    const removed = await del(s, "/api/v1/settings/logo");
    expect(removed.json()).toEqual({ logoUrl: null });
    expect(existsSync(fileOf(second))).toBe(false);
    expect((await get(second)).statusCode).toBe(404);
    expect((await get("/api/v1/auth/me", s)).json<{ logoUrl: string }>().logoUrl).not.toContain(tA.id);
    const before = await db().auditLog.count({ where: { action: "tenant.logo_removed", entityId: tA.id } });
    expect((await del(s, "/api/v1/settings/logo")).json()).toEqual({ logoUrl: null });
    expect(await db().auditLog.count({ where: { action: "tenant.logo_removed", entityId: tA.id } })).toBe(before);
  });

  it("AC-81: settings.edit yoksa 403; CSRF yoksa 403; oturumsuz 401", async () => {
    const s = await login(userA);
    expect((await upload(s, "/api/v1/settings/logo", await png())).statusCode).toBe(403);
    const a = await login(adminA);
    const m = multipart(await png());
    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/settings/logo",
      payload: m.payload,
      headers: { ...m.headers, cookie: a.headers.cookie, origin: a.headers.origin },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect((await upload(null, "/api/v1/settings/logo", await png())).statusCode).toBe(401);
  });
});

// --- QA-1 (AC-81): karşılama sayfası (resolve) ve istemci (talep bilgisi, bilgisayar kaydı) logosu ---
// Zincir: firma logosu → sistem logosu → `/img/logo.png`. Sistem logosu süreç geneli tek kayıttır ve yalnız bu dosyadaki
// AC-82 testi yazar (dosya içi testler sıralı). Bu yüzden "sistem logosu yok" vakası AC-82'den ÖNCE, "sistem logosuna
// düşer" vakası SONRA koşar; bu testler sistem logosunu kendisi değiştirmez (paralel dosyaların gördüğü değer oynamaz).
// Dosya açılışında önceki koşudan kalan sistem logosu satırı silinir (yeniden kullanılan DB'de de ön koşul sağlanır).
type PublicInfo = { tenant: { name: string; logoUrl: string } };
let publicIpSeq = 0;
const nextPublicIp = () => `192.0.2.${(++publicIpSeq % 250) + 1}`;

async function publicFixture() {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const ref = await createRequestSettings(t.id);
  const row = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id });
  const bindingKey = newBindingKey();
  await db().deviceBinding.create({
    data: {
      id: newId(),
      tenantId: t.id,
      customerId: null,
      keyHash: sha256Hex(bindingKey),
      clientVersion: "0.10.0",
      firstSessionId: row.id,
      lastSessionId: row.id,
      lastUsedAt: new Date(),
    },
  });
  return { t, admin, ref, row, bindingKey };
}
type PublicFx = Awaited<ReturnType<typeof publicFixture>>;

/** Üç public uçtan (karşılama resolve + istemci talep bilgisi + bilgisayar kaydı durumu) dönen `tenant.logoUrl`. */
async function publicLogos(f: PublicFx): Promise<string[]> {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers: { origin: ORIGIN },
    payload: { clientKind: "BROWSER", token: f.row.token },
    remoteAddress: nextPublicIp(),
  });
  expect(r.statusCode, r.body).toBe(200);
  const body = r.json<PublicInfo & { technician: { name: string; avatarUrl: string | null } }>();
  expect(body.tenant.name).toBe(f.t.name);
  // P15 AC-236: sapma 3 kalktı — teknisyen avatarı kısa ömürlü imzalı URL ile (oturum id'si; bağlantı token'ı yolda yok).
  const tav = body.technician.avatarUrl;
  if (tav !== null) expect(tav).toMatch(/^\/api\/v1\/public\/sessions\/[0-9A-Z]{26}\/tech-avatar\?exp=\d+&sig=[a-f0-9]{64}$/);
  const out = [body.tenant.logoUrl];
  const info = await app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${f.ref}`, remoteAddress: nextPublicIp() });
  const binding = await app.inject({
    method: "POST",
    url: "/api/v1/public/bindings/status",
    payload: { bindingKey: f.bindingKey, clientVersion: "0.10.0" },
    remoteAddress: nextPublicIp(),
  });
  for (const res of [info, binding]) {
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PublicInfo>().tenant.name).toBe(f.t.name);
    out.push(res.json<PublicInfo>().tenant.logoUrl);
  }
  return out;
}

describe("AC-81 karşılama sayfası ve istemci logosu (QA-1)", () => {
  it("AC-81: firma logosu yüklüyse resolve, talep bilgisi ve bilgisayar kaydı uçları firma logosu URL'sini döner; teknisyen avatarı resolve'da imzalı URL (AC-236); kaldırınca (sistem logosu yok) `/img/logo.png`", async () => {
    expect(await systemLogoPath(db()), "ön koşul: boş test DB'si (scripts/test-db.sh up)").toBeNull();
    const f = await publicFixture();
    expect(await publicLogos(f)).toEqual([DEFAULT_LOGO_URL, DEFAULT_LOGO_URL, DEFAULT_LOGO_URL]);
    const s = await login(f.admin);
    const up = await upload(s, "/api/v1/settings/logo", await png());
    expect(up.statusCode, up.body).toBe(200);
    const { logoUrl } = up.json<{ logoUrl: string }>();
    expect(logoUrl).toMatch(new RegExp(`^/api/v1/files/logo/${f.t.id}/[A-Za-z0-9_-]{24}\\.png$`));
    const av = await upload(s, "/api/v1/users/me/avatar", await png(300, 300));
    expect(av.statusCode, av.body).toBe(200);
    expect(await publicLogos(f)).toEqual([logoUrl, logoUrl, logoUrl]);
    expect((await get(logoUrl)).statusCode).toBe(200); // oturumsuz müşteri/istemci yükleyebilir
    expect((await del(s, "/api/v1/settings/logo")).statusCode).toBe(200);
    expect(await publicLogos(f)).toEqual([DEFAULT_LOGO_URL, DEFAULT_LOGO_URL, DEFAULT_LOGO_URL]);
  });
});

describe("AC-82 sistem logosu ve public marka", () => {
  it("AC-82: Super Admin sistem logosunu yükler; bilinmeyen/geçersiz/pasif slug aynı biçimde sistem logosunu alır; Admin 403", async () => {
    const s = await login(superAdmin);
    const res = await upload(s, "/api/v1/admin/settings/system-logo", await png());
    expect(res.statusCode, res.body).toBe(200);
    const { logoUrl } = res.json<{ logoUrl: string }>();
    expect(logoUrl).toMatch(/^\/api\/v1\/files\/system-logo\/[A-Za-z0-9_-]{24}\.png$/);
    expect((await get(logoUrl)).statusCode).toBe(200);
    const passive = await createTenant("PASSIVE");
    for (const q of ["", "?tenant=yok-boyle-firma", "?tenant=../../x", `?tenant=${passive.slug}`]) {
      const r = await get(`/api/v1/public/branding${q}`);
      expect(r.statusCode, q).toBe(200);
      expect(r.json(), q).toEqual({ name: null, logoUrl });
    }
    const second = (await upload(s, "/api/v1/admin/settings/system-logo", await png(50, 50))).json<{ logoUrl: string }>().logoUrl;
    expect((await get(logoUrl)).statusCode).toBe(404); // eski dosya silindi
    expect((await get(second)).statusCode).toBe(200);
    expect(await db().auditLog.count({ where: { action: "settings.system_logo.updated", userId: superAdmin.id } })).toBeGreaterThanOrEqual(
      2,
    );
    expect((await upload(await login(adminA), "/api/v1/admin/settings/system-logo", await png())).statusCode).toBe(403);
  });

  it("AC-82: public marka hız sınırı 60/dk/IP (61. → 429)", async () => {
    const ip = "198.51.100.77";
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await app.inject({ method: "GET", url: "/api/v1/public/branding", remoteAddress: ip })).statusCode;
    expect(last).toBe(429);
  });
});

describe("AC-81 karşılama ve istemci logosu — sistem logosu varken (QA-1)", () => {
  it("AC-81: firma logosu yokken üç uç sistem logosuna düşer; firma logosu yüklenince firma, kaldırılınca yine sistem logosu", async () => {
    const systemUrl = await systemLogoUrl(db()); // AC-82 testinin bıraktığı sistem logosu
    expect(systemUrl).toMatch(/^\/api\/v1\/files\/system-logo\/[A-Za-z0-9_-]{24}\.png$/);
    const f = await publicFixture();
    expect(await publicLogos(f)).toEqual([systemUrl, systemUrl, systemUrl]);
    const s = await login(f.admin);
    const own = (await upload(s, "/api/v1/settings/logo", await png())).json<{ logoUrl: string }>().logoUrl;
    expect(own).toContain(`/files/logo/${f.t.id}/`);
    expect(await publicLogos(f)).toEqual([own, own, own]);
    expect((await del(s, "/api/v1/settings/logo")).statusCode).toBe(200);
    expect(await publicLogos(f)).toEqual([systemUrl, systemUrl, systemUrl]);
  });
});

describe("AC-83 avatar", () => {
  it("AC-83/84: kullanıcı kendi avatarını (me) yükler → WEBP 256×256; oturumlu ve aynı tenant görür; oturumsuz 401; başka tenant 404; Super Admin görür", async () => {
    const s = await login(userA);
    const res = await upload(
      s,
      "/api/v1/users/me/avatar",
      await sharp({ create: { width: 640, height: 480, channels: 3, background: "#123456" } })
        .jpeg()
        .toBuffer(),
      { type: "image/jpeg" },
    );
    expect(res.statusCode, res.body).toBe(200);
    const { avatarUrl } = res.json<{ avatarUrl: string }>();
    expect(avatarUrl).toMatch(new RegExp(`^/api/v1/files/avatar/${tA.id}/[A-Za-z0-9_-]{24}\\.webp$`));
    const own = await get(avatarUrl, s);
    expect(own.statusCode).toBe(200);
    expect(own.headers["cache-control"]).toBe("private, no-cache"); // B-P12-4: her kullanımda yeniden doğrulama
    // ETag ile 304 yalnız yetki yeniden denetlendikten sonra: oturumsuz 401, başka tenant 404 (önbellek koşulu yetkiyi atlamaz)
    const etag = String(own.headers.etag);
    expect((await app.inject({ method: "GET", url: avatarUrl, headers: { ...s.headers, "if-none-match": etag } })).statusCode).toBe(304);
    expect((await app.inject({ method: "GET", url: avatarUrl, headers: { "if-none-match": etag } })).statusCode).toBe(401);
    expect(own.headers["cross-origin-resource-policy"]).toBe("same-origin");
    const meta = await sharp(own.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
    expect((await get(avatarUrl, await login(user2A))).statusCode).toBe(200);
    expect((await get(avatarUrl)).statusCode).toBe(401);
    expect((await get(avatarUrl, await login(userB))).statusCode).toBe(404);
    expect((await get(avatarUrl, await login(superAdmin))).statusCode).toBe(200);
    expect((await get("/api/v1/auth/me", s)).json<{ user: { avatarUrl: string } }>().user.avatarUrl).toBe(avatarUrl);
    const list = (await get("/api/v1/users?status=all&pageSize=100", await login(adminA))).json<{
      items: { id: string; avatarUrl: string | null }[];
    }>();
    expect(list.items.find((u) => u.id === userA.id)?.avatarUrl).toBe(avatarUrl);
    expect(await db().auditLog.count({ where: { action: "user.avatar_updated", entityId: userA.id, userId: userA.id } })).toBe(1);
  });

  it("AC-83: Admin aynı tenant kullanıcısının avatarını değiştirir/kaldırır; users.edit'siz kullanıcı başkasınınkini 403; başka tenant 404", async () => {
    const a = await login(adminA);
    const up = await upload(a, `/api/v1/users/${user2A.id}/avatar`, await png(300, 300));
    expect(up.statusCode, up.body).toBe(200);
    const url = up.json<{ avatarUrl: string }>().avatarUrl;
    expect((await upload(await login(userA), `/api/v1/users/${user2A.id}/avatar`, await png())).statusCode).toBe(403);
    expect((await upload(await login(userB), `/api/v1/users/${user2A.id}/avatar`, await png())).statusCode).toBe(403);
    const adminB = await createUser({ tenantId: tB.id, role: "ADMIN" });
    expect((await upload(await login(adminB), `/api/v1/users/${user2A.id}/avatar`, await png())).statusCode).toBe(404);
    expect((await del(await login(adminB), `/api/v1/users/${user2A.id}/avatar`)).statusCode).toBe(404);
    expect((await del(a, `/api/v1/users/${user2A.id}/avatar`)).json()).toEqual({ avatarUrl: null });
    expect(existsSync(fileOf(url))).toBe(false);
    expect((await get(url, a)).statusCode).toBe(404);
    const rows = await db().auditLog.findMany({
      where: { entityId: user2A.id, action: { in: ["user.avatar_updated", "user.avatar_removed"] } },
    });
    expect(rows.map((r) => r.action).sort()).toEqual(["user.avatar_removed", "user.avatar_updated"]);
  });

  it("AC-83: Super Admin avatarı `system/` klasörüne yazılır; tenant kullanıcısı göremez (404)", async () => {
    const s = await login(superAdmin);
    const url = (await upload(s, "/api/v1/users/me/avatar", await png(64, 64))).json<{ avatarUrl: string }>().avatarUrl;
    expect(url).toMatch(/^\/api\/v1\/files\/avatar\/system\//);
    expect((await get(url, s)).statusCode).toBe(200);
    expect((await get(url, await login(adminA))).statusCode).toBe(404);
  });
});

describe("AC-84 yükleme güvenliği", () => {
  it("AC-84: SVG, uzantısı .png yapılmış SVG/HTML, bozuk PNG → 400 INVALID_IMAGE + upload.rejected audit; dosya yazılmaz", async () => {
    const u = await createUser({ tenantId: tA.id });
    const s = await login(u);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from("<html><body><script>alert(document.cookie)</script></body></html>");
    const broken = (await png()).subarray(0, 100);
    for (const [data, filename, type] of [
      [svg, "a.svg", "image/svg+xml"],
      [svg, "a.png", "image/png"],
      [html, "a.png", "image/png"],
      [broken, "a.png", "image/png"],
    ] as const) {
      const r = await upload(s, "/api/v1/users/me/avatar", data, { filename, type });
      expect(r.statusCode, filename).toBe(400);
      expect(r.json<{ error: { code: string } }>().error.code).toBe("INVALID_IMAGE");
    }
    expect(await db().auditLog.count({ where: { action: "upload.rejected", userId: u.id, result: "fail" } })).toBe(4);
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id }, select: { avatarPath: true } })).avatarPath).toBeNull();
  });

  it("AC-84: 2 MB + 1 bayt → 413 PAYLOAD_TOO_LARGE; yanlış alan adı / dosyasız / JSON gövde → 400", async () => {
    const s = await login(await createUser({ tenantId: tA.id }));
    const big = Buffer.concat([await png(10, 10), Buffer.alloc(UPLOAD_MAX_BYTES + 1 - (await png(10, 10)).length)]);
    expect(big.length).toBe(UPLOAD_MAX_BYTES + 1);
    const r = await upload(s, "/api/v1/users/me/avatar", big);
    expect(r.statusCode).toBe(413);
    expect(r.json<{ error: { code: string } }>().error.code).toBe("PAYLOAD_TOO_LARGE");
    expect((await upload(s, "/api/v1/users/me/avatar", await png(), { field: "resim" })).statusCode).toBe(400);
    const json = await app.inject({ method: "POST", url: "/api/v1/users/me/avatar", payload: { file: "x" }, headers: s.headers });
    expect(json.statusCode).toBe(400);
    // multipart başka uçlarda kabul edilmez
    const m = multipart(await png());
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/v1/auth/me/preferences",
          payload: m.payload,
          headers: { ...s.headers, ...m.headers },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("AC-84: path traversal ve biçim dışı dosya parametreleri 404; logo ucu avatarı, avatar ucu logoyu sunmaz", async () => {
    const s = await login(adminA);
    const logo = (await upload(s, "/api/v1/settings/logo", await png())).json<{ logoUrl: string }>().logoUrl;
    const avatar = (await upload(s, "/api/v1/users/me/avatar", await png())).json<{ avatarUrl: string }>().avatarUrl;
    for (const url of [
      `/api/v1/files/logo/${tA.id}/..%2F..%2Fetc%2Fpasswd`,
      `/api/v1/files/logo/..%2F${tA.id}/${"a".repeat(20)}.png`,
      `/api/v1/files/logo/${tA.id}/${"a".repeat(20)}.svg`,
      `/api/v1/files/system-logo/..%2F..%2Fpackage.json`,
      avatar.replace("/avatar/", "/logo/"),
      logo.replace("/logo/", "/avatar/"),
    ]) {
      expect((await get(url, s)).statusCode, url).toBe(404);
    }
  });

  it("AC-84: yükleme hız sınırı 20/sa/kullanıcı (21. → 429)", async () => {
    const s = await login(await createUser({ tenantId: tA.id }));
    const tiny = await png(16, 16); // B-P12-2: kenar ≥ 16 px
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await upload(s, "/api/v1/users/me/avatar", tiny)).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});

describe("AC-85 tema", () => {
  const cookieOf = (res: { cookies: { name: string; value: string; httpOnly?: boolean; sameSite?: string; maxAge?: number }[] }) =>
    res.cookies.find((c) => c.name === THEME_COOKIE);

  it("AC-85: PATCH /auth/me/preferences → DB'ye yazılır, rs_theme çerezi (HttpOnly değil, Lax, 1 yıl); başka cihazda (yeni oturum) aynı tema", async () => {
    const u = await createUser({ tenantId: tA.id });
    const first = await app.inject(loginRequest(u.email, u.password, { remoteAddress: nextIp() }));
    expect(cookieOf(first)?.value).toBe("system");
    const s = await login(u);
    const res = await app.inject({ method: "PATCH", url: "/api/v1/auth/me/preferences", payload: { theme: "DARK" }, headers: s.headers });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ theme: "DARK" });
    const c = cookieOf(res);
    expect(c).toMatchObject({ value: "dark", sameSite: "Lax", maxAge: 31_536_000 });
    expect(c?.httpOnly).toBeFalsy();
    const other = await login(u); // ikinci cihaz
    const me = await get("/api/v1/auth/me", other);
    expect(me.json<{ user: { theme: string } }>().user.theme).toBe("DARK");
    expect(cookieOf(me)?.value).toBe("dark");
    expect(
      (await app.inject(loginRequest(u.email, u.password, { remoteAddress: nextIp() }))).cookies.find((x) => x.name === THEME_COOKIE)
        ?.value,
    ).toBe("dark");
    // aynı değer → audit yok; değişim → tek satır
    await app.inject({ method: "PATCH", url: "/api/v1/auth/me/preferences", payload: { theme: "DARK" }, headers: s.headers });
    const rows = await db().auditLog.findMany({ where: { action: "user.theme_changed", entityId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.newValue).toEqual({ theme: "DARK" });
  });

  it("AC-85: geçersiz tema / ek alan 400; oturumsuz 401; CSRF'siz 403", async () => {
    const s = await login(userA);
    for (const payload of [{ theme: "dark" }, { theme: "BLUE" }, { theme: "DARK", x: 1 }, {}]) {
      expect((await app.inject({ method: "PATCH", url: "/api/v1/auth/me/preferences", payload, headers: s.headers })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PATCH", url: "/api/v1/auth/me/preferences", payload: { theme: "DARK" } })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/v1/auth/me/preferences",
          payload: { theme: "DARK" },
          headers: { cookie: s.headers.cookie, origin: s.headers.origin },
        })
      ).statusCode,
    ).toBe(403);
  });
});
