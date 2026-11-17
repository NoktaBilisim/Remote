import { describe, expect, it } from "vitest";
import { UNATTENDED_AUDIT, UNATTENDED_POLICY_AUDIT } from "@remote/contracts/audit";
import {
  actionLabel,
  actionOptionGroups,
  auditClientOs,
  auditPayload,
  groupLabel,
  isMailAction,
  OUTBOUND_REASON_LABELS,
  reasonLabel,
} from "./actions";
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
    expect(parseAuditParams({ action: "settings.mysql.test" }, { allowTenant: false, today: TODAY }).filters.action).toBe(
      "settings.mysql.test",
    );
  });
  it("aralık: başlangıç > bitiş → bitiş yok sayılır; 731 günü aşan → başlangıç yok sayılır", () => {
    expect(parseAuditParams({ from: "2026-11-10", to: "2026-11-01" }, { allowTenant: false, today: TODAY })).toEqual({
      filters: { from: "2026-11-10" },
      ignored: ["to"],
    });
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
    expect(auditPayload({ action: "mail.sent", oldValue: null, newValue: { reason: "auth", to: "a***@x.com", subject: "S" } })).toEqual({
      kind: "reason",
      reason: "auth",
    });
    const p = auditPayload({ action: "user.updated", oldValue: { fullName: "<b>A</b>" }, newValue: null });
    expect(p).toEqual({ kind: "json", oldValue: '{\n  "fullName": "<b>A</b>"\n}', newValue: null });
  });
});

describe("P13a audit etiketleri (AC-199, T-P12b)", () => {
  it("retention.run Türkçe etiket + grup başlığı; filtrede 'Veri saklama — tümü'", () => {
    expect(actionLabel("retention.run")).toBe("Saklama süresi işi");
    expect(groupLabel("retention")).toBe("Veri saklama");
    const g = actionOptionGroups().find((x) => x.label === "Veri saklama");
    expect(g?.options.map((o) => o.value)).toEqual(["retention.*", "retention.run"]);
  });
  it("dış gönderim reason kodları: WhatsApp, SMTP, MySQL ve izdüşüm 'other' Türkçe; bilinmeyen ham", () => {
    for (const k of ["unconfigured", "insecure", "timeout", "http_error", "redirect", "unreachable", "invalid_response", "other"])
      expect(OUTBOUND_REASON_LABELS[k]).toBeTruthy();
    for (const k of ["connect", "auth", "tls", "rejected", "port_not_allowed", "not_configured", "database", "secret_unreadable"])
      expect(OUTBOUND_REASON_LABELS[k]).toBeTruthy();
    expect(reasonLabel("unreachable")).toBe("Servise ulaşılamadı");
    expect(reasonLabel("yeni_kod")).toBe("yeni_kod");
  });
});

describe("P27/P28u gözetimsiz audit etiketleri (K10 bulgusu)", () => {
  const all = [...Object.values(UNATTENDED_AUDIT), UNATTENDED_POLICY_AUDIT];
  it("sözleşmedeki tüm gözetimsiz eylemler Türkçe etiketli (ham anahtar yok)", () => {
    for (const a of all) expect(actionLabel(a), a).not.toBe(a);
    expect(actionLabel("unattended.consent")).toBe("Gözetimsiz bağlantı onayı (cihaz kullanıcısı)");
    expect(actionLabel("unattended.connect")).toBe("Gözetimsiz bağlantı isteği");
    expect(actionLabel("unattended.session.started")).toBe("Gözetimsiz bağlantı başladı");
    expect(actionLabel("settings.unattended_silent")).toBe("Gözetimsiz erişim politikası değişti");
  });
  it("İşlem süzgeci: 'Gözetimsiz erişim' grubu, tüm eylemler etiketiyle", () => {
    expect(groupLabel("unattended")).toBe("Gözetimsiz erişim");
    const groups = actionOptionGroups();
    const g = groups.find((x) => x.label === "Gözetimsiz erişim");
    expect(g?.options[0]).toEqual({ value: "unattended.*", label: "Gözetimsiz erişim — tümü" });
    for (const a of Object.values(UNATTENDED_AUDIT)) expect(g?.options.find((o) => o.value === a)?.label, a).toBe(actionLabel(a));
    expect(groups.every((x) => x.options.every((o) => o.label !== o.value))).toBe(true);
  });
});

describe("P28f katılım `os` etiketi (guest.pending / session.join, mimari-p28f §4.1)", () => {
  it("guest.pending (sunucunun başarı satırı) da etiketlenir", () =>
    expect(auditClientOs({ action: "guest.pending", newValue: { guestKind: "AGENT", os: "macos" } })).toBe("macOS"));
  it.each([
    ["windows", "Windows"],
    ["macos", "macOS"],
    ["linux", "Linux"],
    ["browser", "Tarayıcı"],
  ])("%s → %s", (os, label) => expect(auditClientOs({ action: "session.join", newValue: { customerName: "x", os } })).toBe(label));
  it("eski satır (os yok), bilinmeyen değer, başka eylem, JSON olmayan değer → null", () => {
    expect(auditClientOs({ action: "session.join", newValue: { customerName: "x" } })).toBeNull();
    expect(auditClientOs({ action: "session.join", newValue: { os: "toString" } })).toBeNull();
    expect(auditClientOs({ action: "session.join", newValue: { os: "<b>x</b>" } })).toBeNull();
    expect(auditClientOs({ action: "session.create", newValue: { os: "macos" } })).toBeNull();
    expect(auditClientOs({ action: "session.join", newValue: null })).toBeNull();
    expect(auditClientOs({ action: "session.join", newValue: ["macos"] })).toBeNull();
  });
});
