import { effectivePermissions, PERMISSION_KEYS, PERMISSION_MODULES, type PermissionKey } from "@remote/contracts/permissions";
import { describe, expect, it } from "vitest";
import { buildCreateUser, buildTenant, buildUpdateUser, splitServerFields, suggestSlug, userDraftOf } from "./form";
import {
  actionLabel,
  allKeys,
  applyRoleDefaults,
  buildMatrix,
  changedKeys,
  groupLocked,
  forbiddenPermLabels,
  groupState,
  lockedKeys,
  moduleLabel,
  normalize,
  roleDefaults,
  toggleGroup,
} from "./permissions";
import { parseUserParams, usersApiPath, usersHref } from "./query";

describe("yetki matrisi (AC-71, AC-72)", () => {
  it("tüm modüller ve anahtarlar tek tanımdan gelir", () => {
    const rows = buildMatrix();
    expect(rows.map((r) => r.module)).toEqual(PERMISSION_MODULES.map((m) => m.key));
    expect(rows.flatMap((r) => r.keys)).toEqual([...PERMISSION_KEYS]);
    expect(allKeys()).toEqual([...PERMISSION_KEYS]);
  });

  it("standart eylemler sütuna, diğerleri 'Diğer'e düşer; olmayan eylem null", () => {
    const s = buildMatrix().find((r) => r.module === "sessions")!;
    expect(s.cells).toEqual({
      view: "sessions.view",
      create: "sessions.create",
      edit: "sessions.edit",
      delete: "sessions.delete",
      export: null,
    });
    expect(s.other).toEqual([
      { key: "sessions.terminate", action: "terminate" },
      { key: "sessions.send_link", action: "send_link" },
    ]);
    const rc = buildMatrix().find((r) => r.module === "remote_control")!;
    expect(Object.values(rc.cells).every((v) => v === null)).toBe(true);
    expect(rc.other.map((o) => o.key)).toEqual(["remote_control.use"]);
  });

  it("AC-72: tanıma eklenen yeni modül/eylem başka değişiklik olmadan matriste görünür (etiket yoksa anahtar)", () => {
    const mods = [...PERMISSION_MODULES, { key: "reports_x", actions: ["view", "export", "schedule"] }];
    const row = buildMatrix(mods).at(-1)!;
    expect(row.module).toBe("reports_x");
    expect(row.cells.view).toBe("reports_x.view");
    expect(row.cells.export).toBe("reports_x.export");
    expect(row.other).toEqual([{ key: "reports_x.schedule", action: "schedule" }]);
    expect(moduleLabel("reports_x")).toBe("reports_x");
    expect(actionLabel("schedule")).toBe("schedule");
    expect(roleDefaults("ADMIN", mods)["reports_x.schedule"]).toBe(true);
    expect(normalize({}, mods)["reports_x.view"]).toBe(false);
  });

  it("bilinen modül ve eylemlerin Türkçe etiketi var", () => {
    for (const m of PERMISSION_MODULES) {
      expect(moduleLabel(m.key)).not.toBe(m.key);
      for (const a of m.actions) expect(actionLabel(a)).not.toBe(a);
    }
  });
});

describe("varsayılanlar ve kilit (AC-73)", () => {
  it("Admin tümü açık, User tümü kapalı", () => {
    expect(Object.values(roleDefaults("ADMIN")).every(Boolean)).toBe(true);
    expect(Object.values(roleDefaults("USER")).some(Boolean)).toBe(false);
  });

  it("işlemi yapanın sahip olmadığı yetkiler kilitli; Super Admin'de kilit yok", () => {
    const admin = lockedKeys({ role: "ADMIN", permissions: PERMISSION_KEYS.filter((k) => k !== "audit.export") });
    expect([...admin]).toEqual(["audit.export"]);
    expect(lockedKeys({ role: "SUPER_ADMIN", permissions: [] }).size).toBe(0);
  });

  it("normalize: eksik anahtar false, tanım dışı anahtar atılır", () => {
    const n = normalize({ "sessions.view": true, "eski.anahtar": true } as Record<string, boolean>);
    expect(n["sessions.view"]).toBe(true);
    expect(n["users.view"]).toBe(false);
    expect("eski.anahtar" in n).toBe(false);
  });

  it("rol değişince kilitsiz yetkiler varsayılana döner, kilitli olan korunur", () => {
    const locked = new Set(["audit.export"]);
    const start = { ...roleDefaults("USER"), "audit.export": false, "sessions.view": true };
    const next = applyRoleDefaults("ADMIN", start, locked);
    expect(next["audit.export"]).toBe(false);
    expect(next["users.edit"]).toBe(true);
    expect(applyRoleDefaults("USER", next, locked)["users.edit"]).toBe(false);
  });
});

