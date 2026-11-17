// P28d-K0 sözleşme testleri (mimari-p28d r2 §4, §6, §7; AC-373..379). Fikstür `fixtures/voice.json` Go (internal/signal) ile ortaktır.
import { describe, expect, it } from "vitest";
import fx from "../fixtures/voice.json" with { type: "json" };
import { MULTI_ERROR_MESSAGES } from "../src/api/multi.ts";
import { TIMELINE_ACTIONS, TIMELINE_DETAIL_KEYS } from "../src/api/sessions.ts";
import {
  VOICE_AUDIT,
  VOICE_AUDIT_GROUP_LABELS,
  VOICE_AUDIT_LABELS,
  VOICE_END_REASON_LABELS,
  VOICE_REJECT_REASON_LABELS,
  VOICE_REJECT_REASONS,
} from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { describeTimelineEvent } from "../src/labels.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS } from "../src/permissions.ts";
import { ROLE_MAY, seatMay } from "../src/ws-multi.ts";
import * as voice from "../src/ws-voice.ts";
import { guestInboundSchemaFor, serverOutboundSchema, techInboundSchema, WS_ERROR_CODES } from "../src/ws.ts";

type Schema = { safeParse: (v: unknown) => { success: boolean } };
const ok = (s: Schema, v: unknown) => s.safeParse(v).success;
const guestVoice = guestInboundSchemaFor(new Set(), false, false, true, true);
const guestNoVoice = guestInboundSchemaFor(new Set(), false, false, true, false);
const show = (m: unknown) => JSON.stringify(m);

describe("P28d yetki ve hata kodu", () => {
  it("AC-373/378: sessions.voice tek tanımdan; Admin açık, User kapalı; açıklama dinlemeyi kapsar", () => {
    expect(PERMISSION_KEYS).toContain("sessions.voice");
    expect(effectivePermissions("ADMIN", [])).toContain("sessions.voice");
    expect(effectivePermissions("USER", [])).not.toContain("sessions.voice");
    expect(PERMISSION_DESCRIPTIONS["sessions.voice"]).toBe(
      "Etkin oturumda müşteriyle sesli görüşme başlatır, katılır ve görüşmeyi dinler.",
    );
  });

  it("AC-379: !hasVoice → mevcut CLIENT_UNSUPPORTED kodu WS hata zarfında (yeni kod yok); metin sözleşmeden", () => {
    expect(WS_ERROR_CODES).toContain("CLIENT_UNSUPPORTED");
    expect(ERROR_STATUS.CLIENT_UNSUPPORTED).toBe(409);
    expect(fx.valid.techOutbound.find((m) => m.t === "error")).toMatchObject({ message: MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED });
  });
});

describe("P28d sabitler (fikstür — Go aynı dosyayı okur)", () => {
  it("AC-373/377: fikstür constants/sets sözleşmeyle aynı; belirteç rs.cap.voice1", () => {
    const mod = voice as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(fx.constants)) {
      const actual = mod[k];
      expect(actual instanceof RegExp ? actual.source : actual, k).toEqual(v);
    }
    expect(fx.subprotocols.voice).toBe(voice.WS_CAP_VOICE);
    expect(fx.sets).toEqual({
      phases: voice.VOICE_PHASES,
      endReasons: voice.VOICE_END_REASONS,
      guestEndReasons: voice.VOICE_GUEST_END_REASONS,
      rejectReasons: VOICE_REJECT_REASONS,
    });
  });
});

