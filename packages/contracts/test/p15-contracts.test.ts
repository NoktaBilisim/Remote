import { describe, expect, it } from "vitest";
import { mfaRecoveryCodesInputSchema } from "../src/api/auth.ts";
import { systemLogoValueSchema } from "../src/api/branding.ts";
import { createRequestBlockInputSchema } from "../src/api/request-blocks.ts";
import { checkBlockCidr, updateRequestSettingsInputSchema } from "../src/api/requests.ts";
import { describeShareFailure, fileVerificationLabel } from "../src/labels.ts";
import { PERMISSION_DESCRIPTIONS, PERMISSION_KEYS } from "../src/permissions.ts";
import { fileMetaSchema, guestInboundSchema, techInboundSchema } from "../src/ws.ts";
import { requestOutboundSchema } from "../src/ws-request.ts";

const sha = "a".repeat(64);

describe("P15 contracts", () => {
  it("AC-231 kurtarma kodu yenileme yalnız 6 haneli TOTP kabul eder", () => {
    expect(mfaRecoveryCodesInputSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(mfaRecoveryCodesInputSchema.safeParse({ code: "abcd-efgh" }).success).toBe(false);
    expect(mfaRecoveryCodesInputSchema.safeParse({ code: "123456", extra: 1 }).success).toBe(false);
  });

  it("AC-233 sistem logosu değeri null olabilir", () => {
    expect(systemLogoValueSchema.safeParse({ path: null }).success).toBe(true);
    expect(systemLogoValueSchema.safeParse({ path: "system/abcdefghijklmnop.png" }).success).toBe(true);
    expect(systemLogoValueSchema.safeParse({ path: "x/abcdefghijklmnop.png" }).success).toBe(false);
  });

  it("AC-234 share.state reason/method isteğe bağlı; bilinmeyen kod kabul, biçim dışı ret; 0.10.x yükü geçer", () => {
    const base = { t: "share.state", state: "stopped" };
    expect(guestInboundSchema.safeParse(base).success).toBe(true);
    expect(guestInboundSchema.safeParse({ ...base, reason: "DXGI_UNSUPPORTED", method: "DXGI" }).success).toBe(true);
    expect(guestInboundSchema.safeParse({ ...base, reason: "NO_H264_ENCODER", method: "WGC" }).success).toBe(true);
    expect(guestInboundSchema.safeParse({ ...base, reason: "FUTURE_CODE_9" }).success).toBe(true);
    expect(guestInboundSchema.safeParse({ ...base, reason: "küçük harf" }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ ...base, reason: "A".repeat(33) }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ ...base, method: "VNC" }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(techInboundSchema.safeParse({ ...base, reason: "OTHER" }).success).toBe(false); // teknisyen göndermez
  });

  it("AC-234 etiketler: bilinen Türkçe, bilinmeyen ham kodla, reason yoksa null", () => {
    expect(describeShareFailure("NO_H264_ENCODER", "DXGI")).toContain("H.264");
    expect(describeShareFailure("NO_H264_ENCODER", "DXGI")).toContain("DXGI");
    expect(describeShareFailure("NEW_CODE")).toBe("Bilinmeyen neden (NEW_CODE)");
    expect(describeShareFailure("OTHER", "XYZ")).toBe("Diğer hata — XYZ");
    expect(describeShareFailure(undefined)).toBeNull();
  });

  it("AC-235 engel CIDR normalizasyonu ve sınırlar", () => {
    expect(checkBlockCidr("203.0.113.7")).toEqual({ ok: true, cidr: "203.0.113.7/32", version: 4, bits: 32 });
    expect(checkBlockCidr("203.0.113.7/24")).toMatchObject({ ok: true, cidr: "203.0.113.0/24" });
    expect(checkBlockCidr("203.0.113.7/23").ok).toBe(false);
    expect(checkBlockCidr("::ffff:203.0.113.7")).toMatchObject({ ok: true, cidr: "203.0.113.7/32", version: 4 });
    expect(checkBlockCidr("::ffff:cb00:7107/120")).toMatchObject({ ok: true, cidr: "203.0.113.0/24", version: 4 });
    expect(checkBlockCidr("2001:db8:1:2::5/48")).toMatchObject({ ok: true, cidr: "2001:db8:1::/48", version: 6 });
    expect(checkBlockCidr("2001:db8::/47").ok).toBe(false);
    expect(checkBlockCidr("2001:db8::1")).toMatchObject({ ok: true, cidr: "2001:db8::1/128" });
    expect(checkBlockCidr("10.0.0.1/33").ok).toBe(false);
    expect(checkBlockCidr("abc").ok).toBe(false);
  });

  it("AC-235 engel girdisi: iki kaynak, prefixLen yalnız IP, not kuralı", () => {
    const ok = createRequestBlockInputSchema.safeParse({ source: "CIDR", cidr: "198.51.100.9/24", durationHours: 24, note: "  spam " });
    expect(ok.success && ok.data).toMatchObject({ cidr: "198.51.100.0/24", note: "spam" });
    const id = "01JC0000000000000000000000";
    expect(
      createRequestBlockInputSchema.safeParse({ source: "REQUEST", requestId: id, target: "DEVICE", durationHours: null }).success,
    ).toBe(true);
    expect(
      createRequestBlockInputSchema.safeParse({ source: "REQUEST", requestId: id, target: "DEVICE", prefixLen: 24, durationHours: null })
        .success,
    ).toBe(false);
    expect(createRequestBlockInputSchema.safeParse({ source: "CIDR", cidr: "1.2.3.4", durationHours: 0 }).success).toBe(false);
    expect(createRequestBlockInputSchema.safeParse({ source: "CIDR", cidr: "1.2.3.4", durationHours: null, note: "a‮b" }).success).toBe(
      false,
    );
  });

  it("AC-235 support_requests.block anahtarı tek tanımdan toggle listesine girer", () => {
    expect(PERMISSION_KEYS).toContain("support_requests.block");
    expect(PERMISSION_DESCRIPTIONS["support_requests.block"]).toBeTruthy();
  });

  it("AC-237 users.delete anahtarı tanımlı ve kalıcı silmeyi anlatır", () => {
    expect(PERMISSION_KEYS).toContain("users.delete");
    expect(PERMISSION_DESCRIPTIONS["users.delete"]).toContain("kalıcı");
  });

  it("AC-238 file.meta fid isteğe bağlı; etiket", () => {
    const m = { t: "file.meta", direction: "TO_TECH", fileName: "a.txt", sizeBytes: 1, sha256: sha, result: "OK" };
    expect(fileMetaSchema.safeParse(m).success).toBe(true);
    expect(fileMetaSchema.safeParse({ ...m, fid: "abc_1" }).success).toBe(true);
    expect(fileMetaSchema.safeParse({ ...m, fid: "a b" }).success).toBe(false);
    expect(fileVerificationLabel(true)).toBe("Doğrulanmış");
    expect(fileVerificationLabel(false)).toBe("Müşteri bildirimi");
  });

  it("AC-239 request.accepted admitCode isteğe bağlı; ayar alanı opsiyonel", () => {
    const acc = {
      t: "request.accepted",
      wsTicket: "A".repeat(43),
      technicianName: "T",
      techVerifyCode: "1234",
      ticketExpiresAt: new Date().toISOString(),
    };
    expect(requestOutboundSchema.safeParse(acc).success).toBe(true);
    expect(requestOutboundSchema.safeParse({ ...acc, admitCode: "0042" }).success).toBe(true);
    expect(requestOutboundSchema.safeParse({ ...acc, admitCode: "42" }).success).toBe(false);
    const s = {
      waitMinutes: 30,
      trustedCidrs: [],
      whatsapp: { enabled: false, recipients: [] },
      email: { enabled: false, recipients: [] },
    };
    expect(updateRequestSettingsInputSchema.safeParse(s).success).toBe(true);
    expect(updateRequestSettingsInputSchema.safeParse({ ...s, requireAcceptCode: true }).success).toBe(true);
  });
});
