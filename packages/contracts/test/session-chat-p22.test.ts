// P22-C sözleşme testleri (mimari-p22 r2 §4, §5.2, §7.1, §3.4, §15; AC-264, AC-291, AC-292). Fikstür
// `fixtures/ws-session-chat.json` Go (P22-G internal/signal) ile ortaktır.
import { describe, expect, it } from "vitest";
import fx from "../fixtures/ws-session-chat.json" with { type: "json" };
import * as requests from "../src/api/requests.ts";
import { sessionChatQuerySchema, SESSION_CHAT_PAGE_MAX } from "../src/api/sessions.ts";
import { CHAT_AUDIT, CHAT_AUDIT_LABELS, CHAT_AUDIT_REJECT_REASONS, CHAT_SUMMARY_SENDER_IDS_MAX } from "../src/audit.ts";
import * as chat from "../src/chat.ts";
import { CHAT_MAX_CHARS } from "../src/dc.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS } from "../src/permissions.ts";
import { ROLE_MAY, seatMay } from "../src/ws-multi.ts";
import * as wsChat from "../src/ws-chat.ts";
import { REQUEST_HISTORY_MAX_BYTES } from "../src/ws-request.ts";
import { guestInboundSchemaFor, serverOutboundSchema, techInboundSchema, WS_CLOSE, WS_MAX_PAYLOAD } from "../src/ws.ts";

type Schema = { safeParse: (v: unknown) => { success: boolean } };
const ok = (s: Schema, v: unknown) => s.safeParse(v).success;
const show = (m: unknown) => JSON.stringify(m).slice(0, 120);
/** UTF-8 bayt sayısı (paket @types/node / DOM lib kullanmaz). */
const utf8Bytes = (v: string): number =>
  [...v].reduce((n, c) => {
    const cp = c.codePointAt(0) ?? 0;
    return n + (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  }, 0);
const ALL_FEATURES = new Set(["clipboard", "print"] as const);
/** Eski (belirteçsiz) misafir şemaları: hiçbir bit / schat dışındaki tüm bitler (63). */
const legacyGuests = [guestInboundSchemaFor(new Set()), guestInboundSchemaFor(ALL_FEATURES, true, true, true, true, false)];
const schatGuest = guestInboundSchemaFor(new Set(), false, false, false, false, true);
const schatFullGuest = guestInboundSchemaFor(ALL_FEATURES, true, true, true, true, true);

describe("P22 yetki (AC-264, K-P22-4)", () => {
  it("AC-264: sessions.view_chat tek tanımdan; Admin açık, User kapalı; açıklama hassas uyarısı taşır", () => {
    expect(PERMISSION_KEYS).toContain("sessions.view_chat");
    expect(effectivePermissions("ADMIN", [])).toContain("sessions.view_chat");
    expect(effectivePermissions("USER", [])).not.toContain("sessions.view_chat");
    expect(effectivePermissions("USER", [{ permKey: "sessions.view_chat", granted: true }])).toEqual(["sessions.view_chat"]);
    expect(PERMISSION_DESCRIPTIONS["sessions.view_chat"]).toBe(
      "Oturum geçmişinde sohbet ve talep yazışmasını görüntüler (hassas — yalnız gerekene verin).",
    );
  });
});

describe("P22 sabitler ve metinler (fikstür — Go aynı dosyayı okur)", () => {
  it("AC-264 (S-P22-1/2): fikstür constants/sets sözleşmeyle aynı; belirteç rs.cap.schat1; 4426 WS_CLOSE'da", () => {
    const mod = { ...chat, ...wsChat } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(fx.constants)) {
      const actual = mod[k];
      expect(actual instanceof RegExp ? actual.source : actual, k).toEqual(v);
    }
    expect(fx.subprotocols.schat).toBe(wsChat.WS_CAP_SCHAT);
    expect(fx.sets).toEqual({
      rejectReasons: wsChat.CHAT_REJECT_REASONS,
      guestChat: wsChat.GUEST_CHAT_STATES,
      stateReasons: wsChat.CHAT_STATE_REASONS,
    });
    expect(wsChat.CHAT_REJECT_REASONS).toContain("outdated");
    expect(WS_CLOSE.CONSOLE_OUTDATED).toBe(4426);
    expect(new Set(Object.values(WS_CLOSE)).size).toBe(Object.values(WS_CLOSE).length);
  });

  it("AC-264 (S-P22-1): geçmiş bütçeleri 48 KiB < WS_MAX_PAYLOAD (Go 64 KiB); tek en büyük chat.message çerçevesi < 64 KiB", () => {
    expect(wsChat.CHAT_HISTORY_MAX_BYTES).toBe(48 * 1024);
    expect(REQUEST_HISTORY_MAX_BYTES).toBe(48 * 1024);
    expect(wsChat.CHAT_HISTORY_MAX_BYTES).toBeLessThan(WS_MAX_PAYLOAD);
    // En kötü gövde: 1.000 kod noktası, her biri JSON'da kaçışlı ya da 4 bayt.
    const worst = {
      t: "chat.message",
      id: "01JC5Z8X4N2M7Q9R3T6V0W1Y2A",
      sender: "TECH",
      tid: "Ab3_xY9-kLm",
      senderName: "Ğ".repeat(100),
      body: "😀".repeat(1000),
      createdAt: "2026-11-17T10:00:00.000Z",
      clientMsgId: "a".repeat(36),
    };
    expect(ok(serverOutboundSchema, worst)).toBe(true);
    const bytes = utf8Bytes(JSON.stringify(worst));
    expect(bytes).toBeLessThan(wsChat.CHAT_HISTORY_MAX_BYTES);
    // Bütçe en az ~11 öğe garantiler (§15.1).
    expect(Math.floor(wsChat.CHAT_HISTORY_MAX_BYTES / bytes)).toBeGreaterThanOrEqual(10);
    expect(requests.MESSAGE_HISTORY_WS).toBe(50);
  });

  it("AC-291 (S-P22-6): aydınlatma paragrafı anahtar cümleyi ve koşullu ifadeleri içerir; gün sayısı gömülmez", () => {
    expect(chat.CHAT_CONSENT_PARAGRAPH).toContain(chat.CHAT_CONSENT_KEY_SENTENCE);
    expect(fx.texts.consentKeySentence).toBe(chat.CHAT_CONSENT_KEY_SENTENCE);
    expect(chat.CHAT_CONSENT_PARAGRAPH).toContain("uçtan uca şifreli değildir");
    expect(chat.CHAT_CONSENT_PARAGRAPH).toContain("anonimleştirilirken silinir");
    expect(chat.CHAT_CONSENT_PARAGRAPH).toContain("Sohbete şifre veya kart bilgisi yazmayınız.");
    expect(chat.CHAT_CONSENT_PARAGRAPH).not.toMatch(/\d/);
    expect(chat.CHAT_CONSENT_PARAGRAPH).not.toMatch(/ {2}|\n/);
    expect(chat.CHAT_CONSENT_PARAGRAPH.normalize("NFC")).toBe(chat.CHAT_CONSENT_PARAGRAPH);
  });

  it("AC-292: saklama satırı biçimi; eski istemci bildirimi (K-P22-3) sabit ve DC sınırına sığar", () => {
    expect(chat.CHAT_RETENTION_LINE(90)).toBe(fx.texts.retentionLine90);
    expect(chat.LEGACY_CHAT_NOTICE).toBe(fx.texts.legacyNotice);
    expect(chat.LEGACY_CHAT_NOTICE.length).toBeLessThanOrEqual(CHAT_MAX_CHARS);
  });
});

