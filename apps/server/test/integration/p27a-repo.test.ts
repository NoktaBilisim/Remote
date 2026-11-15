// P27a-K2: güvenilir cihaz deposu (mimari-p27a §3, §3.4, §5.1–5.2; AC-325, 328, 329, 330, 331, 332, 333, 334, 335b).
// Gerçek MySQL (app kullanıcısı); her test kendi firma/kullanıcısını üretir.
import { TRUSTED_DEVICE_DAYS, TRUSTED_DEVICE_MAX_PER_USER } from "@remote/contracts/api/auth";
import { afterAll, describe, expect, it } from "vitest";
import {
  countForUser,
  createTrustedDevice,
  deleteExpired,
  deleteForTenant,
  deleteForUser,
  findById,
  listForUser,
  rotate,
  type CreateTrustedDeviceInput,
} from "../../src/auth/trusted-device-repo.ts";
import { hashTrustedDeviceSecret, newTrustedDeviceSecret } from "../../src/auth/trusted-device.ts";
import { newId } from "../../src/lib/ids.ts";
import { createTenant, createUser, testDb, type TestUser } from "../helpers/app.ts";

const db = testDb();
const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(async () => {
  await db.$disconnect();
});

async function tenantUser(): Promise<{ tenantId: string; user: TestUser }> {
  const t = await createTenant();
  return { tenantId: t.id, user: await createUser({ tenantId: t.id, role: "ADMIN" }) };
}

function input(userId: string, o: Partial<CreateTrustedDeviceInput> = {}): CreateTrustedDeviceInput {
  return {
    userId,
    tokenHash: hashTrustedDeviceSecret(newTrustedDeviceSecret()),
    uaSummary: "Chrome · Windows",
    ip: "203.0.113.7",
    now: new Date(),
    ...o,
  };
}

const create = (i: CreateTrustedDeviceInput) => db.$transaction((tx) => createTrustedDevice(tx, i));

