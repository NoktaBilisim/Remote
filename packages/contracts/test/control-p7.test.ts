// P7 sözleşmesi: WS control.* / monitor.request / env.state / caps.update ve DC `input` (mimari-protokol §3, §4.3).
// Ortak fixture'lar (ws-messages.json, dc-input.json) apps/server/test/unit'te node fs ile doğrulanır.
import { describe, expect, it } from "vitest";
import { inputMessageSchema, parseCtlMessage, parseInputMessage } from "../src/dc.ts";
import { CONTROL_AUDIT } from "../src/audit.ts";
import { CONTROL_DENY_COOLDOWN_MS, CONTROL_REQUEST_MAX, guestInboundSchema, serverOutboundSchema, techInboundSchema } from "../src/ws.ts";

const j = (o: unknown) => JSON.stringify(o);

describe("P7 WS kontrol mesajları", () => {
  it("AC-47/AC-116: control.request yalnız teknisyenden, alansız; sınırlar 5 istek / 30 sn", () => {
    expect(techInboundSchema.safeParse({ t: "control.request" }).success).toBe(true);
    expect(techInboundSchema.safeParse({ t: "control.request", force: true }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ t: "control.request" }).success).toBe(false);
    expect(CONTROL_REQUEST_MAX).toBe(5);
    expect(CONTROL_DENY_COOLDOWN_MS).toBe(30_000);
  });

  it("AC-99/AC-101: control.state GRANTED yalnız UI kaynağıyla; DENIED/HOTKEY/SYSTEM yalnız VIEW", () => {
    expect(guestInboundSchema.safeParse({ t: "control.state", state: "GRANTED", source: "UI" }).success).toBe(true);
    for (const source of ["UI", "HOTKEY", "DENIED", "SYSTEM"]) {
      expect(guestInboundSchema.safeParse({ t: "control.state", state: "VIEW", source }).success).toBe(true);
    }
    for (const source of ["HOTKEY", "DENIED", "RECONNECT", "SYSTEM", "TECH"]) {
      expect(guestInboundSchema.safeParse({ t: "control.state", state: "GRANTED", source }).success).toBe(false);
    }
    expect(techInboundSchema.safeParse({ t: "control.state", state: "GRANTED", source: "UI" }).success).toBe(false);
  });

  it("S7-10: RECONNECT/TECH kaynağını yalnız sunucu üretir; misafirden gelirse şema hatası", () => {
    for (const source of ["RECONNECT", "TECH"]) {
      expect(guestInboundSchema.safeParse({ t: "control.state", state: "VIEW", source }).success).toBe(false);
      expect(serverOutboundSchema.safeParse({ t: "control.state", state: "VIEW", source }).success).toBe(true);
    }
  });

  it("S7-1/S7-2 (§3.3 K1–K2): control.release/cancel yalnız teknisyenden, alansız; sunucu misafire aynı adla iletir", () => {
    for (const t of ["control.release", "control.cancel"]) {
      expect(techInboundSchema.safeParse({ t }).success).toBe(true);
      expect(techInboundSchema.safeParse({ t, force: true }).success).toBe(false);
      expect(guestInboundSchema.safeParse({ t }).success).toBe(false);
      expect(serverOutboundSchema.safeParse({ t }).success).toBe(true);
    }
  });

  it("AC-43 (§3.3 K4): monitor.denied yalnız misafirden, monitör kimliği 0..64; teknisyene iletilir", () => {
    expect(guestInboundSchema.safeParse({ t: "monitor.denied", monitorId: 0 }).success).toBe(true);
    expect(guestInboundSchema.safeParse({ t: "monitor.denied", monitorId: 65 }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ t: "monitor.denied" }).success).toBe(false);
    expect(techInboundSchema.safeParse({ t: "monitor.denied", monitorId: 1 }).success).toBe(false);
    expect(serverOutboundSchema.safeParse({ t: "monitor.denied", monitorId: 1 }).success).toBe(true);
  });

  it("AC-43/AC-105/S7-9: monitor.request monitör kimliği 0..64; env.state üç zorunlu bool (selfElevated, K8)", () => {
    expect(techInboundSchema.safeParse({ t: "monitor.request", monitorId: 2 }).success).toBe(true);
    expect(techInboundSchema.safeParse({ t: "monitor.request", monitorId: -1 }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: false }).success).toBe(true);
    expect(guestInboundSchema.safeParse({ t: "env.state", elevatedForeground: "yes", secureDesktop: false, selfElevated: false }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ t: "env.state", elevatedForeground: true, secureDesktop: false }).success).toBe(false); // alan eksik
    expect(guestInboundSchema.safeParse({ t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: null }).success).toBe(false);
    expect(serverOutboundSchema.safeParse({ t: "env.state", elevatedForeground: false, secureDesktop: false, selfElevated: true }).success).toBe(true);
    expect(serverOutboundSchema.safeParse({ t: "env.state", elevatedForeground: false, secureDesktop: false }).success).toBe(false);
  });

  it("AC-115/AC-24: sunucu control.revoke (permission|audit|admin|reconnect|stale) ve caps.update gönderir", () => {
    for (const reason of ["permission", "audit", "admin", "reconnect", "stale"]) expect(serverOutboundSchema.safeParse({ t: "control.revoke", reason }).success).toBe(true);
    expect(serverOutboundSchema.safeParse({ t: "control.revoke", reason: "bored" }).success).toBe(false);
    expect(serverOutboundSchema.safeParse({ t: "caps.update", caps: [] }).success).toBe(true);
    expect(serverOutboundSchema.safeParse({ t: "caps.update", caps: ["admin"] }).success).toBe(false);
  });

  it("AC-111: audit action adları tek kaynaktan", () => {
    expect(Object.values(CONTROL_AUDIT)).toEqual(expect.arrayContaining(["control.granted", "control.denied", "control.revoked", "control.released", "control.cancelled", "monitor.granted", "monitor.denied"]));
  });
});

