// P8 oturum geçmişi — DB'siz birim testleri: CSV (AC-124), zaman çizelgesi izdüşümü, kontrol dönemleri, filtre çözümü,
// historyScope ve export üst sınırı (AC-63).
import type { AuthContext } from "../../src/auth/session.ts";
import type { PermissionKey } from "@remote/contracts/permissions";
import { listSessionsQuerySchema } from "@remote/contracts/api/sessions";
import { describe, expect, it } from "vitest";
import { csvCell, csvRow, hms, istanbulDateTime } from "../../src/lib/csv.ts";
import type { Db } from "../../src/lib/db.ts";
import { FixedWindowCounter } from "../../src/lib/rate.ts";
import { deriveControlPeriods, exportHistoryCsv, projectDetails, resolveFilter } from "../../src/sessions/history.ts";
import { escapeLike, historyWhere } from "../../src/sessions/history-repo.ts";
import { historyScope } from "../../src/sessions/service.ts";

const ctx = { ip: "198.51.100.1", userAgent: "t", requestId: "r" };
const silent = { warn: () => undefined, error: () => undefined };

function auth(role: "USER" | "ADMIN" | "SUPER_ADMIN", tenantId: string | null): AuthContext {
  return {
    sessionId: "s",
    expiresAt: new Date(),
    user: { id: "01HUSER0000000000000000000", email: "u@example.test", username: null, fullName: "U", role, tenantId, theme: "SYSTEM", mustChangePassword: false },
    tenantId,
    tenant: null,
    actingTenant: null, mfaStage: "ok" as const, mfaRequired: false, totpEnabled: false,
    permissions: new Set<PermissionKey>(),
  };
}

describe("lib/csv (AC-124, G-16)", () => {
  it("AC-124: = + - @ TAB CR ile başlayan hücre ' önekiyle yazılır", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+90 555")).toBe("'+90 555");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe(`"'\rcmd"`); // önce kaçış, sonra CR yüzünden tırnak
    expect(csvCell("Ayşe = Ali")).toBe("Ayşe = Ali"); // yalnız ilk karakter
    expect(csvCell("")).toBe("");
  });

  it("S8-1: baştaki boşluk/NBSP/ideografik boşluktan sonraki tetikleyiciler ve tam genişlikli ＝＋－＠ de kaçışlanır", () => {
    for (const v of [" =1+1", "  +1", "\u00A0-1", "\u3000@x", " \t=x", "＝1+1", "＋90", "－5", "＠SUM(A1)", "\u00A0＝x"]) {
      expect(csvCell(v).replace(/^"/, "").startsWith("'"), JSON.stringify(v)).toBe(true);
    }
    for (const v of [" abc", "\u00A0Ayşe", "a=b", "１２"]) expect(csvCell(v), JSON.stringify(v)).toBe(v);
  });

  it("AC-124: RFC 4180 — ; \" CR LF içeren hücre tırnaklanır, \" iki kez yazılır; satır ; ile ayrılır, CRLF ile biter", () => {
    expect(csvCell("a;b")).toBe(`"a;b"`);
    expect(csvCell('a"b')).toBe(`"a""b"`);
    expect(csvCell("a\nb")).toBe(`"a\nb"`);
    expect(csvRow(["=x", "y;z", "düz"])).toBe(`'=x;"y;z";düz\r\n`);
  });

  it("zaman Europe/Istanbul YYYY-MM-DD HH:mm:ss, süre HH:MM:SS", () => {
    expect(istanbulDateTime(new Date("2026-01-10T21:00:00.000Z"))).toBe("2026-01-11 00:00:00");
    expect(istanbulDateTime(null)).toBe("");
    expect(hms(3 * 3600 + 5 * 60 + 9)).toBe("03:05:09");
    expect(hms(null)).toBe("");
  });
});

describe("zaman çizelgesi izdüşümü (AC-62)", () => {
  it("izinli alanlar dışında anahtar dönmez; maskeli değer ve IP düşer; sayılar sayıya çevrilir", () => {
    expect(projectDetails("guest.pending", null, { guestId: "g", name: "Ayşe", ip: "203.0.113.5", consentTextId: "x" })).toEqual({ name: "Ayşe" });
    expect(projectDetails("control.requested", null, { request: "3" })).toEqual({ request: 3 });
    expect(projectDetails("monitor.granted", null, { monitorId: "2" })).toEqual({ monitorId: 2 });
    expect(projectDetails("session.created", null, { ttlMin: 15, status: "PENDING" })).toEqual({ ttlMin: 15 });
    expect(projectDetails("guest.admit", null, { reason: "***" })).toEqual({});
    expect(projectDetails("session.caps_changed", { caps: "remote_control,file_transfer" }, { caps: "file_transfer" })).toEqual({ oldCaps: "remote_control,file_transfer", newCaps: "file_transfer" });
    expect(projectDetails("file.transfer", null, { fileName: "x" })).toEqual({});
  });

  it("selfElevated: \"true\"→true, \"false\"→false, \"unknown\"/yok → null; control.cancelled by yoksa tech", () => {
    expect(projectDetails("control.granted", null, { selfElevated: "true", decision: "GRANTED" })).toEqual({ selfElevated: true });
    expect(projectDetails("control.granted", null, { selfElevated: "false" })).toEqual({ selfElevated: false });
    expect(projectDetails("control.granted", null, { selfElevated: "unknown" })).toEqual({ selfElevated: null });
    expect(projectDetails("control.granted", null, {})).toEqual({ selfElevated: null });
    expect(projectDetails("control.cancelled", null, { request: "1" })).toEqual({ by: "tech" });
    expect(projectDetails("control.cancelled", null, { by: "agent", source: "SYSTEM" })).toEqual({ by: "agent", source: "SYSTEM" });
  });
});

describe("kontrol dönemleri (AC-62, ADR-0013 K5-d)", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 10, 11, 10, 0, s));
  const c = (s: number, level: string, decision: string, source: string) => ({ createdAt: t(s), level, decision, source });
  const a = (s: number, action: string, newValue: Record<string, string>) => ({ createdAt: t(s), action, newValue });

  it("GRANTED → ilk REVOKED ile kapanır; neden ve selfElevated audit'ten; kapanışsız dönem null (tahmin yok)", () => {
    const periods = deriveControlPeriods(
      [c(0, "VIEW", "GRANTED", "UI"), c(10, "CONTROL", "GRANTED", "UI"), c(20, "CONTROL", "REVOKED", "TECH"), c(30, "CONTROL", "DENIED", "UI"), c(40, "CONTROL", "GRANTED", "UI"), c(50, "CONTROL", "REVOKED", "SYSTEM"), c(60, "CONTROL", "GRANTED", "UI")],
      [a(10, "control.granted", { selfElevated: "true" }), a(20, "control.released", { via: "release" }), a(40, "control.granted", { selfElevated: "unknown" }), a(50, "control.revoked", { reason: "permission", source: "SYSTEM" })],
    );
    expect(periods).toEqual([
      { grantedAt: t(10).toISOString(), revokedAt: t(20).toISOString(), revokedSource: "TECH", revokedReason: "tech", selfElevated: true },
      { grantedAt: t(40).toISOString(), revokedAt: t(50).toISOString(), revokedSource: "SYSTEM", revokedReason: "permission", selfElevated: null },
      { grantedAt: t(60).toISOString(), revokedAt: null, revokedSource: null, revokedReason: null, selfElevated: null },
    ]);
  });

  it("eşleşmeyen audit → null; tarayıcı modunda (CONTROL satırı yok) boş", () => {
    expect(deriveControlPeriods([c(10, "CONTROL", "GRANTED", "UI"), c(20, "CONTROL", "REVOKED", "UI")], [])).toEqual([
      { grantedAt: t(10).toISOString(), revokedAt: t(20).toISOString(), revokedSource: "UI", revokedReason: null, selfElevated: null },
    ]);
    expect(deriveControlPeriods([c(0, "VIEW", "GRANTED", "UI")], [])).toEqual([]);
  });
});

