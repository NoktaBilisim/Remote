// P28u-K2 sözleşme testleri (mimari-p28u §4–§6, §r2; AC-430, 435, 437, 446 + K3/K4'ün dayandığı şemalar).
import { describe, expect, it } from "vitest";
import fx from "../fixtures/ws-device.json" with { type: "json" };
import { listAuditQuerySchema } from "../src/api/audit.ts";
import { listSessionsQuerySchema } from "../src/api/sessions.ts";
import {
  CONNECT_BLOCKED_REASON_LABELS,
  CONNECT_BLOCKED_REASONS,
  CONSENT_MODE_LABELS,
  DEVICE_USER_STATE_LABELS,
  INTERVENE_LOCK_TIMEOUT_MS,
  INTERVENE_LOGOFF_TIMEOUT_MS,
  interveneLockInputSchema,
  interveneLogoffInputSchema,
  putUnattendedPolicyInputSchema,
  SILENT_REASON_MAX,
  SILENT_REASON_MIN,
  silentReasonSchema,
  UNATTENDED_AUDIT_LABELS,
  UNATTENDED_ERROR_MESSAGES,
  unattendedConnectInputSchema,
} from "../src/api/unattended.ts";
import { CONSENT_MODE_ACTIONS, UNATTENDED_AUDIT, UNATTENDED_POLICY_AUDIT } from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { END_REASON_LABELS } from "../src/labels.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS, PERMISSION_MODULES } from "../src/permissions.ts";
import { REJOIN_CONSOLE_WAIT_SEC, REJOIN_TICKET_TTL_SEC, REJOIN_WINDOW_SEC } from "../src/rejoin-const.ts";
import { CONSENT_DIALOG_SEC, CONSENT_MODES, CONSENT_RESULT_MS_MAX, DEVICE_CONSENT_WINDOW_MS } from "../src/unattended-consent.ts";
import {
  DEVICE_CONNECT_FAIL_REASONS,
  DEVICE_FEATURE_BY_SUBPROTOCOL,
  DEVICE_USER_DEBOUNCE_MS,
  deviceConsentInboundSchema,
  deviceConsentOutboundSchema,
  deviceControlIndicatorText,
  deviceInboundSchema,
  deviceOutboundSchema,
  deviceSilentIndicatorText,
  WS_DEVICE_CAP_CONSENT,
} from "../src/ws-device.ts";
import { SESSION_ENDED_REASONS, serverOutboundSchema } from "../src/ws.ts";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;
/** `consent1` sokette device.features sonrası: taban birlik ∪ consent birliği (sunucu/Go aynı sırayla dener). */
const consent1In = (v: unknown) => ok(deviceInboundSchema, v) || ok(deviceConsentInboundSchema, v);
const consent1Out = (v: unknown) => ok(deviceOutboundSchema, v) || ok(deviceConsentOutboundSchema, v);
const reasonIssues = (v: unknown) => {
  const r = unattendedConnectInputSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("P28u yetki", () => {
  it("AC-446: unattended.silent tek tanımdan gelir; Admin açık, User kapalı; uyarı açıklamalı; müdahale için ayrı anahtar yok", () => {
    expect(PERMISSION_MODULES.find((m) => m.key === "unattended")?.actions).toEqual(["connect", "manage", "silent"]);
    expect(PERMISSION_KEYS).toContain("unattended.silent");
    expect(effectivePermissions("ADMIN", [])).toContain("unattended.silent");
    expect(effectivePermissions("USER", [])).not.toContain("unattended.silent");
    expect(effectivePermissions("USER", [{ permKey: "unattended.silent", granted: true }])).toEqual(["unattended.silent"]);
    expect(PERMISSION_DESCRIPTIONS["unattended.silent"]).toMatch(/hassas.*politika.*2FA/s);
    expect(PERMISSION_KEYS.filter((k) => /^unattended\.(intervene|lock|logoff)/.test(k))).toEqual([]);
  });
});

describe("P28u hata kodları ve metinler", () => {
  it("AC-435/437: yeni kodlar, HTTP durumları ve Türkçe metinleri", () => {
    expect(ERROR_STATUS.DEVICE_OUTDATED).toBe(409);
    expect(ERROR_STATUS.SILENT_DISABLED).toBe(409);
    expect(ERROR_STATUS.INTERVENE_PENDING).toBe(409);
    expect(ERROR_STATUS.INTERVENE_FAILED).toBe(502);
    expect(UNATTENDED_ERROR_MESSAGES.DEVICE_OUTDATED).toBe("Cihazdaki servis güncel değil — güncelleyin");
    expect(UNATTENDED_ERROR_MESSAGES.SILENT_DISABLED).toBe("Firma politikası izin istemeden bağlanmaya izin vermiyor");
    expect(UNATTENDED_ERROR_MESSAGES.INTERVENE_PENDING).toBe("Önceki komut henüz tamamlanmadı");
    expect(UNATTENDED_ERROR_MESSAGES.INTERVENE_FAILED).toBe("Cihaz komutu uygulayamadı");
  });

  it("AC-435: connectBlockedReason `outdated` offline'dan sonra, etiketli", () => {
    expect(CONNECT_BLOCKED_REASONS.indexOf("outdated")).toBe(CONNECT_BLOCKED_REASONS.indexOf("offline") + 1);
    for (const r of CONNECT_BLOCKED_REASONS) expect(CONNECT_BLOCKED_REASON_LABELS[r]).toBeTruthy();
  });

  it("AC-445: oturum bitiş nedenleri ve etiketleri (consent_* + DB-only protocol)", () => {
    for (const r of ["consent_denied", "consent_timeout", "consent_missing"] as const) {
      expect(SESSION_ENDED_REASONS).toContain(r);
      expect(END_REASON_LABELS[r]).toBeTruthy();
    }
    expect(END_REASON_LABELS.consent_denied).toBe("Kullanıcı bağlantıyı reddetti");
    expect(END_REASON_LABELS.consent_timeout).toBe("Kullanıcı yanıt vermedi");
    expect(END_REASON_LABELS.consent_missing).toBe("Cihaz onay sonucunu bildirmedi");
    expect(SESSION_ENDED_REASONS).not.toContain("protocol");
    expect(DEVICE_CONNECT_FAIL_REASONS).toEqual(expect.arrayContaining(["consent_denied", "consent_timeout", "protocol"]));
    for (const r of DEVICE_CONNECT_FAIL_REASONS) expect(END_REASON_LABELS[r]).toBeTruthy();
  });
});

describe("P28u silentReasonSchema (DB support_sessions_silent_reason_chk ile aynı sınır)", () => {
  const ok20 = "a".repeat(SILENT_REASON_MIN);
  it("AC-437: 20..500 kod noktası, kırpılmış hâliyle sayılır", () => {
    expect(ok(silentReasonSchema, ok20)).toBe(true);
    expect(ok(silentReasonSchema, "a".repeat(SILENT_REASON_MIN - 1))).toBe(false);
    expect(ok(silentReasonSchema, "a".repeat(SILENT_REASON_MAX))).toBe(true);
    expect(ok(silentReasonSchema, "a".repeat(SILENT_REASON_MAX + 1))).toBe(false);
    // 19 karakter + boşluk dolgusu: kırpılınca 19 → ret; kırpılmış değer döner.
    expect(ok(silentReasonSchema, `  ${"a".repeat(19)}   `)).toBe(false);
    expect(silentReasonSchema.parse(`  ${ok20}  `)).toBe(ok20);
  });

  it("AC-437: astral karakter tek kod noktası sayılır (UTF-16 uzunluğu değil)", () => {
    expect(ok(silentReasonSchema, "😀".repeat(SILENT_REASON_MIN))).toBe(true);
    expect(ok(silentReasonSchema, "😀".repeat(SILENT_REASON_MIN - 1))).toBe(false);
    expect(ok(silentReasonSchema, "😀".repeat(SILENT_REASON_MAX))).toBe(true);
    expect(ok(silentReasonSchema, "😀".repeat(SILENT_REASON_MAX + 1))).toBe(false);
  });

  it("AC-437: iç `\\n` serbest; `\\r`, sekme, kontrol, bidi (Cf), U+2028/2029 reddedilir", () => {
    expect(ok(silentReasonSchema, `Arıza kaydı 4711\nSunucu yanıt vermiyor`)).toBe(true);
    for (const bad of ["\r\n", "\r", "\t", "\u0000", "\u007f", "\u0085", "‮", "​", "﻿", " ", " ", "͏"]) {
      expect(ok(silentReasonSchema, `Arıza kaydı 4711${bad}Sunucu yanıt vermiyor`), JSON.stringify(bad)).toBe(false);
    }
  });

  it("AC-437: connect girdisi silent ⇔ reason; ihlaller `reason` alanında; bilinmeyen alan reddedilir", () => {
    expect(unattendedConnectInputSchema.parse({})).toEqual({});
    expect(unattendedConnectInputSchema.parse({ silent: true, reason: ` ${ok20} ` })).toEqual({ silent: true, reason: ok20 });
    expect(reasonIssues({ silent: true })).toEqual(["reason"]);
    expect(reasonIssues({ reason: ok20 })).toEqual(["reason"]);
    expect(reasonIssues({ silent: true, reason: "kısa" })).toEqual(["reason"]);
    expect(reasonIssues({ silent: false, reason: ok20 })).toContain("silent");
    expect(ok(unattendedConnectInputSchema, { silent: true, reason: ok20, mode: "silent" })).toBe(false);
  });
});

describe("P28u politika ve müdahale girdileri", () => {
  it("AC-436: PUT /unattended/policy şeması; ack yalnız true; geçiş kuralı serviste (true→true ack'sız geçerli)", () => {
    expect(ok(putUnattendedPolicyInputSchema, { silentEnabled: true, ack: true })).toBe(true);
    expect(ok(putUnattendedPolicyInputSchema, { silentEnabled: true })).toBe(true);
    expect(ok(putUnattendedPolicyInputSchema, { silentEnabled: false })).toBe(true);
    expect(ok(putUnattendedPolicyInputSchema, { silentEnabled: true, ack: false })).toBe(false);
    expect(ok(putUnattendedPolicyInputSchema, { silentEnabled: "true" })).toBe(false);
    expect(ok(putUnattendedPolicyInputSchema, { silentEnabled: true, ack: true, ackBy: "x" })).toBe(false);
  });

  it("AC-443: kilit `{}`, oturum kapatma `confirm: true` zorunlu", () => {
    expect(ok(interveneLockInputSchema, {})).toBe(true);
    expect(ok(interveneLockInputSchema, { cmd: "logoff" })).toBe(false);
    expect(ok(interveneLogoffInputSchema, { confirm: true })).toBe(true);
    expect(ok(interveneLogoffInputSchema, {})).toBe(false);
    expect(ok(interveneLogoffInputSchema, { confirm: false })).toBe(false);
  });

  it("AC-445: geçmiş ve audit `consentMode` filtresi yalnız üç kip", () => {
    for (const m of CONSENT_MODES) {
      expect(listSessionsQuerySchema.parse({ consentMode: m }).consentMode).toBe(m);
      expect(listAuditQuerySchema.parse({ consentMode: m }).consentMode).toBe(m);
      expect(CONSENT_MODE_LABELS[m]).toBeTruthy();
    }
    expect(ok(listSessionsQuerySchema, { consentMode: "ask" })).toBe(false);
    expect(ok(listAuditQuerySchema, { consentMode: "SILENT" })).toBe(false);
    expect(listAuditQuerySchema.parse({ consentMode: "" }).consentMode).toBeUndefined();
    expect(Object.keys(DEVICE_USER_STATE_LABELS)).toEqual(["active", "locked", "none"]);
  });

  it("AC-445: yeni audit eylemleri benzersiz, etiketli; consentMode eylemleri unattended.*; gerekçe anahtarı ayrımı", () => {
    const fresh = [
      UNATTENDED_AUDIT.CONSENT,
      UNATTENDED_AUDIT.CONTROL_TOGGLE,
      UNATTENDED_AUDIT.LOCK,
      UNATTENDED_AUDIT.LOGOFF,
      UNATTENDED_AUDIT.REJOIN,
      UNATTENDED_AUDIT.SILENT_NOTIFY,
      UNATTENDED_POLICY_AUDIT,
    ];
    expect(new Set(fresh).size).toBe(fresh.length);
    for (const a of fresh) {
      expect(a.length).toBeLessThanOrEqual(60);
      expect(UNATTENDED_AUDIT_LABELS[a]).toBeTruthy();
    }
    expect(UNATTENDED_POLICY_AUDIT).toBe("settings.unattended_silent");
    for (const a of CONSENT_MODE_ACTIONS) expect(a.startsWith("unattended.")).toBe(true);
  });
});

describe("P28u /ws/device protokolü (fikstür — Go K5/K6 aynı dosyayı okur)", () => {
  it("AC-435: belirteç rs.cap.consent1 → özellik consent1", () => {
    expect(WS_DEVICE_CAP_CONSENT).toBe("rs.cap.consent1");
    expect(DEVICE_FEATURE_BY_SUBPROTOCOL[WS_DEVICE_CAP_CONSENT]).toBe("consent1");
    expect(DEVICE_FEATURE_BY_SUBPROTOCOL["rs.cap.consent2"]).toBeUndefined();
  });

  it("AC-431/443: fikstür constants sözleşme sabitleriyle aynı (tek tanım)", () => {
    expect(fx.constants).toEqual({
      wsDeviceCapConsent: WS_DEVICE_CAP_CONSENT,
      consentDialogSec: CONSENT_DIALOG_SEC,
      consentResultMsMax: CONSENT_RESULT_MS_MAX,
      deviceConsentWindowMs: DEVICE_CONSENT_WINDOW_MS,
      rejoinWindowSec: REJOIN_WINDOW_SEC,
      rejoinTicketTtlSec: REJOIN_TICKET_TTL_SEC,
      rejoinConsoleWaitSec: REJOIN_CONSOLE_WAIT_SEC,
      deviceUserDebounceMs: DEVICE_USER_DEBOUNCE_MS,
      interveneLockTimeoutMs: INTERVENE_LOCK_TIMEOUT_MS,
      interveneLogoffTimeoutMs: INTERVENE_LOGOFF_TIMEOUT_MS,
    });
    // K-P28u-4: DB TTL CHECK cihaz dalı 55..155 sn; yeniden katılım bekleme bütçesi pencereyi aşamaz.
    expect(DEVICE_CONSENT_WINDOW_MS).toBeLessThanOrEqual(155_000);
    expect(DEVICE_CONSENT_WINDOW_MS).toBeGreaterThan(CONSENT_DIALOG_SEC * 1000);
    expect(REJOIN_CONSOLE_WAIT_SEC).toBeLessThan(REJOIN_WINDOW_SEC);
    expect(REJOIN_TICKET_TTL_SEC).toBeLessThanOrEqual(REJOIN_WINDOW_SEC);
  });

  it("AC-431/435: fikstür valid.consent1* örnekleri consent1 sokette geçer", () => {
    for (const m of fx.valid.consent1Inbound) expect(consent1In(m), JSON.stringify(m)).toBe(true);
    for (const m of fx.valid.consent1Outbound) expect(consent1Out(m), JSON.stringify(m)).toBe(true);
  });

  it("AC-432 (D-P28u-5): fikstür invalid.consent1* reddedilir — consent'siz/bilinmeyen consent'li connect dahil", () => {
    for (const m of fx.invalid.consent1Inbound) expect(consent1In(m), JSON.stringify(m)).toBe(false);
    for (const m of fx.invalid.consent1Outbound) expect(consent1Out(m), JSON.stringify(m)).toBe(false);
  });

  it("AC-435: yeni mesajlar taban birlikte YOK — belirteçsiz sokette şema dışı (1008)", () => {
    for (const m of fx.valid.consent1Inbound.filter((x) => ["device.user", "consent.result", "intervene.result"].includes(x.t))) {
      expect(ok(deviceInboundSchema, m), JSON.stringify(m)).toBe(false);
    }
    for (const m of fx.valid.consent1Outbound.filter((x) => ["device.features", "intervene", "rejoin"].includes(x.t))) {
      expect(ok(deviceOutboundSchema, m), JSON.stringify(m)).toBe(false);
    }
    expect(deviceConsentOutboundSchema.options.map((o) => o.shape.t.value)).toEqual(["device.features", "intervene", "rejoin"]);
    for (const o of deviceConsentOutboundSchema.options) expect(Object.keys(o.shape)).not.toContain("localEnabled");
  });

  it("AC-439: silent gösterge metinleri; ask'ta indicatorControl yok", () => {
    expect(deviceSilentIndicatorText("Ayşe K.", "Nokta Destek", false)).toBe("Uzaktan izleniyor: Ayşe K. — Nokta Destek");
    expect(deviceControlIndicatorText("Ayşe K.", "Nokta Destek", true)).toBe("TEST — imzasız · Uzaktan kontrol: Ayşe K. — Nokta Destek");
    const silent = fx.valid.consent1Outbound.find((m) => m.t === "connect" && m.consent === "silent");
    expect(silent?.indicatorText).toBe(deviceSilentIndicatorText("Mehmet Teknisyen", "Nokta Destek", false));
  });

  it("AC-445: /ws/tech hello.unattended consentMode/intervene isteğe bağlı (ask odasında kip sonradan belli olur)", () => {
    const hello = {
      t: "hello",
      role: "tech",
      sessionId: "01JD0000000000000000000002",
      peerPresent: false,
      iceServers: [],
      maxEndsAt: null,
      unattended: { deviceId: "01JD0000000000000000000001", deviceName: "MUHASEBE-PC" },
    };
    expect(ok(serverOutboundSchema, hello)).toBe(true);
    expect(ok(serverOutboundSchema, { ...hello, unattended: { ...hello.unattended, consentMode: "silent", intervene: true } })).toBe(true);
    expect(ok(serverOutboundSchema, { ...hello, unattended: { ...hello.unattended, consentMode: "ask" } })).toBe(false);
  });
});