describe("403 yetki mesajı (AC-73)", () => {
  it("fields['permissions.<anahtar>'] → etiket", () => {
    expect(forbiddenPermLabels({ "permissions.audit.export": "x", email: "y" })).toEqual(["Audit log — Dışa aktar"]);
    expect(forbiddenPermLabels(undefined)).toEqual([]);
  });
});

describe("grup Tümünü aç/kapat", () => {
  const keys = ["sessions.view", "sessions.create", "sessions.terminate"];
  it("durum: hepsi açık true, hiçbiri false, karışık mixed", () => {
    expect(groupState(keys, { "sessions.view": true, "sessions.create": true, "sessions.terminate": true })).toBe(true);
    expect(groupState(keys, {})).toBe(false);
    expect(groupState(keys, { "sessions.view": true })).toBe("mixed");
  });
  it("karışıkta hepsini açar, tümü açıkken kapatır; kilitli anahtara dokunmaz", () => {
    const locked = new Set(["sessions.terminate"]);
    const on = toggleGroup(keys, { "sessions.view": true }, locked);
    expect(on).toMatchObject({ "sessions.view": true, "sessions.create": true });
    expect(on["sessions.terminate"]).toBeUndefined();
    const off = toggleGroup(keys, on, locked);
    expect(off).toMatchObject({ "sessions.view": false, "sessions.create": false });
    const lockedOn = toggleGroup(keys, { "sessions.terminate": true }, locked);
    expect(lockedOn["sessions.terminate"]).toBe(true);
  });
  it("tüm anahtarları kilitli grup değişmez ve kilitli sayılır", () => {
    const locked = new Set(keys);
    const s = { "sessions.view": true };
    expect(toggleGroup(keys, s, locked)).toBe(s);
    expect(groupLocked(keys, locked)).toBe(true);
  });
  it("changedKeys yalnız değeri farklı anahtarları verir", () => {
    expect(changedKeys({ a: true, b: false }, { a: true, b: true, c: false })).toEqual(["b"]);
  });
});

