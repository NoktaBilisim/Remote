import { describe, expect, it } from "vitest";
import type { ServerOutbound } from "@remote/contracts/ws";
import { ApiError } from "@/lib/api";
import { initialTech, techReducer } from "@/lib/webrtc/tech-machine";
import { bodyOf, canAddRow, newRow, signature, validateContacts } from "./contacts";
import { CONNECT_BLOCKED_REASON_LABELS, UNATTENDED_OFF_BANNER, type DeviceListItem } from "./contract";
import { connectBlock, createCodeBlock, gateOpen, isContactMissing, isSmtpMissing, unattendedUiError } from "./errors";
import { appendPage, devicesApiPath, devicesHref, deviceSessionsPath, mergePoll, parseDeviceParams, pollLimit } from "./query";

const ID = "01JXN0000000000000000DEV01";
const dev = (o: Partial<DeviceListItem> = {}): DeviceListItem => ({
  id: ID,
  name: "PC",
  customerId: "01JXN0000000000000000CXS01",
  customerName: "Acme",
  online: true,
  localEnabled: true,
  signatureOk: true,
  lastSeenAt: null,
  lastSessionAt: null,
  grantCount: 1,
  canConnect: true,
  connectBlockedReason: null,
  verified: true,
  notifyFailed: false,
  replacedAlert: false,
  ...o,
});

describe("P27-K8 liste sorgusu", () => {
  it("geçersiz değerleri yok sayar, varsayılanları URL'ye yazmaz", () => {
    expect(parseDeviceParams({ q: "a", customerId: "x", state: "bad" })).toEqual({ q: undefined, customerId: undefined, state: "all" });
    expect(parseDeviceParams({ q: " pc ", customerId: ID, state: "online" })).toEqual({ q: "pc", customerId: ID, state: "online" });
    expect(parseDeviceParams({ q: "x".repeat(65) }).q).toBeUndefined();
    expect(devicesHref({ state: "all" })).toBe("/unattended");
    expect(devicesHref({ q: "pc", state: "offline" })).toBe("/unattended?q=pc&state=offline");
  });
  it("API yolu durum ve limiti her zaman taşır; imleç isteğe bağlı", () => {
    expect(devicesApiPath({ state: "all" })).toBe("/unattended/devices?state=all&limit=50");
    expect(devicesApiPath({ state: "online", customerId: ID }, { cursor: "abcd", limit: 80 })).toBe(
      `/unattended/devices?customerId=${ID}&state=online&cursor=abcd&limit=80`,
    );
  });
  it("yoklama: ≤ 100 satırda tam yenileme, fazlasında yerinde güncelleme", () => {
    expect(pollLimit(3)).toBe(50);
    expect(pollLimit(70)).toBe(70);
    expect(pollLimit(300)).toBe(100);
    const prev = { items: [dev()], nextCursor: null };
    const next = { items: [dev({ id: "01JXN0000000000000000DEV02" })], nextCursor: null };
    expect(mergePoll(prev, next, 50)).toBe(next);
    const many = { items: Array.from({ length: 101 }, (_, i) => dev({ id: `D${i}`, online: true })), nextCursor: "zzzz" };
    const merged = mergePoll(many, { items: [dev({ id: "D0", online: false })], nextCursor: null }, 100);
    expect(merged.items[0]!.online).toBe(false);
    expect(merged.items).toHaveLength(101);
    expect(merged.nextCursor).toBe("zzzz");
  });
  it("sayfa ekleme tekrarı atar", () => {
    expect(
      appendPage({ items: [dev()], nextCursor: "a1b2" }, { items: [dev(), dev({ id: "X" })], nextCursor: null }).items.map((d) => d.id),
    ).toEqual([ID, "X"]);
  });
  it("son 20 gözetimsiz oturum yolu", () => {
    expect(deviceSessionsPath(ID)).toBe(`/sessions?mode=UNATTENDED&deviceId=${ID}&page=1&pageSize=20`);
  });
});

