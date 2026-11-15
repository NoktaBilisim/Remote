import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  buildWebRequest,
  emptyDraft,
  newClientInstanceId,
  readStored,
  reconnectDelay,
  remainingDelay,
  requestProtocols,
  shouldReconnect,
  storeKeyOf,
  submitFailure,
} from "./flow";

const REF = "abcdefghijklmnop";
const info = {
  consentText: { id: "01JC5ST0000000000000000001", version: 1, body: "x", sha256: "y" },
  channels: { sms: true, whatsapp: false, email: true },
};
const ctx = { ref: REF, formToken: "A".repeat(40), clientInstanceId: "B".repeat(22), info };
const filled = { ...emptyDraft(), customerName: "Ayşe Yılmaz", phone: "0532 111 22 33", description: "Yazıcı çalışmıyor", consent: true };

describe("P19 web talep formu (AC-259)", () => {
  it("kutucuklar varsayılan işaretsiz; geçerli taslak → gövde", () => {
    expect(emptyDraft().notify).toEqual({ sms: false, whatsapp: false, email: false });
    expect(emptyDraft().consent).toBe(false);
    const { body, errors } = buildWebRequest(filled, ctx);
    expect(errors).toEqual({});
    expect(body?.notify).toEqual({ sms: false, whatsapp: false, email: false });
    expect(body?.website).toBe("");
  });
  it("kapalı kanal işaretlense de false gider; e-posta bildirimi e-posta ister", () => {
    const r = buildWebRequest({ ...filled, notify: { sms: true, whatsapp: true, email: true } }, ctx);
    expect(r.errors.email).toBeTruthy();
    const ok = buildWebRequest({ ...filled, email: "a@ornek.com", notify: { sms: true, whatsapp: true, email: true } }, ctx);
    expect(ok.body?.notify).toEqual({ sms: true, whatsapp: false, email: true });
  });
  it("onay yoksa consent hatası", () => {
    expect(buildWebRequest({ ...filled, consent: false }, ctx).errors.consent).toBeTruthy();
  });
  it("2 sn kuralı ve token yenileme (S-P19-T4)", () => {
    expect(remainingDelay(1000, 1500, 2000)).toBe(1500);
    expect(remainingDelay(1000, 4000, 2000)).toBe(0);
    const fast = submitFailure(new ApiError(429, "RATE_LIMITED", "Lütfen", undefined, undefined, 2), "x");
    expect(fast.failure.kind).toBe("fast");
    expect(fast.refreshToken).toBe(true);
    expect(submitFailure(new ApiError(400, "FORM_TOKEN_INVALID", "Formun süresi doldu"), "x").failure.kind).toBe("token");
    expect(submitFailure(new ApiError(429, "QUEUE_FULL", "yoğun"), "x").failure.kind).toBe("busy");
    expect(submitFailure(new ApiError(409, "OUTSIDE_HOURS", "kapalı"), "x").failure.kind).toBe("outsideHours");
    expect(submitFailure(new ApiError(503, "NOT_READY", "x"), "x").refreshToken).toBe(true);
    expect(submitFailure(new ApiError(500, "INTERNAL", "x"), "x").refreshToken).toBe(false);
    expect(submitFailure(new TypeError("net"), "ağ").failure).toEqual({ kind: "other", message: "ağ" });
  });
  it("sır yalnız sessionStorage anahtarında; bozuk kayıt yok sayılır", () => {
    expect(storeKeyOf(REF)).toBe(`rs.wr.${REF}`);
    const secret = "s".repeat(43);
    const st = { getItem: () => JSON.stringify({ requestSecret: secret, requestCode: "123456", customerName: "A" }) };
    expect(readStored(REF, st)?.requestSecret).toBe(secret);
    expect(readStored(REF, { getItem: () => "{bozuk" })).toBeNull();
    expect(readStored(REF, { getItem: () => JSON.stringify({ requestSecret: "kısa" }) })).toBeNull();
  });
  it("WS alt protokolleri sohbet yeteneğini bildirir; 4xxx'te durur", () => {
    expect(requestProtocols("s".repeat(43))).toEqual(["rs.v1", `rs.req.${"s".repeat(43)}`, "rs.cap.chat1"]);
    expect(shouldReconnect(1006)).toBe(true);
    expect(shouldReconnect(4403)).toBe(false);
    expect(shouldReconnect(1008)).toBe(false);
    expect(reconnectDelay(0)).toBe(1000);
    expect(reconnectDelay(10)).toBe(30_000);
  });
  it("istemci örneği 22 karakter base64url", () => {
    expect(newClientInstanceId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("P19 CSV hata raporu (AC-263)", () => {
  it("BOM + başlık, CRLF, formül kaçışı", async () => {
    const { errorReportCsv } = await import("@/lib/customers/import");
    expect(errorReportCsv([{ line: 5, column: null, message: "=1+1" }])).toBe("﻿Satır;Sütun;Hata\r\n5;;'=1+1\r\n");
  });
});
