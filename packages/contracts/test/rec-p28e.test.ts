// P28e-K2 sözleşme testleri (mimari-p28e r2 §4–§6, §11; AC-381, 383, 384, 385, 386, 388, 404, 447). Fikstür `fixtures/rec.json`
// Go (internal/signal, internal/servis) ile ortaktır.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fx from "../fixtures/rec.json" with { type: "json" };
import {
  deleteRecordingInputSchema,
  putRecordingSettingsInputSchema,
  recBearerSchema,
  recordingViewInputSchema,
  recPartHeadersSchema,
  recPartParamsSchema,
  recSeriesStartValid,
  REC_BASIS_LABELS,
  REC_DELETE_REASON_LABELS,
  REC_PART_CONTENT_HEADERS,
  REC_STATE_REASON_LABELS,
} from "../src/api/recording.ts";
import { listSessionsQuerySchema, CONSENT_LEVELS } from "../src/api/sessions.ts";
import {
  RECORDING_AUDIT,
  RECORDING_AUDIT_LABELS,
  RECORDING_SETTINGS_AUDIT,
  SILENT_NOTIFY_EVENT_LABELS,
  SILENT_NOTIFY_EVENTS,
} from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { CONSENT_LEVEL_LABELS } from "../src/labels.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS } from "../src/permissions.ts";
import {
  DEVICE_FEATURE_BY_SUBPROTOCOL,
  deviceConsentOutboundSchema,
  deviceOutboundSchema,
  deviceRecordOutboundSchema,
} from "../src/ws-device.ts";
import * as rec from "../src/ws-rec.ts";
import { guestInboundSchemaFor, serverOutboundSchema, techInboundSchema } from "../src/ws.ts";

type Schema = { safeParse: (v: unknown) => { success: boolean } };
const ok = (s: Schema, v: unknown) => s.safeParse(v).success;
const guestRec = guestInboundSchemaFor(new Set(), false, true);
const guestPlain = guestInboundSchemaFor(new Set(), false, false);
const helloOf = (v: unknown) => (v as { t: string; rec?: unknown }).rec;
/** Misafire giden: `rec.state` misafir biçimi; `hello` birlikte geçer + `rec` misafir biçiminde. */
const guestOut = (v: unknown) =>
  (v as { t: string }).t === "hello"
    ? ok(serverOutboundSchema, v) && ok(rec.recHelloGuestSchema, helloOf(v))
    : ok(rec.recStateGuestSchema, v) && ok(serverOutboundSchema, v);
const techOut = (v: unknown) =>
  (v as { t: string }).t === "hello"
    ? ok(serverOutboundSchema, v) && ok(rec.recHelloTechSchema, helloOf(v))
    : ok(rec.recStateTechSchema, v) && ok(serverOutboundSchema, v);
const deviceOut = (v: unknown) => ok(deviceOutboundSchema, v) || ok(deviceConsentOutboundSchema, v) || ok(deviceRecordOutboundSchema, v);

describe("P28e yetki", () => {
  it("AC-404: sessions.view_recording tek tanımdan; Admin açık, User kapalı; hassas açıklama", () => {
    expect(PERMISSION_KEYS).toContain("sessions.view_recording");
    expect(effectivePermissions("ADMIN", [])).toContain("sessions.view_recording");
    expect(effectivePermissions("USER", [])).not.toContain("sessions.view_recording");
    expect(PERMISSION_DESCRIPTIONS["sessions.view_recording"]).toBe("Oturum kayıtlarını izler (hassas — yalnız gerekene verin).");
  });
});

