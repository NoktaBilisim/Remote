// P12 veri katmanı (dba): logo/avatar yolu CHECK'leri, system_settings `system_logo` anahtarı, tema CHECK'i
// (AC-81..85, T16). Migration 20261113120000_p12_branding. Tüm denemeler uygulamanın `app` kullanıcısıyla
// (TEST_DATABASE_URL); system_settings paylaşılan anahtar satırı geri alınan TX içinde denenir.
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { createTenant, createUser, testDb } from "../helpers/app.ts";

const app = () => testDb();

async function errorText(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "reddedilmeliydi").toBeInstanceOf(Error);
  return `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
}
const rejectsWith = async (p: Promise<unknown>, chk: string) => expect(await errorText(p)).toMatch(new RegExp(chk));

const RND = "Ab_-0123456789xyz"; // 17 karakter [A-Za-z0-9_-]

const setLogo = (tenantId: string, path: string | null) => app().$executeRawUnsafe("UPDATE tenants SET logo_path = ? WHERE id = ?", path, tenantId);
const setAvatar = (userId: string, path: string | null) => app().$executeRawUnsafe("UPDATE users SET avatar_path = ? WHERE id = ?", path, userId);

/** Geçersiz yol örnekleri; `own` satırın kendi öndeki (tenant id veya `system`). */
const badPaths = (own: string, other: string) => [
  `${other}/${RND}.png`, // başka tenant klasörü
  `${own}/../${RND}.png`,
  `${own}/..${RND}.png`,
  `../${own}/${RND}.png`,
  `/${own}/${RND}.png`,
  `uploads/${own}/${RND}.png`,
  `${own}/sub/${RND}.png`,
  `${own}\\${RND}.png`,
  `${own}/${RND}.svg`,
  `${own}/${RND}.PNG`,
  `${own}/${RND}.jpeg`,
  `${own}/${RND}.png.svg`,
  `${own}/.${RND}.png`,
  `${own}/${RND}.png\n`,
  `${own}/${RND} .png`,
  `${own}/abcdefghijklmno.png`, // 15 karakter: rastgele kısım çok kısa
  `${own}/${"a".repeat(101)}.png`,
  `${own}/${RND}ı.png`, // ASCII dışı
  `${own}/${RND}`,
  `${own}/`,
  "",
];

describe("P12 tenants.logo_path CHECK (AC-81, AC-84)", () => {
  it("geçerli: kendi id öndeki + rastgele ad + png/jpg/webp; NULL (kaldırma)", async () => {
    const t = await createTenant();
    for (const ext of ["png", "jpg", "webp"]) expect(await setLogo(t.id, `${t.id}/${RND}.${ext}`)).toBe(1);
    expect(await setLogo(t.id, `${t.id}/${"Z".repeat(100)}.png`)).toBe(1);
    expect(await setLogo(t.id, `${t.id}/01JD0000000000000000000000.webp`)).toBe(1); // ULID ad
    expect(await setLogo(t.id, null)).toBe(1);
  });

  it("geçersiz: başka tenant, `..`, alt dizin, mutlak yol, SVG/büyük harf uzantı, satır sonu, kısa ad, system öndeki", async () => {
    const [t, other] = await Promise.all([createTenant(), createTenant()]);
    for (const p of [...badPaths(t.id, other.id), `system/${RND}.png`, `${t.id.toLowerCase()}/${RND}.png`]) {
      await rejectsWith(setLogo(t.id, p), "tenants_logo_path_chk");
    }
    expect((await app().tenant.findUniqueOrThrow({ where: { id: t.id } })).logoPath).toBeNull();
  });
});

describe("P12 users.avatar_path CHECK (AC-83, AC-84)", () => {
  it("tenant kullanıcısı: yalnız kendi tenant klasörü", async () => {
    const [t, other] = await Promise.all([createTenant(), createTenant()]);
    const u = await createUser({ tenantId: t.id });
    expect(await setAvatar(u.id, `${t.id}/${RND}.webp`)).toBe(1);
    for (const p of [...badPaths(t.id, other.id), `system/${RND}.png`]) await rejectsWith(setAvatar(u.id, p), "users_avatar_path_chk");
    expect((await app().user.findUniqueOrThrow({ where: { id: u.id } })).avatarPath).toBe(`${t.id}/${RND}.webp`);
    expect(await setAvatar(u.id, null)).toBe(1);
  });

  it("Super Admin (tenant_id NULL): yalnız `system/` öndeki", async () => {
    const t = await createTenant();
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    expect(await setAvatar(sa.id, `system/${RND}.jpg`)).toBe(1);
    for (const p of [...badPaths("system", t.id), `SYSTEM/${RND}.png`, `System/${RND}.png`]) await rejectsWith(setAvatar(sa.id, p), "users_avatar_path_chk");
    expect(await setAvatar(sa.id, null)).toBe(1);
  });

  it("avatar varken kullanıcının tenant'ı değiştirilemez (yol satırın tenant'ına bağlı)", async () => {
    const [t, other] = await Promise.all([createTenant(), createTenant()]);
    const u = await createUser({ tenantId: t.id });
    expect(await setAvatar(u.id, `${t.id}/${RND}.png`)).toBe(1);
    await rejectsWith(app().$executeRawUnsafe("UPDATE users SET tenant_id = ? WHERE id = ?", other.id, u.id), "users_avatar_path_chk");
  });
});

describe("P12 users.theme CHECK (AC-85, ADR-0014)", () => {
  it("LIGHT/DARK/SYSTEM kabul; harf/boşluk varyantı ret; varsayılan SYSTEM", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    expect((await app().user.findUniqueOrThrow({ where: { id: u.id } })).theme).toBe("SYSTEM");
    for (const v of ["LIGHT", "DARK", "SYSTEM"]) expect(await app().$executeRawUnsafe("UPDATE users SET theme = ? WHERE id = ?", v, u.id)).toBe(1);
    for (const v of ["dark", "Dark", "DARK ", "AUTO", ""]) await rejectsWith(app().$executeRawUnsafe("UPDATE users SET theme = ? WHERE id = ?", v, u.id), "users_theme_chk");
  });
});

const UPSERT = "INSERT INTO system_settings (`key`, value_json, secret_enc, updated_at) VALUES (?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), secret_enc = VALUES(secret_enc), updated_at = NOW(3)";

async function upsert(key: string, value: unknown, secret: Buffer | null = null) {
  const ROLLBACK = new Error("rollback");
  let out: unknown = null;
  await app().$transaction(async (tx: Pick<Db, "$executeRawUnsafe">) => {
    out = await tx.$executeRawUnsafe(UPSERT, key, value === null ? null : JSON.stringify(value), secret);
    throw ROLLBACK;
  }).catch((e: unknown) => { if (e !== ROLLBACK) throw e; });
  return out;
}
const ok = async (key: string, value: unknown) => expect(await upsert(key, value)).toBeGreaterThanOrEqual(1);
const bad = (key: string, value: unknown, chk: string, secret: Buffer | null = null) => rejectsWith(upsert(key, value, secret), chk);

describe("P12 system_settings `system_logo` (AC-81, AC-82)", () => {
  it("geçerli: {path: system/<rastgele>.<png|jpg|webp>}, secret_enc NULL", async () => {
    for (const ext of ["png", "jpg", "webp"]) await ok("system_logo", { path: `system/${RND}.${ext}` });
  });

  it("anahtar ikili (ADR-0014); P11 anahtarları geçerli kalır", async () => {
    for (const k of ["SYSTEM_LOGO", "System_logo", "system_logo ", "system-logo", "logo", "WHATSAPP", "whatsapp ", "whats_app"]) await bad(k, { path: `system/${RND}.png` }, "system_settings_key_chk");
    await ok("turn", { urls: ["stun:stun.example.com:3478"] });
  });

  it("şema: path zorunlu ve tek alan, yalnız system/ öndeki, gizli değer yok", async () => {
    const C = "system_settings_system_logo_chk";
    const t = await createTenant();
    await bad("system_logo", null, C);
    await bad("system_logo", {}, C);
    await bad("system_logo", { path: `system/${RND}.png`, url: "https://evil.example/x.png" }, C);
    await bad("system_logo", { path: `system/${RND}.png` }, C, Buffer.alloc(61, 7)); // secret_enc yasak
    await bad("system_logo", { path: 42 }, C);
    for (const p of badPaths("system", t.id)) await bad("system_logo", { path: p }, C);
  });
});

describe("P12 CHECK tanımları", () => {
  it("üç yeni CHECK var; key CHECK'i system_logo'yu kapsıyor", async () => {
    const rows = await app().$queryRaw<{ name: string; clause: string }[]>`
      SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN ('tenants_logo_path_chk', 'users_avatar_path_chk', 'system_settings_system_logo_chk', 'system_settings_key_chk')`;
    expect(rows.map((r) => r.name).sort()).toEqual(["system_settings_key_chk", "system_settings_system_logo_chk", "tenants_logo_path_chk", "users_avatar_path_chk"]);
    expect(rows.find((r) => r.name === "system_settings_key_chk")?.clause).toContain("system_logo");
  });
});
