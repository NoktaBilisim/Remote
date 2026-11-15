import { PERMISSION_MODULES } from "@remote/contracts/permissions";
import { describe, expect, it } from "vitest";
import { buildRecoveryRegenerate } from "@/lib/account/recovery";
import { stepUpErrorOf } from "@/lib/account/step-up";
import { ApiError } from "@/lib/api";
import { blockErrorOf, blockTarget, buildCidrBlock, buildRequestBlock, durationOptions, emptyBlockDraft } from "@/lib/requests/blocks";
import { buildMatrix, keyLabel } from "@/lib/users/permissions";
import { initialTech, techReducer, type TechState } from "@/lib/webrtc/tech-machine";
import { fileVerificationLabel } from "@remote/contracts/labels";
import type { ServerOutbound } from "@remote/contracts/ws";

describe("AC-231: kurtarma kodlarını yenile", () => {
  it("AC-231: yalnız 6 haneli TOTP; boş/biçimsiz istek atmaz", () => {
    expect(buildRecoveryRegenerate("")).toEqual({ error: "v.required" });
    expect(buildRecoveryRegenerate("12345").error).toBe("mfa.v.codeInvalid");
    expect(buildRecoveryRegenerate("abcde-23456").error).toBe("mfa.v.codeInvalid"); // kurtarma koduyla yenileme yok
    expect(buildRecoveryRegenerate(" 123456 ").body).toEqual({ code: "123456" });
  });
  it("AC-231: hatalı kod alanı temizler; 429 kilit dakikası", () => {
    expect(stepUpErrorOf(new ApiError(400, "VALIDATION", "x", { code: "Kod hatalı" }), "TOTP").clear).toBe(true);
    expect(stepUpErrorOf(new ApiError(429, "RATE_LIMITED", "x", undefined, undefined, 300), "TOTP").message).toMatch("5 dakika");
  });
});

describe("AC-234: konsol paylaşım hatası etiketi", () => {
  const live = (): TechState => ({ ...initialTech, phase: "live", guest: { name: "M", kind: "AGENT" } });
  const msg = (m: ServerOutbound, s = live()) => techReducer(s, { type: "msg", m, now: 1 });
  it("AC-234: bilinen neden + yöntem Türkçe; bilinmeyen ham; nedensiz (0.10.x) null", () => {
    let s = msg({ t: "share.state", state: "stopped", reason: "NO_H264_ENCODER", method: "GDI" });
    expect(s.shareFail).toBe("Bilgisayarda görüntü kodlayıcı (H.264) bulunamadı — Yedek yakalama (GDI)");
    s = msg({ t: "share.state", state: "stopped", reason: "FUTURE_CODE" }, s);
    expect(s.shareFail).toBe("Bilinmeyen neden (FUTURE_CODE)");
    s = msg({ t: "share.state", state: "sharing" }, s);
    expect(s.shareFail).toBeNull();
    expect(msg({ t: "share.state", state: "stopped" }).shareFail).toBeNull();
  });
  it("AC-234: müşteri ayrılınca neden temizlenir", () => {
    const s = msg({ t: "share.state", state: "stopped", reason: "OTHER" });
    expect(msg({ t: "peer.left", role: "guest" }, s).shareFail).toBeNull();
  });
});

describe("AC-235: talep engeli formu", () => {
  it("AC-235: CIDR doğrulama contracts'tan; boş zorunlu, geniş önek reddi, süresiz null", () => {
    expect(buildCidrBlock(emptyBlockDraft()).errors.cidr).toBeTruthy();
    expect(buildCidrBlock({ ...emptyBlockDraft(), cidr: "10.0.0.0/16" }).errors.cidr).toMatch("/24");
    expect(buildCidrBlock({ ...emptyBlockDraft(), cidr: "2001:db8::/32" }).errors.cidr).toMatch("/48");
    const ok = buildCidrBlock({ cidr: "203.0.113.7", duration: "none", note: " not " });
    expect(ok.body).toMatchObject({ source: "CIDR", cidr: "203.0.113.7", durationHours: null });
    expect(buildCidrBlock({ cidr: "203.0.113.7", duration: "24", note: "a​b" }).errors.note).toBeTruthy();
  });
  it("AC-235: talep kısayolu gövdesi; süre seçenekleri 1 sa – süresiz", () => {
    expect(buildRequestBlock("01JRQ00000000000000000000A", "DEVICE", { duration: "168", note: "" }).body).toMatchObject({
      source: "REQUEST",
      target: "DEVICE",
      durationHours: 168,
    });
    expect(durationOptions().map((o) => o.label)).toEqual(["1 saat", "1 gün", "7 gün", "30 gün", "Süresiz"]);
  });
  it("AC-235: sunucu hataları alana/forma; hedef metni", () => {
    expect(blockErrorOf(new ApiError(409, "CONFLICT", "Bu kaynak zaten engelli.")).fields.cidr).toBe("Bu kaynak zaten engelli.");
    expect(blockErrorOf(new ApiError(409, "CONFLICT", "Firma başına en çok 1000 engel")).message).toMatch("1000");
    expect(blockErrorOf(new ApiError(400, "VALIDATION", "x", { note: "Uzun" })).fields.note).toBe("Uzun");
    expect(blockTarget({ kind: "IP", cidr: "203.0.113.7/32", deviceFingerprint: null })).toBe("203.0.113.7");
    expect(blockTarget({ kind: "IP", cidr: "2001:db8::/48", deviceFingerprint: null })).toBe("2001:db8::/48");
    expect(blockTarget({ kind: "DEVICE", cidr: null, deviceFingerprint: "a1b2c3d4" })).toBe("Bilgisayar a1b2c3d4");
  });
});

describe("AC-237: yetki toggle'ları tanımdan otomatik", () => {
  it("AC-237: support_requests.block ve users.delete matriste, etiketli", () => {
    const rows = buildMatrix(PERMISSION_MODULES);
    const sr = rows.find((r) => r.module === "support_requests")!;
    expect(sr.other.map((o) => o.key)).toContain("support_requests.block");
    expect(rows.find((r) => r.module === "users")!.cells.delete).toBe("users.delete");
    expect(keyLabel("support_requests.block")).toBe("Destek talepleri — Engelle");
  });
});

describe("AC-238: dosya doğrulama etiketi", () => {
  it("AC-238: doğrulanmış / müşteri bildirimi", () => {
    expect(fileVerificationLabel(true)).toBe("Doğrulanmış");
    expect(fileVerificationLabel(false)).toBe("Müşteri bildirimi");
  });
});