describe("P28e rıza metni ve sabitler", () => {
  it("AC-381: REC_CONSENT_LINE_SHA256 = SHA-256(UTF-8 cümle); fikstür aynı", () => {
    expect(createHash("sha256").update(rec.REC_CONSENT_LINE, "utf8").digest("hex")).toBe(rec.REC_CONSENT_LINE_SHA256);
    expect(fx.consent).toEqual({
      line: rec.REC_CONSENT_LINE,
      lineSha256: rec.REC_CONSENT_LINE_SHA256,
      unattendedLine: rec.REC_UNATTENDED_LINE,
    });
    expect(fx.subprotocols).toEqual({ rec: rec.WS_CAP_REC, record: rec.WS_DEVICE_CAP_RECORD });
  });

  it("AC-383/384: fikstür constants sözleşme sabitleriyle bayt bayt aynı (tek tanım)", () => {
    const mod = rec as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(fx.constants)) {
      const actual = mod[k];
      expect(actual instanceof RegExp ? actual.source : actual, k).toEqual(v);
    }
    expect(rec.REC_SERIES_PARTS).toBe(60);
    expect(rec.REC_SERIES_MAX_PART).toBe(59);
    expect(rec.REC_PART_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("AC-388: sözlükler fikstürle aynı; tel ↔ DB CHECK dönüşümü (K1 şeması)", () => {
    expect(fx.sets).toEqual({
      bases: rec.REC_BASES,
      states: rec.REC_STATES,
      stopReasons: rec.REC_STOP_REASONS,
      stateReasons: rec.REC_STATE_REASONS,
      deleteReasons: rec.REC_DELETE_REASONS,
      errorCodes: rec.REC_ERROR_CODES,
      deviceFeatures: ["consent1", "record1"],
    });
    expect(rec.REC_BASES.map(rec.recToDb)).toEqual(["CONSENT", "TENANT_POLICY"]);
    expect(rec.REC_STATES.map(rec.recToDb)).toEqual(["ACTIVE", "STOPPED", "DELETED"]);
    expect(rec.REC_STOP_REASONS.map(rec.recToDb)).toEqual(["REVOKED", "QUOTA", "SESSION_END", "ERROR", "POLICY_OFF"]);
    expect(rec.REC_DELETE_REASONS.map(rec.recToDb)).toEqual(["EXPIRED", "MANUAL", "MISSING"]);
    expect(rec.recFromDb("SESSION_END")).toBe("session_end");
    expect(rec.REC_STOP_ERROR_CODES).toEqual(expect.arrayContaining([...rec.REC_ERROR_CODES, "no_upload"]));
  });
});

describe("P28e WS protokolü (fikstür — Go aynı dosyayı okur)", () => {
  it("AC-381/382: rec.consent/rec.revoke yalnız rec1 misafir şemasında; belirteçsiz sokette şema dışı (1008)", () => {
    for (const m of fx.valid.guestInbound) {
      expect(ok(guestRec, m), JSON.stringify(m)).toBe(true);
      expect(ok(guestPlain, m), JSON.stringify(m)).toBe(false);
    }
    for (const m of fx.invalid.guestInbound) expect(ok(guestRec, m), JSON.stringify(m)).toBe(false);
    // Tam şema (önbellek anahtarı 15) rec içerir; 7 (pano+yazdırma+fsrv) içermez.
    expect(ok(guestInboundSchemaFor(new Set(["clipboard", "print"]), true, false), fx.valid.guestInbound[2])).toBe(false);
    expect(ok(guestInboundSchemaFor(new Set(["clipboard", "print"]), true, true), fx.valid.guestInbound[2])).toBe(true);
  });

  it("AC-382: misafire giden rec.state/hello.rec yalnız {on, reason?}; rid/basis/upload reddedilir", () => {
    for (const m of fx.valid.guestOutbound) expect(guestOut(m), JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.guestOutbound) expect(guestOut(m), JSON.stringify(m)).toBe(false);
  });

  it("AC-382/383: teknisyen rec.error ve rec.state (upload yalnız on + rid; açıkken rid + basis)", () => {
    for (const m of fx.valid.techInbound) expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.techInbound) expect(ok(techInboundSchema, m), JSON.stringify(m)).toBe(false);
    for (const m of fx.valid.techOutbound) expect(techOut(m), JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.techOutbound) expect(techOut(m), JSON.stringify(m)).toBe(false);
  });

  it("AC-448/449: record1 cihaz — connect.recording yalnız true, rec.state {on}, device.features record1", () => {
    expect(DEVICE_FEATURE_BY_SUBPROTOCOL[rec.WS_DEVICE_CAP_RECORD]).toBe("record1");
    for (const m of fx.valid.deviceOutbound) expect(deviceOut(m), JSON.stringify(m)).toBe(true);
    for (const m of fx.invalid.deviceOutbound) expect(deviceOut(m), JSON.stringify(m)).toBe(false);
    // rec.state taban/consent birliklerinde YOK (eski servise gitmez).
    expect(ok(deviceOutboundSchema, { t: "rec.state", on: true })).toBe(false);
    expect(ok(deviceConsentOutboundSchema, { t: "rec.state", on: true })).toBe(false);
  });
});

describe("P28e REST şemaları", () => {
  it("AC-383: parça yol parametreleri — s ≤ 65535, p ≤ 59, baştaki sıfır/negatif/küçük harf ULID 400", () => {
    for (const v of fx.rest.validPartParams) expect(ok(recPartParamsSchema, v), JSON.stringify(v)).toBe(true);
    for (const v of fx.rest.invalidPartParams) expect(ok(recPartParamsSchema, v), JSON.stringify(v)).toBe(false);
    expect(recPartParamsSchema.parse(fx.rest.validPartParams[1])).toEqual({ rid: "01JD0000000000000000000001", s: 65535, p: 59 });
  });

  it("AC-383: başlıklar — video/webm, süre 1..15000, seri başı yalnız p=0'da", () => {
    const h = { "content-type": "video/webm", "x-rec-duration-ms": "5000", "x-rec-series-start-ms": "1763290000000", host: "x" };
    expect(recPartHeadersSchema.parse(h)).toEqual({
      "content-type": "video/webm",
      "x-rec-duration-ms": 5000,
      "x-rec-series-start-ms": 1763290000000,
    });
    expect(ok(recPartHeadersSchema, { ...h, "x-rec-duration-ms": "0" })).toBe(false);
    expect(ok(recPartHeadersSchema, { ...h, "x-rec-duration-ms": "15001" })).toBe(false);
    expect(ok(recPartHeadersSchema, { ...h, "content-type": "application/octet-stream" })).toBe(false);
    expect(recSeriesStartValid(0, 1)).toBe(true);
    expect(recSeriesStartValid(0, undefined)).toBe(false);
    expect(recSeriesStartValid(1, 1)).toBe(false);
    expect(recSeriesStartValid(1, undefined)).toBe(true);
  });

  it("AC-385: Bearer biçimi; içerik başlıkları Range/Content-Disposition içermez", () => {
    expect(recBearerSchema.parse(`Bearer ${"a".repeat(43)}`)).toBe("a".repeat(43));
    expect(ok(recBearerSchema, `Bearer ${"a".repeat(42)}`)).toBe(false);
    expect(ok(recBearerSchema, "a".repeat(43))).toBe(false);
    expect(Object.keys(REC_PART_CONTENT_HEADERS)).not.toContain("Content-Disposition");
    expect(REC_PART_CONTENT_HEADERS["Cache-Control"]).toBe("no-store");
    expect(ok(recordingViewInputSchema, {})).toBe(true);
    expect(ok(recordingViewInputSchema, { token: "x" })).toBe(false);
  });

  it("AC-386: silme confirm:true zorunlu", () => {
    expect(ok(deleteRecordingInputSchema, { confirm: true })).toBe(true);
    expect(ok(deleteRecordingInputSchema, {})).toBe(false);
    expect(ok(deleteRecordingInputSchema, { confirm: false })).toBe(false);
  });

  it("AC-380/447: ayar girdisi — saklama 1..90, gözetimsiz yalnız ana anahtar açıkken, onaylar yalnız true", () => {
    const base = { enabled: true, retentionDays: 30, unattendedEnabled: false };
    expect(ok(putRecordingSettingsInputSchema, base)).toBe(true);
    expect(ok(putRecordingSettingsInputSchema, { ...base, consentUpdated: true, unattendedEnabled: true, employeeNoticeAck: true })).toBe(
      true,
    );
    expect(ok(putRecordingSettingsInputSchema, { ...base, retentionDays: 0 })).toBe(false);
    expect(ok(putRecordingSettingsInputSchema, { ...base, retentionDays: 91 })).toBe(false);
    expect(ok(putRecordingSettingsInputSchema, { ...base, consentUpdated: false })).toBe(false);
    expect(ok(putRecordingSettingsInputSchema, { ...base, extra: 1 })).toBe(false);
    const r = putRecordingSettingsInputSchema.safeParse({ enabled: false, retentionDays: 30, unattendedEnabled: true });
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join("."))).toEqual(["unattendedEnabled"]);
  });

  it("AC-450: geçmiş süzgeci recorded yalnız 'true'", () => {
    expect(listSessionsQuerySchema.parse({ recorded: "true" }).recorded).toBe(true);
    expect(ok(listSessionsQuerySchema, { recorded: "false" })).toBe(false);
    expect(listSessionsQuerySchema.parse({}).recorded).toBeUndefined();
  });

  it("AC-384: yeni hata kodu yok — mevcut kodlar ve durumları", () => {
    expect(ERROR_STATUS.STORAGE_QUOTA).toBe(409);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS.CONFLICT).toBe(409);
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.VALIDATION).toBe(400);
    expect(Object.keys(ERROR_STATUS).filter((k) => /^REC/.test(k))).toEqual([]);
  });
});

