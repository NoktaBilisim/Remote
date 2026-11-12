import { describe, expect, it } from "vitest";
import { actionLabel, actionOptionGroups, auditPayload, isMailAction } from "./actions";
import { addDays, auditApiPath, auditExportPath, auditHref, parseAuditParams, rangeError } from "./query";

const TODAY = "2026-11-12";
const ULID = "01JKS00000000000000000000A";

describe("audit filtreleri (AC-76)", () => {
  it("geçerli değerleri alır, geçersizleri yok sayar ve bildirir", () => {
    const { filters, ignored } = parseAuditParams(
      { from: "2026-11-01", to: "2026-02-30", userId: ULID, action: "auth.*", result: "fail", tenantId: ULID },
      { allowTenant: false, today: TODAY },
    );
    expect(filters).toEqual({ from: "2026-11-01", userId: ULID, action: "auth.*", result: "fail" });
    expect(ignored).toEqual(["to", "tenantId"]);
  });
  it("firma filtresi yalnız izin varken; işlem adı biçimi sözleşme şemasıyla", () => {
    expect(parseAuditParams({ tenantId: ULID }, { allowTenant: true, today: TODAY }).filters.tenantId).toBe(ULID);
    expect(parseAuditParams({ action: "<script>" }, { allowTenant: false, today: TODAY }).ignored).toEqual(["action"]);
    expect(parseAuditParams({ action: "settings.mysql.test" }, { allowTenant: false, today: TODAY }).filters.action).toBe("settings.mysql.test");
  });
  it("aralık: başlangıç > bitiş → bitiş yok sayılır; 731 günü aşan → başlangıç yok sayılır", () => {
    expect(parseAuditParams({ from: "2026-11-10", to: "2026-11-01" }, { allowTenant: false, today: TODAY })).toEqual({ filters: { from: "2026-11-10" }, ignored: ["to"] });
    expect(parseAuditParams({ from: addDays(TODAY, -732) }, { allowTenant: false, today: TODAY }).ignored).toEqual(["from"]);
    expect(rangeError(addDays(TODAY, -731), undefined, TODAY)).toBeNull();
    expect(rangeError("2026-01-02", "2026-01-01", TODAY)).toBe("order");
  });
  it("URL ve API yolu: boşlar yazılmaz, sıra sabit; cursor yalnız API'de; CSV aynı filtreler", () => {
    const f = { result: "success" as const, from: "2026-11-01" };
    expect(auditHref({})).toBe("/audit");
    expect(auditHref(f)).toBe("/audit?from=2026-11-01&result=success");
    expect(auditApiPath(f, "abcd1234")).toBe("/audit?from=2026-11-01&result=success&cursor=abcd1234");
    expect(auditExportPath(f)).toBe("/audit/export.csv?from=2026-11-01&result=success");
  });
});

describe("audit işlem etiketleri ve detay", () => {
  it("bilinen ad Türkçe, bilinmeyen ham", () => {
    expect(actionLabel("auth.login")).toBe("Giriş");
    expect(actionLabel("settings.mysql.test")).toBe("MySQL bağlantı testi");
    expect(actionLabel("yeni.olay")).toBe("yeni.olay");
  });
  it("grup seçenekleri: grup başına 'tümü' öneki + tam adlar; URL'deki bilinmeyen ad kaybolmaz", () => {
    const groups = actionOptionGroups("yeni.olay");
    const auth = groups.find((g) => g.label === "Giriş ve hesap güvenliği");
    expect(auth?.options[0]).toEqual({ value: "auth.*", label: "Giriş ve hesap güvenliği — tümü" });
    expect(auth?.options.some((o) => o.value === "auth.login")).toBe(true);
    expect(groups.flatMap((g) => g.options).some((o) => o.value === "yeni.olay")).toBe(true);
  });
  it("e-posta / test kayıtlarında yalnız reason; diğerlerinde JSON metni", () => {
    expect(isMailAction("mail.sent")).toBe(true);
    expect(isMailAction("settings.smtp.test")).toBe(true);
    expect(isMailAction("user.updated")).toBe(false);
    expect(auditPayload({ action: "mail.sent", oldValue: null, newValue: { reason: "auth", to: "a***@x.com", subject: "S" } })).toEqual({ kind: "reason", reason: "auth" });
    const p = auditPayload({ action: "user.updated", oldValue: { fullName: "<b>A</b>" }, newValue: null });
    expect(p).toEqual({ kind: "json", oldValue: '{\n  "fullName": "<b>A</b>"\n}', newValue: null });
  });
});