describe("P22 WS protokolü (AC-264)", () => {
  it("AC-264: teknisyen chat.send her zaman şemada; gövde P18 kuralı (NFC + trim, 1..1000 kod noktası, ≤ 20 satır)", () => {
    for (const m of fx.valid.techInbound) expect(ok(techInboundSchema, m), show(m)).toBe(true);
    for (const m of fx.invalid.techInbound) expect(ok(techInboundSchema, m), show(m)).toBe(false);
    for (const m of fx.invalid.bodyOnly) expect(ok(techInboundSchema, m), show(m)).toBe(false);
    const parsed = techInboundSchema.parse({ t: "chat.send", clientMsgId: "b".repeat(16), body: "  e\u0301\r\n  " });
    expect(parsed).toEqual({ t: "chat.send", clientMsgId: "b".repeat(16), body: "é" });
  });

  it("AC-264: gövde hatası zarfı geçer (→ chat.rejected{invalid}, soket açık); zarf hatası 1008", () => {
    for (const m of fx.invalid.bodyOnly) {
      expect(ok(wsChat.chatSendEnvelopeSchema, m), show(m)).toBe(true);
      expect(ok(wsChat.chatSendSchema, m), show(m)).toBe(false);
    }
    for (const m of fx.invalid.techInbound) expect(ok(wsChat.chatSendEnvelopeSchema, m), show(m)).toBe(false);
  });

  it("AC-264: eski (belirteçsiz) misafir şemasında chat.send şema dışı → 1008 (satır 0); schat1 sokette kabul", () => {
    for (const m of fx.valid.guestInbound) {
      for (const legacy of legacyGuests) expect(ok(legacy, m), show(m)).toBe(false);
      expect(ok(schatGuest, m), show(m)).toBe(true);
      expect(ok(schatFullGuest, m), show(m)).toBe(true);
    }
    for (const m of fx.invalid.guestInbound) expect(ok(schatFullGuest, m), show(m)).toBe(false);
    // schat biti diğer bitlerin kurallarını bozmaz (multi `to` zorunlu, voice/rec şemada).
    expect(ok(schatFullGuest, { t: "rec.revoke" })).toBe(true);
    expect(ok(schatFullGuest, { t: "sdp.answer", sdp: "v=0" })).toBe(false);
    expect(ok(schatGuest, { t: "sdp.answer", sdp: "v=0" })).toBe(true);
    expect(ok(schatGuest, { t: "rec.revoke" })).toBe(false);
  });

  it("AC-264: sunucu → schat1 misafir chat.message/history/state/rejected; CUSTOMER'da ad/tid yok", () => {
    for (const m of fx.valid.guestOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(true);
    for (const m of fx.invalid.guestOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(false);
  });

  it("AC-264: konsola hello/peer.joined guestChat (on|outdated), clientMsgId yalnız yankıda, geçmiş öğesinde yok", () => {
    for (const m of fx.valid.techOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(true);
    for (const m of fx.invalid.techOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(false);
  });

  it("AC-264 (S-P22-1): chat.history ≤ 100 öğe; chat.message gövdesi ≤ 2.000 UTF-16 birimi", () => {
    const item = { id: "01JC5Z8X4N2M7Q9R3T6V0W1Y2A", sender: "CUSTOMER", body: "a", createdAt: "2026-11-17T10:00:00.000Z" };
    expect(ok(serverOutboundSchema, { t: "chat.history", items: Array(100).fill(item), more: true })).toBe(true);
    expect(ok(serverOutboundSchema, { t: "chat.history", items: Array(101).fill(item), more: true })).toBe(false);
    expect(ok(serverOutboundSchema, { t: "chat.message", ...item, body: "a".repeat(2000) })).toBe(true);
    expect(ok(serverOutboundSchema, { t: "chat.message", ...item, body: "a".repeat(2001) })).toBe(false);
  });
});

describe("P22 rol kapısı ROLE_MAY (S-P22-8)", () => {
  it("AC-264: chat.send talker — izleyici gönderemez; sahip ve katılımcı gönderir; observer alanı yoksa kapalı", () => {
    expect(ROLE_MAY["chat.send"]).toBe("talker");
    expect(seatMay("chat.send", { owner: false, controller: false, observer: true })).toBe(false);
    expect(seatMay("chat.send", { owner: false, controller: false, observer: false })).toBe(true);
    expect(seatMay("chat.send", { owner: true, controller: true, observer: false })).toBe(true);
    expect(seatMay("chat.send", { owner: false, controller: false } as unknown as Parameters<typeof seatMay>[1])).toBe(false);
  });
});

describe("P22 audit (§7.1, r2 §15.4)", () => {
  it("AC-264: dört eylem session.chat_* önekli ve etiketli; ret nedenleri CHAT_REJECT_REASONS alt kümesi (+ outdated)", () => {
    expect(Object.values(CHAT_AUDIT)).toEqual([
      "session.chat_viewed",
      "session.chat_summary",
      "session.chat_rejected",
      "session.chat_legacy",
    ]);
    for (const a of Object.values(CHAT_AUDIT)) expect(CHAT_AUDIT_LABELS[a]).toBeTruthy();
    expect(CHAT_AUDIT_REJECT_REASONS).toEqual(["cap", "forbidden", "internal", "outdated"]);
    for (const r of CHAT_AUDIT_REJECT_REASONS) expect(wsChat.CHAT_REJECT_REASONS).toContain(r);
    expect(CHAT_SUMMARY_SENDER_IDS_MAX).toBe(10);
  });
});

describe("P22 REST ve P18 taşıma (§4.2, §5.1)", () => {
  it("AC-264: GET /sessions/:id/chat sorgusu yalnız after (ULID); sayfa üst sınırı 200", () => {
    expect(ok(sessionChatQuerySchema, {})).toBe(true);
    expect(ok(sessionChatQuerySchema, { after: "01JC5Z8X4N2M7Q9R3T6V0W1Y2A" })).toBe(true);
    expect(ok(sessionChatQuerySchema, { after: "x" })).toBe(false);
    expect(ok(sessionChatQuerySchema, { after: "01JC5Z8X4N2M7Q9R3T6V0W1Y2A", limit: 500 })).toBe(false);
    expect(SESSION_CHAT_PAGE_MAX).toBe(200);
  });

  it("AC-255: P18 adları aynı tek tanıma bağlı (gövde şeması, sınırlar, gönderenler, karakter yardımcıları)", () => {
    expect(requests.requestMessageBodySchema).toBe(chat.chatBodySchema);
    expect(requests.MESSAGE_BODY_MAX).toBe(chat.MESSAGE_BODY_MAX);
    expect(requests.MESSAGE_LINES_MAX).toBe(chat.MESSAGE_LINES_MAX);
    expect(requests.MESSAGE_SENDERS).toBe(chat.MESSAGE_SENDERS);
    expect(requests.isWellFormedText).toBe(chat.isWellFormedText);
    expect(requests.hasUnsafeMessageChars).toBe(chat.hasUnsafeMessageChars);
  });
});