describe("P7 DC input kanalı", () => {
  it("AC-48/49: fare 0..1 normalize, tekerlek ±1200, Türkçe karakter `key` ile", () => {
    expect(parseInputMessage(j({ t: "m.move", x: 1, y: 0 }))).not.toBeNull();
    expect(parseInputMessage(j({ t: "m.move", x: 1.01, y: 0 }))).toBeNull();
    expect(parseInputMessage(j({ t: "m.wheel", dx: 0, dy: -1200 }))).not.toBeNull();
    expect(parseInputMessage(j({ t: "m.wheel", dx: 0, dy: -1201 }))).toBeNull();
    expect(parseInputMessage(j({ t: "k", code: "KeyI", down: true, key: "İ" }))).toMatchObject({ key: "İ" });
    expect(parseInputMessage(j({ t: "k", code: "x".repeat(33), down: true }))).toBeNull();
  });

  it("QA-P7-3: k.code yalnız harf/rakam (Go internal/input ile aynı kural)", () => {
    expect(parseInputMessage(j({ t: "k", code: "Digit1", down: true }))).not.toBeNull();
    for (const code of ["Key-A", "Key A", "", "Ş"]) expect(parseInputMessage(j({ t: "k", code, down: true }))).toBeNull();
  });

  it("G-09: input kanalında control.* veya ctl tipi yok; ctl kanalında input tipi yok", () => {
    expect(parseInputMessage(j({ t: "control.request" }))).toBeNull();
    expect(parseInputMessage(j({ t: "chat", id: "1", text: "x", ts: 1 }))).toBeNull();
    expect(parseCtlMessage(j({ t: "m.move", x: 0, y: 0 }))).toBeNull();
    expect(inputMessageSchema.safeParse({ t: "k.release_all" }).success).toBe(true);
    expect(parseInputMessage("x".repeat(20_000))).toBeNull();
  });
});