describe("P27a-K2 trusted-device-repo", () => {
  it("AC-325/AC-333 oluşturma: yalnız özet saklanır, tenant_id kullanıcıdan, expires_at = oluşturma + 30 gün", async () => {
    const { tenantId, user } = await tenantUser();
    const secret = newTrustedDeviceSecret();
    const now = new Date();
    const created = await create(input(user.id, { tokenHash: hashTrustedDeviceSecret(secret), now }));
    expect(created.tenantId).toBe(tenantId);
    expect(created.evicted).toBe(0);
    const row = await findById(db, created.id);
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(user.id);
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.tokenHash).toBe(hashTrustedDeviceSecret(secret));
    expect(row?.tokenHash).not.toContain(secret);
    expect(row?.lastUsedAt).toBeNull();
    expect(row?.expiresAt.getTime()).toBe(now.getTime() + TRUSTED_DEVICE_DAYS * DAY_MS);
    expect(row?.expiresAt.getTime()).toBe(created.expiresAt.getTime());
    const raw = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM trusted_devices WHERE token_hash = ${secret}`;
    expect(Number(raw[0]?.n)).toBe(0);
  });

  it("AC-331 (K-P27a-2) firmasız hesap (Super Admin) için satır oluşmaz", async () => {
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    await expect(create(input(sa.id))).rejects.toThrow();
    expect(await db.trustedDevice.count({ where: { userId: sa.id } })).toBe(0);
  });

  it("AC-332 11. cihaz en eskiyi düşürür (evicted = 1, kalan 10)", async () => {
    const { user } = await tenantUser();
    const base = Date.now() - 60_000;
    const ids: string[] = [];
    for (let i = 0; i < TRUSTED_DEVICE_MAX_PER_USER; i++) {
      const c = await create(input(user.id, { now: new Date(base + i * 1000) }));
      expect(c.evicted).toBe(0);
      ids.push(c.id);
    }
    const eleventh = await create(input(user.id, { now: new Date(base + 20_000) }));
    expect(eleventh.evicted).toBe(1);
    expect(await countForUser(db, user.id, new Date())).toBe(TRUSTED_DEVICE_MAX_PER_USER);
    expect(await findById(db, ids[0] ?? "")).toBeNull();
    expect(await findById(db, eleventh.id)).not.toBeNull();
  });

  it("AC-332 paralel iki oluşturmada da sınır aşılmaz (kullanıcı satırı kilidi)", async () => {
    const { user } = await tenantUser();
    const base = Date.now() - 60_000;
    for (let i = 0; i < TRUSTED_DEVICE_MAX_PER_USER - 1; i++) await create(input(user.id, { now: new Date(base + i * 1000) }));
    const results = await Promise.all([create(input(user.id)), create(input(user.id))]);
    expect(results.reduce((n, r) => n + r.evicted, 0)).toBe(1);
    expect(await db.trustedDevice.count({ where: { userId: user.id } })).toBe(TRUSTED_DEVICE_MAX_PER_USER);
  });

  it("AC-335b replaceId: aynı tarayıcının kendi eski satırı silinir, başka kullanıcınınkine dokunulmaz", async () => {
    const a = await tenantUser();
    const b = await tenantUser();
    const oldA = await create(input(a.user.id));
    const rowB = await create(input(b.user.id));
    const newA = await create(input(a.user.id, { replaceId: oldA.id }));
    expect(await findById(db, oldA.id)).toBeNull();
    expect(await findById(db, newA.id)).not.toBeNull();
    await create(input(a.user.id, { replaceId: rowB.id }));
    expect(await findById(db, rowB.id)).not.toBeNull();
  });

  it("AC-335b findById: olmayan id null", async () => {
    expect(await findById(db, newId())).toBeNull();
  });

  it("AC-335b döndürme: koşullu UPDATE özeti/son kullanımı/IP'yi yeniler, expires_at sabit; eski özetle ikinci kez false", async () => {
    const { user } = await tenantUser();
    const oldHash = hashTrustedDeviceSecret(newTrustedDeviceSecret());
    const c = await create(input(user.id, { tokenHash: oldHash }));
    const newHash = hashTrustedDeviceSecret(newTrustedDeviceSecret());
    const at = new Date(Date.now() + 5_000);
    expect(await rotate(db, { id: c.id, oldHash, newHash, ip: "198.51.100.9", now: at })).toBe(true);
    const row = await findById(db, c.id);
    expect(row?.tokenHash).toBe(newHash);
    expect(row?.lastUsedAt?.getTime()).toBe(at.getTime());
    expect(row?.ip).toBe("198.51.100.9");
    expect(row?.expiresAt.getTime()).toBe(c.expiresAt.getTime());
    const third = hashTrustedDeviceSecret(newTrustedDeviceSecret());
    expect(await rotate(db, { id: c.id, oldHash, newHash: third, ip: "198.51.100.10", now: new Date() })).toBe(false);
    expect((await findById(db, c.id))?.tokenHash).toBe(newHash);
  });

  it("AC-335b paralel iki döndürmede (aynı nesil) yalnız biri başarılı", async () => {
    const { user } = await tenantUser();
    const oldHash = hashTrustedDeviceSecret(newTrustedDeviceSecret());
    const c = await create(input(user.id, { tokenHash: oldHash }));
    const go = () =>
      db.$transaction((tx) =>
        rotate(tx, { id: c.id, oldHash, newHash: hashTrustedDeviceSecret(newTrustedDeviceSecret()), ip: "203.0.113.8", now: new Date() }),
      );
    const r = await Promise.all([go(), go()]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it("AC-329 liste: en yeni önce, süresi dolan yok, özet seçilmez; cihazı olmayan kullanıcıda boş", async () => {
    const { user } = await tenantUser();
    const other = await tenantUser();
    expect(await listForUser(db, user.id, new Date())).toEqual([]);
    const now = Date.now();
    const old = await create(input(user.id, { now: new Date(now - 10_000) }));
    const fresh = await create(input(user.id, { now: new Date(now - 5_000) }));
    await create(input(user.id, { now: new Date(now - (TRUSTED_DEVICE_DAYS + 1) * DAY_MS) }));
    await create(input(other.user.id));
    const list = await listForUser(db, user.id, new Date());
    expect(list.map((r) => r.id)).toEqual([fresh.id, old.id]);
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(["createdAt", "expiresAt", "id", "ip", "lastUsedAt", "uaSummary"]);
  });

  it("AC-330 sayı: süresi dolmamış satırlar; cihazsız kullanıcı 0", async () => {
    const { user } = await tenantUser();
    expect(await countForUser(db, user.id, new Date())).toBe(0);
    await create(input(user.id));
    await create(input(user.id, { now: new Date(Date.now() - (TRUSTED_DEVICE_DAYS + 1) * DAY_MS) }));
    expect(await countForUser(db, user.id, new Date())).toBe(1);
  });

  it("AC-328/AC-329 tekil silme: kendi satırı 1, başka kullanıcının satırı 0 (dokunulmaz)", async () => {
    const a = await tenantUser();
    const b = await tenantUser();
    const rowA = await create(input(a.user.id));
    const rowB = await create(input(b.user.id));
    expect(await deleteForUser(db, a.user.id, rowB.id)).toBe(0);
    expect(await findById(db, rowB.id)).not.toBeNull();
    expect(await deleteForUser(db, a.user.id, rowA.id)).toBe(1);
    expect(await deleteForUser(db, a.user.id, rowA.id)).toBe(0);
  });

  it("AC-328 kullanıcının tümü (süresi dolanlar dahil) silinir; diğer kullanıcı etkilenmez", async () => {
    const a = await tenantUser();
    const b = await tenantUser();
    await create(input(a.user.id));
    await create(input(a.user.id, { now: new Date(Date.now() - (TRUSTED_DEVICE_DAYS + 1) * DAY_MS) }));
    await create(input(b.user.id));
    expect(await deleteForUser(db, a.user.id)).toBe(2);
    expect(await deleteForUser(db, a.user.id)).toBe(0);
    expect(await db.trustedDevice.count({ where: { userId: b.user.id } })).toBe(1);
  });

  it("AC-328/AC-331 firma geneli silme yalnız o firmanın satırlarını siler", async () => {
    const t = await createTenant();
    const u1 = await createUser({ tenantId: t.id, role: "ADMIN" });
    const u2 = await createUser({ tenantId: t.id });
    const other = await tenantUser();
    await create(input(u1.id));
    await create(input(u2.id));
    await create(input(other.user.id));
    expect(await deleteForTenant(db, t.id)).toBe(2);
    expect(await db.trustedDevice.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await db.trustedDevice.count({ where: { userId: other.user.id } })).toBe(1);
  });

  it("AC-334 saklama: expires_at < kesme anı olanlar parti sınırıyla silinir", async () => {
    const { user } = await tenantUser();
    // Kesme anı 2000 yılı: paralel test dosyalarının satırları etkilenmez.
    const longAgo = new Date(Date.UTC(2000, 0, 1));
    for (let i = 0; i < 3; i++) await create(input(user.id, { now: new Date(longAgo.getTime() + i * 1000) }));
    const live = await create(input(user.id));
    const cutoff = new Date(longAgo.getTime() + (TRUSTED_DEVICE_DAYS + 1) * DAY_MS);
    expect(await deleteExpired(db, cutoff, 2)).toBe(2);
    expect(await deleteExpired(db, cutoff, 2)).toBe(1);
    expect(await deleteExpired(db, cutoff, 2)).toBe(0);
    expect(await findById(db, live.id)).not.toBeNull();
  });
});
