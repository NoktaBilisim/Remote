// P18 H3 sözleşme testleri — kabul öncesi mesajlaşma (mimari-e11 §8b.4–8b.6; AC-255; S-P18-T1/T3/T8).
import wsFixture from "../fixtures/ws-request.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import {
  isWellFormedText,
  listRequestMessagesQuerySchema,
  requestMessageBodySchema,
  sendRequestMessageInputSchema,
} from "../src/api/requests.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { effectivePermissions } from "../src/permissions.ts";
import {
  panelOutboundSchema,
  requestChatOutboundSchema,
  requestInboundChatSchema,
  requestInboundSchema,
  requestOutboundSchema,
  WS_REQUEST_CAP_CHAT,
} from "../src/ws-request.ts";

const fx = wsFixture as unknown as {
  valid: Record<string, unknown[]>;
  invalid: Record<string, unknown[]>;
};
const ok = (v: string) => requestMessageBodySchema.safeParse(v);

describe("AC-255 / S-P18-T8 mesaj gövdesi", () => {
  it("AC-255: 1000 kod noktası geçer, 1001 reddedilir; boş/yalnız boşluk reddedilir; trim + NFC", () => {
    expect(ok("ğ".repeat(1000)).success).toBe(true);
    expect(ok("😀".repeat(1000)).success).toBe(true); // kod noktası sayılır, UTF-16 birimi değil
    expect(ok("a".repeat(1001)).success).toBe(false);
    expect(ok("").success).toBe(false);
    expect(ok("   \n ").success).toBe(false);
    expect(ok("  e\u0301  ").data).toBe("é");
  });

  it("S-P18-T8: eşleşmemiş vekil, U+2028/2029, bidi (202A–202E, 2066–2069), tab/CR, ZWSP reddedilir", () => {
    for (const bad of [
      "a\uD800b",
      "a\uDC00",
      "x\u2028y",
      "x\u2029y",
      "x\u202Ey",
      "x\u2066y",
      "x\u2069y",
      "a\tb",
      "a\rb",
      "a\u200Bb",
      "a\u0000",
    ])
      expect(ok(bad).success, JSON.stringify(bad)).toBe(false);
    expect(isWellFormedText("😀")).toBe(true);
    expect(isWellFormedText("\uD83D")).toBe(false);
  });

  it("S-P18-T8: ZWJ ve VS16 (emoji) izinli; \\n serbest, \\r\\n → \\n; en çok 20 satır", () => {
    expect(ok("👩\u200D💻 ❤\uFE0F").success).toBe(true);
    expect(ok("a\r\nb").data).toBe("a\nb");
    expect(ok(Array(20).fill("x").join("\n")).success).toBe(true);
    expect(ok(Array(21).fill("x").join("\n")).success).toBe(false);
    expect(ok(Array(21).fill("x").join("\r\n")).success).toBe(false);
  });

  it("S-P18-T8: HTML gövde metin olarak kabul edilir (gösterim metin düğümü; sunucu kaçışlamaz)", () => {
    expect(ok("<img src=x onerror=alert(1)>").data).toBe("<img src=x onerror=alert(1)>");
  });

  it("AC-255: REST gövdesi strict; clientMsgId biçimi; after ULID", () => {
    expect(sendRequestMessageInputSchema.safeParse({ body: "Merhaba", clientMsgId: "m-1" }).success).toBe(true);
    expect(sendRequestMessageInputSchema.safeParse({ body: "Merhaba", clientMsgId: "a".repeat(37) }).success).toBe(false);
    expect(sendRequestMessageInputSchema.safeParse({ body: "Merhaba", clientMsgId: "m 1" }).success).toBe(false);
    expect(sendRequestMessageInputSchema.safeParse({ body: "Merhaba", clientMsgId: "m", sender: "TECH" }).success).toBe(false);
    expect(listRequestMessagesQuerySchema.safeParse({}).success).toBe(true);
    expect(listRequestMessagesQuerySchema.safeParse({ after: "x" }).success).toBe(false);
  });
});

describe("AC-255 / S-P18-T1 WS sözleşmesi ve geriye uyum", () => {
  it("S-P18-T1: yeteneksiz şema request.message'ı reddeder (1008 yolu); yetenekli şema kabul eder", () => {
    const m = { t: "request.message", body: "Merhaba", clientMsgId: "m-1" };
    expect(requestInboundSchema.safeParse(m).success).toBe(false);
    expect(requestInboundChatSchema.safeParse(m).success).toBe(true);
    expect(requestInboundChatSchema.safeParse({ t: "request.cancel" }).success).toBe(true);
    expect(WS_REQUEST_CAP_CHAT).toBe("rs.cap.chat1");
  });

  it("AC-255: fikstür requestChat* valid geçer, invalid reddedilir; panel request.activity gövde taşımaz", () => {
    for (const m of fx.valid.requestChatInbound ?? []) expect(requestInboundChatSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.requestChatInbound ?? [])
      expect(requestInboundChatSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    for (const m of fx.valid.requestChatOutbound ?? [])
      expect(requestChatOutboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.requestChatOutbound ?? [])
      expect(requestChatOutboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    expect(fx.valid.requestChatInbound?.length).toBeGreaterThan(0);
    expect(fx.valid.requestChatOutbound?.length).toBeGreaterThan(0);
  });

  it("AC-255 geriye uyum: yeni sunucu→istemci tiplerinin HİÇBİRİ eski requestOutbound şemasından geçmez (0.11.0 ParseServer eşi)", () => {
    for (const m of fx.valid.requestChatOutbound ?? []) expect(requestOutboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    // Go `ParseServer` fikstür testi yalnız valid/invalid.requestOutbound ve 2 öğeli requestInbound'u okur — değişmedi.
    expect(fx.valid.requestInbound).toEqual([{ t: "request.cancel" }, { t: "request.decline" }]);
    for (const m of fx.valid.requestOutbound ?? []) expect((m as { t: string }).t.startsWith("request.message")).toBe(false);
  });

  it("AC-255: request.new customerChat opsiyonel; request.activity strict (gövde yok)", () => {
    const base = {
      t: "request.activity",
      id: "01JC0000000000000000000001",
      kind: "message",
      sender: "TECH",
      at: "2026-11-15T10:00:00.000Z",
    };
    expect(panelOutboundSchema.safeParse(base).success).toBe(true);
    expect(panelOutboundSchema.safeParse({ ...base, body: "x" }).success).toBe(false);
  });

  it("S-P18-T3: support_requests.message ADMIN açık, USER kapalı; CHAT_UNSUPPORTED 409", () => {
    expect(effectivePermissions("ADMIN", [])).toContain("support_requests.message");
    expect(effectivePermissions("USER", [])).not.toContain("support_requests.message");
    expect(ERROR_STATUS.CHAT_UNSUPPORTED).toBe(409);
  });
});