describe("kullanıcı formu", () => {
  it("oluşturma: alan bazlı Türkçe hata, e-posta küçük harfe iner", () => {
    const bad = buildCreateUser({ fullName: " A ", email: "x", role: "USER" }, {});
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.fullName).toMatch(/en az 2/);
      expect(bad.errors.email).toBe("E-posta adresi geçersiz");
    }
    const ok = buildCreateUser({ fullName: "Can Aydın", email: " Can@Ornek.COM ", role: "ADMIN" }, { "sessions.view": true });
    expect(ok.ok && ok.body).toEqual({
      fullName: "Can Aydın",
      email: "can@ornek.com",
      role: "ADMIN",
      permissions: { "sessions.view": true },
    });
  });

  it("güncelleme: yalnız değişen alanlar ve değişen yetki anahtarları", () => {
    const base = userDraftOf({ fullName: "Can Aydın", email: "can@ornek.com", role: "USER" });
    const basePerms = normalize({ "sessions.view": true });
    const none = buildUpdateUser(base, base, basePerms, basePerms);
    expect(none.ok && none.body).toEqual({});
    const r = buildUpdateUser(
      { ...base, fullName: "Can Aydın Yılmaz" },
      base,
      { ...basePerms, "audit.view": true, "sessions.view": false },
      basePerms,
    );
    expect(r.ok && r.body).toEqual({ fullName: "Can Aydın Yılmaz", permissions: { "sessions.view": false, "audit.view": true } });
  });

  it("rol değişince (USER→ADMIN) kilitli anahtar açıkça false gider; sunucunun hesapladığı küme ekranla aynı, AC-73 403'ü yok", () => {
    // Sunucu kuralının aynısı (users/service.ts normalizeRows + effectivePermissions): gövde > mevcut ezme > yeni rol varsayılanı.
    const serverAfter = (
      role: "ADMIN" | "USER",
      curRole: "ADMIN" | "USER",
      cur: Record<string, boolean>,
      req: Record<string, boolean> | undefined,
    ) => {
      const overrides = Object.entries(cur)
        .filter(([, v]) => v !== (curRole === "ADMIN"))
        .map(([permKey, granted]) => ({ permKey, granted }));
      const merged = new Map(overrides.map((o) => [o.permKey, o.granted]));
      for (const [k, v] of Object.entries(req ?? {})) merged.set(k, v);
      return new Set(
        effectivePermissions(
          role,
          [...merged].map(([permKey, granted]) => ({ permKey: permKey as PermissionKey, granted })),
        ),
      );
    };
    const actor: { role: string; permissions: readonly string[] } = {
      role: "ADMIN",
      permissions: PERMISSION_KEYS.filter((k) => k !== "audit.export"),
    };
    const locked = lockedKeys(actor);
    const base = userDraftOf({ fullName: "Can Aydın", email: "can@ornek.com", role: "USER" });
    const basePerms = normalize({ "sessions.view": true });
    const perms = applyRoleDefaults("ADMIN", basePerms, locked);
    expect(perms["audit.export"]).toBe(false);
    const r = buildUpdateUser({ ...base, role: "ADMIN" }, base, perms, basePerms);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.role).toBe("ADMIN");
    expect(r.body.permissions?.["audit.export"]).toBe(false);
    const before = serverAfter("USER", "USER", basePerms, undefined);
    const after = serverAfter("ADMIN", "USER", basePerms, r.body.permissions);
    expect([...after].sort()).toEqual(
      Object.keys(perms)
        .filter((k) => perms[k])
        .sort(),
    );
    const changed = PERMISSION_KEYS.filter((k) => before.has(k) !== after.has(k));
    expect(changed.filter((k) => !actor.permissions.includes(k))).toEqual([]);
    // Eski davranış (yalnız değişen anahtarlar) sunucuda kilitli anahtarı açardı → 403.
    const onlyChanged = Object.fromEntries(changedKeys(perms, basePerms).map((k) => [k, perms[k] === true]));
    expect(serverAfter("ADMIN", "USER", basePerms, onlyChanged).has("audit.export")).toBe(true);
  });

  it("rol değişip kilitsiz anahtar elle eski değerine çekilirse de ekrandaki değer gönderilir", () => {
    const base = userDraftOf({ fullName: "Can Aydın", email: "can@ornek.com", role: "USER" });
    const basePerms = normalize({});
    const perms = { ...applyRoleDefaults("ADMIN", basePerms, new Set()), "users.delete": false };
    const r = buildUpdateUser({ ...base, role: "ADMIN" }, base, perms, basePerms);
    expect(r.ok && r.body.permissions?.["users.delete"]).toBe(false);
    expect(r.ok && Object.keys(r.body.permissions ?? {}).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("sunucu alan hataları: bilinen alan → alan, diğerleri form üstü", () => {
    const r = splitServerFields({ email: "Bu e-posta kullanılıyor", "permissions.audit.export": "Veremezsiniz", x: "Diğer" }, [
      "fullName",
      "email",
      "role",
    ] as const);
    expect(r.errors).toEqual({ email: "Bu e-posta kullanılıyor" });
    expect(r.rest).toEqual(["Veremezsiniz", "Diğer"]);
  });
});

describe("firma formu", () => {
  it("kısa ad önerisi Türkçe harfleri katlar", () => {
    expect(suggestSlug("Şişli Bilişim A.Ş.")).toBe("sisli-bilisim-a-s");
    expect(suggestSlug("  İSTANBUL Çağrı Ölçüm  ")).toBe("istanbul-cagri-olcum");
    expect(suggestSlug("x".repeat(80) + " y")).toHaveLength(60);
  });
  it("doğrulama ve yalnız değişen alanlar", () => {
    const bad = buildTenant({ name: "A", slug: "Kötü Ad" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.slug).toMatch(/küçük harf/);
    const ok = buildTenant({ name: "Yeni Ad", slug: "acme" }, { name: "Acme", slug: "acme" });
    expect(ok.ok && ok.body).toEqual({ name: "Yeni Ad" });
  });
});

describe("liste sorgusu", () => {
  it("geçersiz değerler yok sayılır, varsayılanlar URL'e yazılmaz", () => {
    const p = parseUserParams({ q: "a", role: "SUPER_ADMIN", status: "x", page: "-2" });
    expect(p).toEqual({ q: undefined, role: "all", status: "active", page: 1 });
    expect(usersHref(p)).toBe("/users");
    const p2 = parseUserParams({ q: " can ", role: "ADMIN", status: "passive", page: "3" });
    expect(usersHref(p2)).toBe("/users?q=can&role=ADMIN&status=passive&page=3");
    expect(usersApiPath(p2)).toBe("/users?q=can&role=ADMIN&status=passive&page=3&pageSize=25");
    expect(usersApiPath(p)).toBe("/users?status=active&page=1&pageSize=25");
  });
});
