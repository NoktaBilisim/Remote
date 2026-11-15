import { describe, expect, it } from "vitest";
import { SEND_FAILED_MESSAGES, SERVICE_URL_MESSAGE, SMS_TR_ONLY_MESSAGE } from "@remote/contracts/api/notify";
import { ApiError } from "@/lib/api";
import { availableChannels, checkLinkPhone, sendLinkFailure } from "./send-link";
import { buildSmsInput, smsDirty, smsToState } from "./sms-form";

const view = {
  url: null,
  defaultUrl: true,
  header: null,
  apiKeySet: true,
  keyUnreadable: false,
  insecure: false,
  usable: true,
  updatedAt: null,
};

describe("P19 send-link (AC-260)", () => {
  it("yalnız kullanılabilir kanallar", () => {
    expect(availableChannels({ sms: true, whatsapp: false, suggestedPhone: null })).toEqual(["SMS"]);
    expect(availableChannels({ sms: false, whatsapp: false, suggestedPhone: null })).toEqual([]);
  });
  it("telefon: E.164 önizleme; SMS yalnız TR cep", () => {
    expect(checkLinkPhone("0532 111 22 33", "SMS").e164).toBe("+905321112233");
    expect(checkLinkPhone("+44 7700 900123", "SMS").error).toBe(SMS_TR_ONLY_MESSAGE);
    expect(checkLinkPhone("+44 7700 900123", "WHATSAPP").e164).toBe("+447700900123");
    expect(checkLinkPhone("", "SMS").error).toBeTruthy();
  });
  it("hata eşlemesi: 400 telefon, 429 geri sayım, 502 kanal mesajı, 409", () => {
    expect(sendLinkFailure(new ApiError(400, "VALIDATION", "x", { phone: SMS_TR_ONLY_MESSAGE }), "SMS", "g")).toEqual({
      kind: "phone",
      message: SMS_TR_ONLY_MESSAGE,
    });
    expect(sendLinkFailure(new ApiError(429, "RATE_LIMITED", "x", undefined, undefined, 90), "SMS", "g")).toMatchObject({
      kind: "rate",
      retryAfterSec: 90,
    });
    expect(sendLinkFailure(new ApiError(502, "UPSTREAM", "x"), "WHATSAPP", "g")).toMatchObject({ message: SEND_FAILED_MESSAGES.WHATSAPP });
    expect(sendLinkFailure(new ApiError(409, "CHANNEL_UNAVAILABLE", "kanal yok"), "SMS", "g")).toMatchObject({ tone: "warning" });
  });
});

describe("P19 SMS ayar formu (AC-260)", () => {
  it("boş anahtar gönderilmez (korunur); sil → null; boş adres → sistem varsayılanı", () => {
    const st = smsToState(view);
    expect(buildSmsInput(st).input).toEqual({ url: null, header: null });
    expect(buildSmsInput({ ...st, removeKey: true }).input).toEqual({ url: null, header: null, apiKey: null });
    expect(buildSmsInput({ ...st, apiKey: "abcdefgh12" }).input?.apiKey).toBe("abcdefgh12");
    expect(smsDirty(st, st)).toBe(false);
    expect(smsDirty({ ...st, apiKey: "x" }, st)).toBe(true);
  });
  it("adreste sır / kısa anahtar / uzun başlık alan hatası", () => {
    const st = smsToState(view);
    expect(buildSmsInput({ ...st, url: "https://u:p@sms.ornek.com" }).errors.url).toBe(SERVICE_URL_MESSAGE);
    expect(buildSmsInput({ ...st, url: "https://sms.ornek.com?key=1" }).errors.url).toBeTruthy();
    expect(buildSmsInput({ ...st, apiKey: "kısa" }).errors.apiKey).toBeTruthy();
    expect(buildSmsInput({ ...st, header: "ÇOKUZUNBASLIK" }).errors.header).toBeTruthy();
  });
});
