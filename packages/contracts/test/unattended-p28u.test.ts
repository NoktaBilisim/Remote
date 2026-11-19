// P28u-K2 sözleşme testleri (mimari-p28u §4–§6, §r2; AC-430, 435, 437, 446 + K3/K4'ün dayandığı şemalar).
// r3 (§r3, K-P28u-r3-1..12): onaysız tek yol — silent/asked yazımı, politika, gerekçe kaldırıldı; eski kayıt okuma (AC-451) kalır.
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
  UNATTENDED_AUDIT_LABELS,
  UNATTENDED_ERROR_MESSAGES,
  unattendedConnectInputSchema,
} from "../src/api/unattended.ts";
import { CONSENT_MODE_ACTIONS, UNATTENDED_AUDIT, UNATTENDED_POLICY_AUDIT } from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { END_REASON_LABELS } from "../src/labels.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS, PERMISSION_MODULES } from "../src/permissions.ts";
import { REJOIN_CONSOLE_WAIT_SEC, REJOIN_TICKET_TTL_SEC, REJOIN_WINDOW_SEC } from "../src/rejoin-const.ts";
import { CONSENT_MODES, CONSENT_REQUESTS } from "../src/unattended-consent.ts";
import {
  DEVICE_ANNOUNCED_FEATURES,
  DEVICE_CAP_DIRECT,
  DEVICE_CONNECT_FAIL_REASONS,
  DEVICE_CONNECT_RESULT_REASONS,
  DEVICE_FEATURE_BY_SUBPROTOCOL,
  DEVICE_FEATURES,
  DEVICE_USER_DEBOUNCE_MS,
  deviceConsentInboundSchema,
  deviceConsentOutboundSchema,
  deviceIndicatorText,
  deviceInboundSchema,
  deviceOutboundSchema,
  WS_DEVICE_CAP_CONSENT,
  WS_DEVICE_CAP_UPDATE,
} from "../src/ws-device.ts";
import { SESSION_ENDED_REASONS, serverOutboundSchema } from "../src/ws.ts";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;
/** `consent1` sokette device.features sonrası: taban birlik ∪ consent birliği (sunucu/Go aynı sırayla dener). */
const consent1In = (v: unknown) => ok(deviceInboundSchema, v) || ok(deviceConsentInboundSchema, v);
const consent1Out = (v: unknown) => ok(deviceOutboundSchema, v) || ok(deviceConsentOutboundSchema, v);

describe("P28u yetki (r3)", () => {
  it("AC-446 (r3 K-P28u-r3-8): unattended.silent kaldırıldı — tek tanımda, açıklamada ve varsayılanlarda yok; müdahale için ayrı anahtar yok", () => {
    expect(PERMISSION_MODULES.find((m) => m.key === "unattended")?.actions).toEqual(["connect", "manage"]);
    expect(PERMISSION_KEYS).not.toContain("unattended.silent");
    expect(Object.keys(PERMISSION_DESCRIPTIONS)).not.toContain("unattended.silent");
    expect(effectivePermissions("ADMIN", [])).not.toContain("unattended.silent");
    expect(PERMISSION_KEYS.filter((k) => /^unattended\.(intervene|lock|logoff)/.test(k))).toEqual([]);
  });

  it("AC-451: kullanıcıda saklı kalmış unattended.silent satırı etkin yetkiye girmez (hoşgörülü okuma, hata yok)", () => {
    const stored = [
      { permKey: "unattended.silent", granted: true },
      { permKey: "unattended.connect", granted: true },
    ];
    expect(effectivePermissions("USER", stored)).toEqual(["unattended.connect"]);
    expect(effectivePermissions("ADMIN", [{ permKey: "unattended.silent", granted: true }])).not.toContain("unattended.silent");
  });
});

