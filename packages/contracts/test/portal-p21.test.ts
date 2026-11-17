// P21 K2 — müşteri portalı sözleşmesi (mimari-p21 §4.1, §4.4, §4.5; AC-262, AC-285; r2 S-P21-1/3/4/6/11).
import { describe, expect, it } from "vitest";
import {
  PORTAL_PAGE_SIZE_MAX,
  PORTAL_SESSION_COOKIE,
  PORTAL_CSRF_COOKIE,
  portalAccountCreateInputSchema,
  portalListQuerySchema,
  portalLoginInputSchema,
  portalRequestInputSchema,
  portalRequestShape,
  portalThemeInputSchema,
  portalTotpDisableInputSchema,
} from "../src/api/portal.ts";
import { webRequestInputSchema, webRequestShape } from "../src/api/requests.ts";
import { SESSION_COOKIE } from "../src/api/auth.ts";
import { PORTAL_AUDIT, PORTAL_LOGIN_FAIL_REASONS } from "../src/audit.ts";
import { PORTAL_AUDIT_GROUP_LABELS, PORTAL_AUDIT_LABELS } from "../src/labels.ts";
import { PERMISSION_DESCRIPTIONS, PERMISSION_KEYS, PERMISSION_MODULES, effectivePermissions } from "../src/permissions.ts";

const ULID = "01JD0000000000000000000000";
const portalBody = {
  clientInstanceId: "A".repeat(22),
  customerName: "Mehmet Kaya",
  phone: "+905301112233",
  description: "Yazıcı çalışmıyor",
  consentTextId: ULID,
  consentAccepted: true,
};
const webBody = { ...portalBody, ref: "abcdefghijklmnop", formToken: "x".repeat(20), website: "" };