describe("P27-K8 düğme nedenleri (AC-336, 297)", () => {
  it("kapı kapalıyken bant metni; değilse sunucu nedeni", () => {
    expect(connectBlock(dev(), false)).toBe(UNATTENDED_OFF_BANNER);
    expect(connectBlock(dev(), true)).toBeNull();
    expect(connectBlock(dev({ canConnect: false, connectBlockedReason: "smtp" }), true)).toBe(
      "Bildirim e-postası yapılandırılmamış — Ayarlar → SMTP",
    );
    expect(connectBlock(dev({ canConnect: false, connectBlockedReason: null }), true)).toBe(CONNECT_BLOCKED_REASON_LABELS.no_grant);
  });
  it("Kayıt kodu oluştur: status.notifyChannel=false baştan pasif yapar (AC-336)", () => {
    const st = (available: boolean, notifyChannel: boolean) => ({ mode: "unsigned" as const, available, notifyChannel });
    expect(createCodeBlock(st(true, true))).toBeNull();
    expect(createCodeBlock(st(true, false))).toBe(CONNECT_BLOCKED_REASON_LABELS.smtp);
    expect(createCodeBlock(st(false, true))).toBe(UNATTENDED_OFF_BANNER);
    expect(createCodeBlock(null)).toBe(UNATTENDED_OFF_BANNER);
    expect(gateOpen(null)).toBe(false);
    expect(gateOpen(st(true, true))).toBe(true);
  });
  it("hata kodları Türkçe metne; 404 varlık sızdırmaz", () => {
    expect(unattendedUiError(new ApiError(409, "DEVICE_BUSY", "x")).message).toBe("Cihazda başka bir gözetimsiz bağlantı var");
    expect(unattendedUiError(new ApiError(404, "NOT_FOUND", "x")).message).toMatch(/bulunamadı ya da/);
    expect(isSmtpMissing(new ApiError(409, "NOTIFY_CHANNEL_UNAVAILABLE", "x"))).toBe(true);
    expect(isContactMissing(new ApiError(409, "NOTIFY_CONTACT_REQUIRED", "x"))).toBe(true);
  });
});

describe("P27-K8 bildirim adresleri formu (AC-296, 337)", () => {
  it("boş telefon gövdeye girmez; en çok 5 satır", () => {
    const rows = [newRow({ email: " a@x.com ", phone: null })];
    expect(bodyOf(rows)).toEqual({ items: [{ email: "a@x.com" }] });
    expect(canAddRow(Array.from({ length: 5 }, () => newRow()))).toBe(false);
    expect(signature(rows)).toBe(signature([{ email: "a@x.com", phone: "" }]));
  });
  it("alan hataları satır anahtarına eşlenir (geçersiz e-posta, tekrar eden adres)", () => {
    const v = validateContacts([
      newRow({ email: "Ad+1@x.com", phone: null }),
      newRow({ email: "ad@x.com", phone: null }),
      newRow({ email: "bozuk", phone: null }),
    ]);
    expect(v.body).toBeUndefined();
    expect(v.errors["items.1.email"]).toBe("Bu adres listede zaten var");
    expect(v.errors["items.2.email"]).toBeDefined();
    expect(validateContacts([]).body).toEqual({ items: [] });
  });
});

describe("P27-K8 konsol (mimari-p27 §4.6)", () => {
  it("hello{unattended} cihaz adını tutar; sonraki hello'da alan yoksa korunur", () => {
    const hello = (extra: object) =>
      ({
        t: "hello",
        role: "tech",
        sessionId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
        peerPresent: false,
        iceServers: [],
        maxEndsAt: null,
        ...extra,
      }) as ServerOutbound;
    const a = techReducer(initialTech, { type: "msg", m: hello({ unattended: { deviceId: ID, deviceName: "MUHASEBE-PC" } }), now: 1 });
    expect(a.unattended).toEqual({ deviceId: ID, deviceName: "MUHASEBE-PC" });
    expect(techReducer(a, { type: "msg", m: hello({}), now: 2 }).unattended?.deviceName).toBe("MUHASEBE-PC");
    expect(initialTech.unattended).toBeNull();
  });
});