describe("P28u hata kodları ve metinler", () => {
  it("AC-435 (r3): kodlar, HTTP durumları ve Türkçe metinleri; SILENT_DISABLED kaldırıldı", () => {
    expect(ERROR_STATUS.DEVICE_OUTDATED).toBe(409);
    expect(Object.keys(ERROR_STATUS)).not.toContain("SILENT_DISABLED");
    expect(Object.keys(UNATTENDED_ERROR_MESSAGES)).not.toContain("SILENT_DISABLED");
    expect(ERROR_STATUS.INTERVENE_PENDING).toBe(409);
    expect(ERROR_STATUS.INTERVENE_FAILED).toBe(502);
    expect(UNATTENDED_ERROR_MESSAGES.DEVICE_OUTDATED).toBe("Cihazdaki servis güncel değil — güncelleyin");
    expect(UNATTENDED_ERROR_MESSAGES.INTERVENE_PENDING).toBe("Önceki komut henüz tamamlanmadı");
    expect(UNATTENDED_ERROR_MESSAGES.INTERVENE_FAILED).toBe("Cihaz komutu uygulayamadı");
  });

  it("AC-435: connectBlockedReason `outdated` offline'dan sonra, etiketli", () => {
    expect(CONNECT_BLOCKED_REASONS.indexOf("outdated")).toBe(CONNECT_BLOCKED_REASONS.indexOf("offline") + 1);
    for (const r of CONNECT_BLOCKED_REASONS) expect(CONNECT_BLOCKED_REASON_LABELS[r]).toBeTruthy();
  });

  it("AC-445/451: oturum bitiş nedenleri ve etiketleri (eski consent_* okunur + DB-only protocol)", () => {
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

  it("AC-435 (r3): connect.result tel nedenlerinde consent_* yok; DB okuma dizisinin alt kümesi", () => {
    expect(DEVICE_CONNECT_RESULT_REASONS.filter((r) => r.startsWith("consent_"))).toEqual([]);
    for (const r of DEVICE_CONNECT_RESULT_REASONS) expect(DEVICE_CONNECT_FAIL_REASONS).toContain(r);
    expect(DEVICE_CONNECT_RESULT_REASONS).toContain("protocol");
    const res = { t: "connect.result", sessionId: "01JD0000000000000000000002", ok: false };
    expect(ok(deviceInboundSchema, { ...res, reason: "consent_denied" })).toBe(false);
    expect(ok(deviceInboundSchema, { ...res, reason: "busy" })).toBe(true);
  });
});

describe("P28u r3 connect girdisi", () => {
  it("AC-430 (r3): connect gövdesi boş nesne; eski silent/reason ve bilinmeyen alan reddedilir", () => {
    expect(unattendedConnectInputSchema.parse({})).toEqual({});
    expect(ok(unattendedConnectInputSchema, { silent: true, reason: "a".repeat(25) })).toBe(false);
    expect(ok(unattendedConnectInputSchema, { silent: true })).toBe(false);
    expect(ok(unattendedConnectInputSchema, { reason: "a".repeat(25) })).toBe(false);
    expect(ok(unattendedConnectInputSchema, { mode: "no_user" })).toBe(false);
    expect(ok(unattendedConnectInputSchema, null)).toBe(false);
  });
});

describe("P28u müdahale girdileri ve eski kayıt okuma", () => {
  it("AC-443: kilit `{}`, oturum kapatma `confirm: true` zorunlu", () => {
    expect(ok(interveneLockInputSchema, {})).toBe(true);
    expect(ok(interveneLockInputSchema, { cmd: "logoff" })).toBe(false);
    expect(ok(interveneLogoffInputSchema, { confirm: true })).toBe(true);
    expect(ok(interveneLogoffInputSchema, {})).toBe(false);
    expect(ok(interveneLogoffInputSchema, { confirm: false })).toBe(false);
  });

  it("AC-445/451: geçmiş ve audit `consentMode` filtresi üç kip (eski değerler dahil); r3 etiketleri", () => {
    for (const m of CONSENT_MODES) {
      expect(listSessionsQuerySchema.parse({ consentMode: m }).consentMode).toBe(m);
      expect(listAuditQuerySchema.parse({ consentMode: m }).consentMode).toBe(m);
      expect(CONSENT_MODE_LABELS[m]).toBeTruthy();
    }
    expect(ok(listSessionsQuerySchema, { consentMode: "ask" })).toBe(false);
    expect(ok(listAuditQuerySchema, { consentMode: "SILENT" })).toBe(false);
    expect(listAuditQuerySchema.parse({ consentMode: "" }).consentMode).toBeUndefined();
    expect(Object.keys(DEVICE_USER_STATE_LABELS)).toEqual(["active", "locked", "none"]);
    expect(CONSENT_MODE_LABELS).toEqual({ asked: "Kullanıcı onayıyla (eski)", no_user: "Onaysız", silent: "İzinsiz (eski)" });
  });

  it("AC-445/451: P28u audit eylemleri (r3'te yazılmayanlar dahil) benzersiz, Türkçe etiketli; consentMode eylemleri unattended.*", () => {
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

  it("AC-435 (r3 K-P28u-r3-2): rs.cap.direct1 → hub özelliği direct1; device.features.caps'e girmez (eski Go strict)", () => {
    expect(DEVICE_CAP_DIRECT).toBe("rs.cap.direct1");
    expect(DEVICE_FEATURE_BY_SUBPROTOCOL[DEVICE_CAP_DIRECT]).toBe("direct1");
    expect(DEVICE_FEATURES).toContain("direct1");
    expect(DEVICE_ANNOUNCED_FEATURES).toEqual(["consent1", "record1"]);
    expect(ok(deviceConsentOutboundSchema, { t: "device.features", caps: ["consent1", "record1"] })).toBe(true);
    expect(ok(deviceConsentOutboundSchema, { t: "device.features", caps: ["consent1", "direct1"] })).toBe(false);
  });

  it("AC-435/443: fikstür constants sözleşme sabitleriyle aynı (tek tanım)", () => {
    expect(fx.constants).toEqual({
      wsDeviceCapConsent: WS_DEVICE_CAP_CONSENT,
      wsDeviceCapDirect: DEVICE_CAP_DIRECT,
      // P29 (mimari-p29 §4.3).
      wsDeviceCapUpdate: WS_DEVICE_CAP_UPDATE,
      rejoinWindowSec: REJOIN_WINDOW_SEC,
      rejoinTicketTtlSec: REJOIN_TICKET_TTL_SEC,
      rejoinConsoleWaitSec: REJOIN_CONSOLE_WAIT_SEC,
      deviceUserDebounceMs: DEVICE_USER_DEBOUNCE_MS,
      interveneLockTimeoutMs: INTERVENE_LOCK_TIMEOUT_MS,
      interveneLogoffTimeoutMs: INTERVENE_LOGOFF_TIMEOUT_MS,
    });
    // Yeniden katılım bekleme bütçesi pencereyi aşamaz.
    expect(REJOIN_CONSOLE_WAIT_SEC).toBeLessThan(REJOIN_WINDOW_SEC);
    expect(REJOIN_TICKET_TTL_SEC).toBeLessThanOrEqual(REJOIN_WINDOW_SEC);
  });

  it("AC-433/435: fikstür valid.consent1* örnekleri consent1 sokette geçer", () => {
    for (const m of fx.valid.consent1Inbound) expect(consent1In(m), JSON.stringify(m)).toBe(true);
    for (const m of fx.valid.consent1Outbound) expect(consent1Out(m), JSON.stringify(m)).toBe(true);
  });

  it("AC-435 (D-P28u-5, r3): fikstür invalid.consent1* reddedilir — consent'siz/silent connect, asked sonuç, consent_* sonuç dahil", () => {
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

  it("AC-433 (r3 K-P28u-r3-3/4/7): connect yalnız consent=ask, indicatorControl yok; consent.result ve rejoin yalnız no_user; tek gösterge metni", () => {
    expect(CONSENT_REQUESTS).toEqual(["ask"]);
    const connect = fx.valid.consent1Outbound.find((m) => m.t === "connect");
    expect(connect).toBeDefined();
    expect(ok(deviceOutboundSchema, connect)).toBe(true);
    expect(ok(deviceOutboundSchema, { ...connect, consent: "silent" })).toBe(false);
    expect(ok(deviceOutboundSchema, { ...connect, indicatorControl: "Uzaktan kontrol: X — Y" })).toBe(false);
    expect(connect?.indicatorText).toBe(deviceIndicatorText("Mehmet Teknisyen", "Nokta Destek", false));
    expect(deviceIndicatorText("Ayşe K.", "Nokta Destek", true)).toBe("TEST — imzasız · Uzaktan bağlantı: Ayşe K. — Nokta Destek");
    const sid = "01JD0000000000000000000002";
    expect(ok(deviceConsentInboundSchema, { t: "consent.result", sessionId: sid, mode: "no_user" })).toBe(true);
    expect(ok(deviceConsentInboundSchema, { t: "consent.result", sessionId: sid, mode: "asked", decision: "granted", ms: 1 })).toBe(false);
    const rejoin = fx.valid.consent1Outbound.find((m) => m.t === "rejoin");
    expect(rejoin?.mode).toBe("no_user");
    for (const mode of ["asked", "silent"]) expect(ok(deviceConsentOutboundSchema, { ...rejoin, mode }), mode).toBe(false);
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
