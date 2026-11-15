// P20 çoklu firma kaydı sözleşmesi (mimari-protokol §6.1, mimari-e11 §8d.2/§8d.5). Go istemci aynı fikstürü kullanır.
import { describe, expect, it } from "vitest";
import bindingsFixture from "../fixtures/bindings.json" with { type: "json" };
import { BINDING_LIMIT_MESSAGE } from "../src/api/bindings.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import {
  BINDING_MAX_PER_DEVICE,
  BINDING_MULTI_MIN_VERSION,
  bindingRequestEnvelopeSchema,
  bindingRequestSchema,
  guestInboundSchema,
  serverOutboundSchema,
  WS_ERROR_CODES,
} from "../src/ws.ts";

const mx = (
  bindingsFixture as unknown as {
    multi: {
      constants: { minVersion: string; maxPerDevice: number };
      errorCode: string;
      valid: { guestInbound: unknown[]; serverOutbound: unknown[] };
      invalid: { guestInbound: unknown[]; serverOutbound: unknown[] };
      exclusive: unknown[];
    };
  }
).multi;

describe("P20 contracts — binding.* çoklu firma eki", () => {
  it("AC-254: sabitler ve BINDING_LIMIT kodu fikstürle aynı", () => {
    expect(mx.constants).toEqual({ minVersion: BINDING_MULTI_MIN_VERSION, maxPerDevice: BINDING_MAX_PER_DEVICE });
    expect(BINDING_MULTI_MIN_VERSION).toBe("0.12.0");
    expect(WS_ERROR_CODES).toContain(mx.errorCode);
    expect(ERROR_STATUS.BINDING_LIMIT).toBe(409);
    expect(BINDING_LIMIT_MESSAGE.length).toBeLessThanOrEqual(300);
  });

  it("AC-254: multi.valid örnekleri şemalardan geçer", () => {
    for (const m of mx.valid.guestInbound) expect(guestInboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    for (const m of mx.valid.serverOutbound) expect(serverOutboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
  });

  it("AC-254: multi.invalid örnekleri reddedilir (boş/6 öğe/yinelenen/biçim dışı anahtar, full:false, previousIndex aralık dışı)", () => {
    for (const m of mx.invalid.guestInbound) expect(guestInboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    for (const m of mx.invalid.serverOutbound) expect(serverOutboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
  });

  it("AC-254: previousKey + previousKeys zarfı geçer, tam şemayı geçmez (sunucu error VALIDATION)", () => {
    for (const m of mx.exclusive) {
      expect(bindingRequestEnvelopeSchema.safeParse(m).success).toBe(true);
      expect(bindingRequestSchema.safeParse(m).success).toBe(false);
      expect(guestInboundSchema.safeParse(m).success).toBe(false);
    }
  });

  it("AC-254: eski (≤ 0.11.x) biçimler değişmedi — fikstürün P8c örnekleri aynen geçerli", () => {
    const v = (bindingsFixture as unknown as { valid: { guestInbound: unknown[]; serverOutbound: unknown[] } }).valid;
    for (const m of v.guestInbound) expect(guestInboundSchema.safeParse(m).success).toBe(true);
    for (const m of v.serverOutbound) expect(serverOutboundSchema.safeParse(m).success).toBe(true);
  });
});