describe("P28d WS protokolü", () => {
  it("AC-373/378: teknisyen voice.request {}, voice.join/end {callId}; misafir biçimleri ve nedenli end reddedilir", () => {
    for (const m of fx.valid.techInbound) expect(ok(techInboundSchema, m), show(m)).toBe(true);
    for (const m of fx.invalid.techInbound) expect(ok(techInboundSchema, m), show(m)).toBe(false);
  });

  it("AC-374/377: voice misafir voice.answer/voice.end; belirteçsiz sokette şema dışı (1008)", () => {
    for (const m of fx.valid.guestInbound) {
      expect(ok(guestVoice, m), show(m)).toBe(true);
      expect(ok(guestNoVoice, m), show(m)).toBe(false);
      expect(ok(guestInboundSchemaFor(new Set()), m), show(m)).toBe(false);
    }
    for (const m of fx.invalid.guestInbound) expect(ok(guestVoice, m), show(m)).toBe(false);
    // Tam şema (63): pano/yazdırma/fsrv/rec/multi + voice birlikte; multi kuralları korunur.
    const full = guestInboundSchemaFor(new Set(["clipboard", "print"]), true, true, true, true);
    expect(ok(full, fx.valid.guestInbound[0])).toBe(true);
    expect(ok(full, { t: "rec.revoke" })).toBe(true);
    expect(ok(full, { t: "sdp.answer", sdp: "v=0" })).toBe(false);
    // multi olmadan da voice bağımsız bittir.
    expect(ok(guestInboundSchemaFor(new Set(), false, false, false, true), fx.valid.guestInbound[0])).toBe(true);
  });

  it("AC-373/374/378: misafire voice.request {callId, by} ve voice.state değişmezleri (callId, endReason, talkers ⊆ listeners, ≤ 3)", () => {
    for (const m of fx.valid.guestOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(true);
    for (const m of fx.invalid.guestOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(false);
  });

  it("AC-379: teknisyen hello/peer.joined guestVoice, error CLIENT_UNSUPPORTED, idle bitiş yayını", () => {
    for (const m of fx.valid.techOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(true);
    for (const m of fx.invalid.techOutbound) expect(ok(serverOutboundSchema, m), show(m)).toBe(false);
  });

  it("AC-374 (Y-PD-1): callId 22 karakter base64url; 16 bayt üretimiyle uyumlu", () => {
    // 16 × 0xff → base64url dolgusuz.
    const fromBytes = "_____________________w";
    expect(fromBytes).toHaveLength(22);
    expect(ok(voice.callIdSchema, fromBytes)).toBe(true);
    expect(ok(voice.callIdSchema, `${fromBytes}=`)).toBe(false);
  });
});

describe("P28d rol kapısı ROLE_MAY (AC-378)", () => {
  it("AC-378: izleyici voice.request/join/end gönderemez; sahip ve katılımcı gönderir; observer alanı yoksa kapalı", () => {
    for (const t of ["voice.request", "voice.join", "voice.end"] as const) {
      expect(ROLE_MAY[t]).toBe("talker");
      expect(seatMay(t, { owner: false, controller: false, observer: true }), t).toBe(false);
      expect(seatMay(t, { owner: false, controller: false, observer: false }), t).toBe(true);
      expect(seatMay(t, { owner: true, controller: false, observer: false }), t).toBe(true);
      expect(seatMay(t, { owner: false, controller: true, observer: false }), t).toBe(true);
      // Tip dışı çağrı (JS) `observer`'sız gelirse varsayılan-ret.
      expect(seatMay(t, { owner: false, controller: false } as unknown as Parameters<typeof seatMay>[1]), t).toBe(false);
    }
  });
});

describe("P28d audit (AC-379)", () => {
  it("AC-379: beş eylem (dört AC olayı + voice.join), voice.* önekli, etiketli; neden etiketleri tam", () => {
    expect(Object.values(VOICE_AUDIT)).toEqual(["voice.request", "voice.accept", "voice.reject", "voice.join", "voice.end"]);
    for (const a of Object.values(VOICE_AUDIT)) expect(VOICE_AUDIT_LABELS[a]).toBeTruthy();
    expect(VOICE_AUDIT_GROUP_LABELS).toEqual({ voice: "Sesli görüşme" });
    for (const r of VOICE_REJECT_REASONS) expect(VOICE_REJECT_REASON_LABELS[r]).toBeTruthy();
    for (const r of voice.VOICE_END_REASONS) expect(VOICE_END_REASON_LABELS[r]).toBeTruthy();
  });

  it("AC-379: zaman çizelgesi voice.* eylemlerini taşır; ayrıntı yalnız neden + süre (kullanıcı kimliği yok); Türkçe metin", () => {
    for (const a of Object.values(VOICE_AUDIT)) expect(TIMELINE_ACTIONS as string[]).toContain(a);
    expect(TIMELINE_DETAIL_KEYS["voice.end"]).toEqual(["reason", "durationSec"]);
    expect(TIMELINE_DETAIL_KEYS["voice.reject"]).toEqual(["reason"]);
    expect(describeTimelineEvent({ action: "voice.end", details: { reason: "tech", durationSec: 192 } })).toEqual({
      label: "Sesli görüşme bitti",
      note: "Teknisyen bitirdi · 3 dk 12 sn",
      warn: false,
    });
    expect(describeTimelineEvent({ action: "voice.end", details: { durationSec: 45 } }).note).toBe("45 sn");
    expect(describeTimelineEvent({ action: "voice.reject", details: { reason: "timeout" } })).toEqual({
      label: "Sesli görüşme kurulmadı",
      note: "Müşteri yanıt vermedi",
      warn: false,
    });
    expect(describeTimelineEvent({ action: "voice.join", details: {} }).label).toBe("Teknisyen sesli görüşmeye katıldı");
  });
});
