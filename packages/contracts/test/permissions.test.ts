import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, PERMISSION_MODULES, RETIRED_PERMISSION_KEYS, effectivePermissions } from "../src/permissions.ts";

describe("permissions (tek tanım)", () => {
  it("AC-72: anahtar listesi modül tanımından üretilir, tekrar yok", () => {
    const expected = PERMISSION_MODULES.reduce((n, m) => n + m.actions.length, 0);
    expect(PERMISSION_KEYS).toHaveLength(expected);
    expect(new Set(PERMISSION_KEYS).size).toBe(expected);
    expect(PERMISSION_KEYS).toContain("sessions.terminate");
  });

  it("AC-73: ADMIN varsayılan tümü açık, USER tümü kapalı, satırlar ezer, SUPER_ADMIN tümü", () => {
    expect(effectivePermissions("ADMIN", [])).toEqual([...PERMISSION_KEYS]);
    expect(effectivePermissions("USER", [])).toEqual([]);
    expect(effectivePermissions("USER", [{ permKey: "sessions.view", granted: true }])).toEqual(["sessions.view"]);
    expect(effectivePermissions("ADMIN", [{ permKey: "audit.view", granted: false }])).not.toContain("audit.view");
    expect(effectivePermissions("USER", [{ permKey: "eski.anahtar", granted: true }])).toEqual([]);
    expect(effectivePermissions("SUPER_ADMIN", [{ permKey: "audit.view", granted: false }])).toHaveLength(PERMISSION_KEYS.length);
  });

  it("S-P28u-r3-3 / AC-451: kaldırılan anahtarlar yeniden kullanılmaz — PERMISSION_KEYS ∩ RETIRED_PERMISSION_KEYS = ∅", () => {
    expect(RETIRED_PERMISSION_KEYS).toContain("unattended.silent");
    const live = new Set<string>(PERMISSION_KEYS);
    expect(RETIRED_PERMISSION_KEYS.filter((k) => live.has(k))).toEqual([]);
    // Saklı satır (granted=true) hiçbir rolde yetki vermez.
    expect(effectivePermissions("USER", [{ permKey: "unattended.silent", granted: true }])).toEqual([]);
  });
});
