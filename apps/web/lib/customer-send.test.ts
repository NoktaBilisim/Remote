import { customerSendInputSchema, type CustomerSendOptions } from "@remote/contracts/api/customer-send";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { canSend, checkRecipient, initialSendState, maskRecipient, sendFailure, sendReducer, usableChannels } from "./customer-send";

const opts = (o: Partial<CustomerSendOptions> = {}): CustomerSendOptions => ({
  kind: "CUSTOMER",
  channels: [
    { channel: "EMAIL", available: true, block: null, settingsHref: null },
    { channel: "WHATSAPP", available: false, block: "unconfigured", settingsHref: null },
  ],
  recipients: { email: [{ value: "a@ornek.com", source: "contact" }], phone: [{ value: "+905321112233", source: "contact" }] },
  recipientsLocked: true,
  previews: { EMAIL: { subject: "Konu", text: "Metin" } },
  remainingSends: 1,
  ...o,
});

describe("LG-3 müşteriye gönder (AC-406..409)", () => {
  it("yalnız kullanılabilir kanallar seçilebilir; ilk kanal ve ilk alıcı seçili gelir", () => {
    expect(usableChannels(opts())).toEqual(["EMAIL"]);
    const s = sendReducer(initialSendState, { type: "loaded", options: opts() });
    expect(s.channel).toBe("EMAIL");
    expect(s.to).toEqual({ email: "a@ornek.com", phone: "+905321112233" });
    expect(sendReducer(initialSendState, { type: "loaded", options: opts({ channels: [] }) }).channel).toBeNull();
  });
  it("alıcı ön denetimi: e-posta biçimi, telefon E.164, SMS yalnız TR", () => {
    expect(checkRecipient(" a@ornek.com ", "EMAIL").to).toBe("a@ornek.com");
    expect(checkRecipient("x@", "EMAIL").error).toBeTruthy();
    expect(checkRecipient("", "EMAIL").error).toBeTruthy();
    expect(checkRecipient("0532 111 22 33", "WHATSAPP").to).toBe("+905321112233");
    expect(checkRecipient("+44 7700 900123", "SMS").error).toBeTruthy();
    // sözleşme: kanal–alıcı uyumu ve K2'de SMS yok
    const target = { kind: "CUSTOMER", customerId: "01J00000000000000000000001" } as const;
    expect(customerSendInputSchema.safeParse({ target, channel: "EMAIL", to: "a@ornek.com" }).success).toBe(true);
    expect(customerSendInputSchema.safeParse({ target, channel: "SMS", to: "05321112233" }).success).toBe(false);
    expect(customerSendInputSchema.safeParse({ target, channel: "WHATSAPP", to: "a@ornek.com" }).success).toBe(false);
    // O-LG-3: kayıt kodu yalnız e-posta
    const code = { kind: "UNATTENDED_CODE", codeId: "01J00000000000000000000002", code: "ABCD-EFGH-JKMN-PQRS" } as const;
    expect(customerSendInputSchema.safeParse({ target: code, channel: "WHATSAPP", to: "+905321112233" }).success).toBe(false);
  });
  it("hata eşlemesi: 400 alan, 429 geri sayım, 409 kanal, 502 tek genel metin (ham metin yok)", () => {
    expect(sendFailure(new ApiError(400, "VALIDATION", "x", { to: "Geçersiz" }))).toEqual({ kind: "field", message: "Geçersiz" });
    expect(sendFailure(new ApiError(429, "RATE_LIMITED", "x", undefined, undefined, 30))).toMatchObject({
      kind: "rate",
      retryAfterSec: 30,
    });
    expect(sendFailure(new ApiError(409, "CHANNEL_UNAVAILABLE", "ham"))).toMatchObject({
      message: expect.stringContaining("Kanal kullanılamıyor"),
    });
    const f = sendFailure(new ApiError(502, "UPSTREAM", "smtp 550 relay denied"));
    expect(f).toMatchObject({ kind: "message", tone: "danger" });
    expect(f.message).not.toContain("550");
  });
  it("durum makinesi: başarıda K2 hakkı azalır, 0'da gönderim kapanır; 429 kilitler, süre dolunca açar", () => {
    let s = sendReducer(initialSendState, { type: "loaded", options: opts() });
    expect(canSend(s)).toBe(true);
    s = sendReducer(sendReducer(s, { type: "sending" }), { type: "sent", message: "ok" });
    expect(s.result?.tone).toBe("success");
    expect(s.load.kind === "ready" && s.load.options.remainingSends).toBe(0);
    expect(canSend(s)).toBe(false);
    let r = sendReducer(initialSendState, { type: "loaded", options: opts({ remainingSends: null }) });
    r = sendReducer(r, { type: "failed", failure: { kind: "rate", message: "m", retryAfterSec: 5 }, now: 1000 });
    expect(r.rateUntil).toBe(6000);
    expect(canSend(r)).toBe(false);
    expect(canSend(sendReducer(r, { type: "rateOver" }))).toBe(true);
  });
  it("maskeli alıcı", () => {
    expect(maskRecipient("musteri@ornek.com")).toBe("m***@ornek.com");
    expect(maskRecipient("+905321112233")).toBe("+90532***33");
  });
});