describe("P28e audit ve etiketler", () => {
  it("AC-388: kayıt eylemleri benzersiz, recording.* önekli, etiketli; ayar eylemi settings.*", () => {
    const actions = Object.values(RECORDING_AUDIT);
    expect(new Set(actions).size).toBe(actions.length);
    for (const a of actions) expect(a.startsWith("recording.")).toBe(true);
    expect(RECORDING_SETTINGS_AUDIT).toBe("settings.recording");
    for (const a of [...actions, RECORDING_SETTINGS_AUDIT]) expect(RECORDING_AUDIT_LABELS[a]).toBeTruthy();
  });

  it("S-P28e-4: dört göz olayı recording_policy eklendi ve etiketli", () => {
    expect(SILENT_NOTIFY_EVENTS).toEqual(["connect", "policy", "recording_policy"]);
    for (const e of SILENT_NOTIFY_EVENTS) expect(SILENT_NOTIFY_EVENT_LABELS[e]).toBeTruthy();
  });

  it("AC-381/386/450: rıza düzeyi RECORDING + dayanak/neden etiketleri eksiksiz", () => {
    expect(CONSENT_LEVELS).toContain("RECORDING");
    for (const l of CONSENT_LEVELS) expect(CONSENT_LEVEL_LABELS[l]).toBeTruthy();
    for (const b of rec.REC_BASES) expect(REC_BASIS_LABELS[b]).toBeTruthy();
    for (const r of rec.REC_STATE_REASONS) expect(REC_STATE_REASON_LABELS[r]).toBeTruthy();
    for (const r of rec.REC_DELETE_REASONS) expect(REC_DELETE_REASON_LABELS[r]).toBeTruthy();
  });
});