describe("P21 portal sözleşmesi", () => {
  it("AC-262: çerezler panelden ayrı, __Host- önekli", () => {
    expect(PORTAL_SESSION_COOKIE).not.toBe(SESSION_COOKIE);
    expect(PORTAL_SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(PORTAL_CSRF_COOKIE.startsWith("__Host-")).toBe(true);
  });

  it("AC-262: giriş — e-posta küçük harfe, tenantSlug zorunlu, bilinmeyen alan 400", () => {
    const ok = portalLoginInputSchema.parse({ email: "  Ali@Firma.COM ", tenantSlug: "nokta", password: "x" });
    expect(ok.email).toBe("ali@firma.com");
    expect(portalLoginInputSchema.safeParse({ email: "ali@firma.com", password: "x" }).success).toBe(false);
    expect(portalLoginInputSchema.safeParse({ email: "ali@firma.com", tenantSlug: "Nokta!", password: "x" }).success).toBe(false);
    expect(
      portalLoginInputSchema.safeParse({ email: "ali@firma.com", tenantSlug: "nokta", password: "x", tenantId: ULID }).success,
    ).toBe(false);
    expect(portalLoginInputSchema.safeParse({ email: "ali@firma.com", tenantSlug: "nokta", password: "x", totpCode: "12a456" }).success).toBe(
      false,
    );
  });

  it("AC-262: liste sorgusu — varsayılan, string zorlama, sınırlar (S-P21-11), customerId → 400", () => {
    expect(portalListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(portalListQuerySchema.parse({ page: "3", pageSize: "100" })).toEqual({ page: 3, pageSize: 100 });
    expect(portalListQuerySchema.safeParse({ pageSize: String(PORTAL_PAGE_SIZE_MAX + 1) }).success).toBe(false);
    expect(portalListQuerySchema.safeParse({ page: "10001" }).success).toBe(false);
    expect(portalListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(portalListQuerySchema.safeParse({ customerId: ULID }).success).toBe(false);
    expect(portalListQuerySchema.safeParse({ tenantId: ULID }).success).toBe(false);
  });

  it("AC-262: talep şeması web formundan türetilir; ref/formToken/website/bindingKey/customerId/tenantId → 400 (S-P21-1, S-P21-6)", () => {
    expect(Object.keys(portalRequestShape).sort()).toEqual(
      Object.keys(webRequestShape)
        .filter((k) => !["ref", "formToken", "website"].includes(k))
        .sort(),
    );
    const ok = portalRequestInputSchema.parse(portalBody);
    expect(ok.notify).toEqual({ sms: false, whatsapp: false, email: false });
    for (const extra of [
      { ref: "abcdefghijklmnop" },
      { formToken: "x".repeat(20) },
      { website: "" },
      { bindingKey: `rsb_${"a".repeat(43)}` },
      { customerId: ULID },
      { tenantId: ULID },
    ])
      expect(portalRequestInputSchema.safeParse({ ...portalBody, ...extra }).success).toBe(false);
  });

  it("AC-262: notify.email ⇒ email kuralı portal ve web şemasında aynı (S-P21-6)", () => {
    const p = portalRequestInputSchema.safeParse({ ...portalBody, notify: { email: true } });
    expect(p.success).toBe(false);
    expect(p.error?.issues[0]?.path).toEqual(["email"]);
    expect(portalRequestInputSchema.safeParse({ ...portalBody, email: "a@b.co", notify: { email: true } }).success).toBe(true);
    const w = webRequestInputSchema.safeParse({ ...webBody, notify: { email: true } });
    expect(w.success).toBe(false);
    expect(w.error?.issues[0]?.path).toEqual(["email"]);
    expect(webRequestInputSchema.safeParse(webBody).success).toBe(true);
    expect(webRequestInputSchema.safeParse({ ...webBody, extra: 1 }).success).toBe(false);
    expect(webRequestInputSchema.safeParse(portalBody).success).toBe(false);
  });

  it("AC-262: hesap oluşturma — ad kuralı (2..100, kontrol karakteri yok), e-posta küçük harf", () => {
    expect(portalAccountCreateInputSchema.parse({ email: "A@B.CO", fullName: " Ayşe Yılmaz " })).toEqual({
      email: "a@b.co",
      fullName: "Ayşe Yılmaz",
    });
    expect(portalAccountCreateInputSchema.safeParse({ email: "a@b.co", fullName: "A" }).success).toBe(false);
    expect(portalAccountCreateInputSchema.safeParse({ email: "a@b.co", fullName: "Ay​şe" }).success).toBe(false);
    expect(portalAccountCreateInputSchema.safeParse({ email: "a@b.co", fullName: "x".repeat(101) }).success).toBe(false);
    expect(portalAccountCreateInputSchema.safeParse({ email: "değil", fullName: "Ayşe" }).success).toBe(false);
  });

  it("AC-262: tema ve TOTP kapatma şemaları", () => {
    expect(portalThemeInputSchema.safeParse({ theme: "DARK" }).success).toBe(true);
    expect(portalThemeInputSchema.safeParse({ theme: "dark" }).success).toBe(false);
    expect(portalTotpDisableInputSchema.safeParse({ code: "123456" }).success).toBe(false);
    expect(portalTotpDisableInputSchema.safeParse({ password: "p", code: "123456" }).success).toBe(true);
  });

  it("AC-262: PORTAL_AUDIT benzersiz, portal.* önekli, hepsi etiketli; giriş ret nedenleri", () => {
    const actions = Object.values(PORTAL_AUDIT);
    expect(new Set(actions).size).toBe(actions.length);
    for (const a of actions) {
      expect(a.startsWith("portal.")).toBe(true);
      expect(PORTAL_AUDIT_LABELS[a]).toBeTruthy();
    }
    expect(PORTAL_AUDIT_GROUP_LABELS.portal).toBe("Müşteri portalı");
    expect(PORTAL_LOGIN_FAIL_REASONS).toContain("temp_password_expired");
  });
});

describe("P21 yetki anahtarı (AC-285)", () => {
  it("AC-285: customers.portal customers modülünün sonunda, açıklamalı; ADMIN açık, USER kapalı (AC-72 tek tanım)", () => {
    const customers = PERMISSION_MODULES.find((m) => m.key === "customers");
    expect(customers?.actions.at(-1)).toBe("portal");
    expect(PERMISSION_KEYS).toContain("customers.portal");
    expect(PERMISSION_DESCRIPTIONS["customers.portal"]).toBeTruthy();
    expect(effectivePermissions("ADMIN", [])).toContain("customers.portal");
    expect(effectivePermissions("USER", [])).not.toContain("customers.portal");
  });
});