describe("historyScope + filtre çözümü (AC-61)", () => {
  const T = "01HTENANT00000000000000000";
  const OTHER = "01J0000000000000000000000Z";

  it("AC-61: USER kendi, ADMIN tenant, SUPER_ADMIN firma seçmeden all; kapsam filtreyi ezer", () => {
    const user = historyScope(auth("USER", T));
    expect(user).toEqual({ kind: "tenant", tenantId: T, technicianId: "01HUSER0000000000000000000" });
    expect(historyScope(auth("ADMIN", T))).toEqual({ kind: "tenant", tenantId: T });
    expect(historyScope(auth("SUPER_ADMIN", T))).toEqual({ kind: "tenant", tenantId: T });
    const all = historyScope(auth("SUPER_ADMIN", null));
    expect(all.kind).toBe("all");
    expect(() => historyScope(auth("ADMIN", null))).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));

    const q = listSessionsQuerySchema.parse({ technicianId: OTHER, tenantId: OTHER });
    expect(resolveFilter(user, q)).toEqual({}); // USER: technicianId ve tenantId yok sayılır
    expect(resolveFilter(historyScope(auth("ADMIN", T)), q)).toEqual({ technicianId: OTHER });
    expect(resolveFilter(all, q)).toEqual({ technicianId: OTHER, tenantId: OTHER });
    expect(historyWhere(user, { technicianId: OTHER })).toMatchObject({ tenantId: T, technicianId: "01HUSER0000000000000000000" });
  });

  it("AC-60: from/to Europe/Istanbul günü (from 00:00 dahil, to ertesi gün 00:00 hariç); LIKE jokerleri kaçışlanır", () => {
    const f = resolveFilter(historyScope(auth("ADMIN", T)), listSessionsQuerySchema.parse({ from: "2026-01-11", to: "2026-01-11", customer: "50%_a\\" }));
    expect(f.from?.toISOString()).toBe("2026-01-10T21:00:00.000Z");
    expect(f.to?.toISOString()).toBe("2026-01-11T21:00:00.000Z");
    expect(escapeLike("50%_a\\")).toBe("50\\%\\_a\\\\");
  });
});

describe("export üst sınırı ve hız sınırı (AC-63)", () => {
  const fakeDb = (count: number) => ({ supportSession: { count: async () => count } }) as unknown as Db;
  const q = listSessionsQuerySchema.parse({});

  it("AC-63: 50.000 üstü → 400 VALIDATION fields.to (yarım dosya yok)", async () => {
    const lim = new FixedWindowCounter(6, 60_000, 60_000, { sweepIntervalMs: 0 });
    await expect(exportHistoryCsv(fakeDb(50_001), silent, ctx, auth("ADMIN", "01HTENANT00000000000000000"), q, lim)).rejects.toMatchObject({
      code: "VALIDATION",
      fields: { to: "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın" },
    });
  });

  it("AC-63: kullanıcı başına dakikada 5; 6. istek 429 + Retry-After", async () => {
    const lim = new FixedWindowCounter(6, 60_000, 60_000, { sweepIntervalMs: 0 });
    const a = auth("ADMIN", "01HTENANT00000000000000000");
    for (let i = 0; i < 5; i++) await expect(exportHistoryCsv(fakeDb(50_001), silent, ctx, a, q, lim)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(exportHistoryCsv(fakeDb(0), silent, ctx, a, q, lim)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 60 });
  });
});
