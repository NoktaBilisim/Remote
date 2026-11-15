// P27-K1 sözleşme testleri (mimari-p27 §4; AC-273, 275, 285, 293, 295, 296, 297, 336, 337, 339, 342).
import { describe, expect, it } from "vitest";
import deviceFixture from "../fixtures/ws-device.json" with { type: "json" };
import { NOTIFY_KINDS, OUTBOX_KINDS, UNATTENDED_NOTIFY_KINDS } from "../src/api/notify.ts";
import { CONSENT_RECORD_SOURCES, listSessionsQuerySchema, SESSION_MODES } from "../src/api/sessions.ts";
import {
  CONNECT_BLOCKED_REASON_LABELS,
  CONNECT_BLOCKED_REASONS,
  createRegistrationCodeInputSchema,
  formatRegistrationCode,
  listDevicesQuerySchema,
  normalizeRegistrationCode,
  NOTIFY_CONTACTS_MAX,
  putDeviceGrantsInputSchema,
  putNotifyContactsInputSchema,
  REGISTRATION_CODE_ALPHABET,
  REGISTRATION_CODE_LENGTH,
  registerDeviceInputSchema,
  UNATTENDED_AUDIT_LABELS,
  UNATTENDED_ERROR_MESSAGES,
  UNATTENDED_REVOKE_REASON_LABELS,
  UNATTENDED_REVOKE_REASONS,
} from "../src/api/unattended.ts";
import { UNATTENDED_AUDIT } from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import { CONSENT_SOURCE_LABELS, END_REASON_LABELS, SESSION_MODE_LABELS } from "../src/labels.ts";
import { effectivePermissions, PERMISSION_DESCRIPTIONS, PERMISSION_KEYS, PERMISSION_MODULES } from "../src/permissions.ts";
import {
  DEVICE_CONNECT_FAIL_REASONS,
  DEVICE_INDICATOR_TEST_PREFIX,
  DEVICE_INDICATOR_TEXT_MAX,
  deviceAuthMessage,
  deviceAuthSchema,
  deviceIndicatorText,
  deviceInboundSchema,
  deviceOutboundSchema,
} from "../src/ws-device.ts";
import { controlStateSchema, guestInboundSchema, SESSION_ENDED_REASONS, serverOutboundSchema } from "../src/ws.ts";

const ID = "01JD0000000000000000000001";
const ID2 = "01JD0000000000000000000002";
const PUBKEY = "Tzvurhrfhd0k9x-ZN1JarzZap5Ix7vMOKvclD1Y-lUE";
const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const register = (over: Record<string, unknown> = {}) => ({
  code: "abcd-1234 efgh-5678",
  publicKey: PUBKEY,
  name: "MUHASEBE-PC",
  osVersion: "Windows 11 Pro",
  version: "0.13.0",
  sha256: SHA,
  signed: true,
  ...over,
});

describe("P27 yetki anahtarları", () => {
  it("AC-285: unattended.connect ve unattended.manage tek tanımdan gelir; Admin açık, User kapalı başlar; açıklamalı", () => {
    expect(PERMISSION_MODULES.find((m) => m.key === "unattended")?.actions).toEqual(["connect", "manage"]);
    expect(PERMISSION_KEYS).toContain("unattended.connect");
    expect(PERMISSION_KEYS).toContain("unattended.manage");
    expect(effectivePermissions("ADMIN", [])).toEqual(expect.arrayContaining(["unattended.connect", "unattended.manage"]));
    expect(effectivePermissions("USER", [])).not.toContain("unattended.connect");
    expect(PERMISSION_DESCRIPTIONS["unattended.connect"]).toMatch(/cihaz bazında yetki/);
    expect(PERMISSION_DESCRIPTIONS["unattended.manage"]).toMatch(/kayıt kodu/);
  });
});

describe("P27 hata kodları", () => {
  it("AC-336/AC-296/AC-273: yeni kodlar ve HTTP durumları (§4.3)", () => {
    expect(ERROR_STATUS).toMatchObject({
      UNATTENDED_DISABLED: 409,
      DEVICE_OFFLINE: 409,
      DEVICE_BUSY: 409,
      DEVICE_LOCAL_DISABLED: 409,
      NOTIFY_CONTACT_REQUIRED: 409,
      NOTIFY_CHANNEL_UNAVAILABLE: 409,
      REGISTRATION_CODE_INVALID: 404,
    });
    for (const code of Object.keys(UNATTENDED_ERROR_MESSAGES)) expect(ERROR_STATUS).toHaveProperty(code);
    expect(UNATTENDED_ERROR_MESSAGES.NOTIFY_CHANNEL_UNAVAILABLE).toContain("Bildirim e-postası yapılandırılmamış");
    expect(UNATTENDED_ERROR_MESSAGES.UNATTENDED_DISABLED).toBe("Gözetimsiz erişim kod imzası olmadan kullanılamaz");
  });
});

describe("P27 kayıt kodu ve cihaz kaydı", () => {
  it("AC-273: kod normalizasyonu (tire/boşluk atılır, büyük harf) ve gösterim biçimi", () => {
    expect(normalizeRegistrationCode(" abcd-1234 efgh-5678 ")).toBe("ABCD1234EFGH5678");
    expect(formatRegistrationCode("ABCD1234EFGH5678")).toBe("ABCD-1234-EFGH-5678");
    expect(REGISTRATION_CODE_ALPHABET).toHaveLength(32);
    expect(REGISTRATION_CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(REGISTRATION_CODE_LENGTH * 5).toBe(80);
  });

  it("AC-273: register girdisi geçerli örnekte normalize kod döner", () => {
    const r = registerDeviceInputSchema.safeParse(register());
    expect(r.success).toBe(true);
    expect(r.data?.code).toBe("ABCD1234EFGH5678");
  });

  it("AC-273: geçersiz girdi reddedilir (kod biçimi, kanonik olmayan anahtar, kontrol karakteri, büyük harf özet, ek alan)", () => {
    expect(registerDeviceInputSchema.safeParse(register({ code: "ABCD-1234-EFGH-567" })).success).toBe(false);
    expect(registerDeviceInputSchema.safeParse(register({ code: "ABCD-1234-EFGH-567I" })).success).toBe(false);
    expect(registerDeviceInputSchema.safeParse(register({ publicKey: `${PUBKEY.slice(0, 42)}F` })).success).toBe(false);
    expect(registerDeviceInputSchema.safeParse(register({ name: "PC‮exe" })).success).toBe(false);
    expect(registerDeviceInputSchema.safeParse(register({ name: "x".repeat(65) })).success).toBe(false);
    expect(registerDeviceInputSchema.safeParse(register({ sha256: SHA.toUpperCase() })).success).toBe(false);
    expect(registerDeviceInputSchema.safeParse(register({ version: "1.0" })).success).toBe(false);
    expect(registerDeviceInputSchema.safeParse(register({ tenantId: ID })).success).toBe(false);
  });

  it("AC-273: kayıt kodu üretimi yalnız müşteri kimliği alır", () => {
    expect(createRegistrationCodeInputSchema.safeParse({ customerId: ID }).success).toBe(true);
    expect(createRegistrationCodeInputSchema.safeParse({ customerId: "x" }).success).toBe(false);
    expect(createRegistrationCodeInputSchema.safeParse({ customerId: ID, ttlHours: 48 }).success).toBe(false);
  });
});

describe("P27 cihaz listesi ve yetkiler", () => {
  it("AC-275: liste sorgusu varsayılanları (state=all, limit=50); boş değerler yok sayılır", () => {
    expect(listDevicesQuerySchema.parse({})).toEqual({ state: "all", limit: 50 });
    expect(listDevicesQuerySchema.parse({ q: " ", customerId: "", state: "online", limit: "100" })).toEqual({
      state: "online",
      limit: 100,
    });
  });

  it("AC-275: büyük sayfa, geçersiz durum/imleç ve bilinmeyen parametre 400", () => {
    expect(listDevicesQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ state: "revoked" }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ cursor: "a b" }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ q: "x".repeat(65) }).success).toBe(false);
    expect(listDevicesQuerySchema.safeParse({ tenantId: ID }).success).toBe(false);
  });

  it("AC-293: grant girdisi tam kümedir — boş dizi geçerli, ≤ 200, benzersiz", () => {
    expect(putDeviceGrantsInputSchema.safeParse({ userIds: [] }).success).toBe(true);
    expect(putDeviceGrantsInputSchema.safeParse({ userIds: [ID, ID2] }).success).toBe(true);
    expect(putDeviceGrantsInputSchema.safeParse({ userIds: [ID, ID] }).success).toBe(false);
    expect(putDeviceGrantsInputSchema.safeParse({ userIds: ["kullanici"] }).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => `01JD${String(i).padStart(22, "0")}`);
    expect(putDeviceGrantsInputSchema.safeParse({ userIds: many }).success).toBe(false);
  });

  it("AC-336: her bağlanamama nedeninin Türkçe ipucu var; smtp nedeni SMTP ayarını gösterir", () => {
    for (const r of CONNECT_BLOCKED_REASONS) expect(CONNECT_BLOCKED_REASON_LABELS[r]).toBeTruthy();
    expect(CONNECT_BLOCKED_REASON_LABELS.smtp).toContain("Ayarlar → SMTP");
    for (const r of UNATTENDED_REVOKE_REASONS) expect(UNATTENDED_REVOKE_REASON_LABELS[r]).toBeTruthy();
  });
});

describe("P27 bildirim adresleri", () => {
  it("AC-296: 0..5 adres; telefon E.164'e normalize, boş telefon null", () => {
    expect(putNotifyContactsInputSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(
      putNotifyContactsInputSchema.parse({ items: [{ email: " bt@ornek.com ", phone: "0532 123 45 67" }, { email: "x@y.com" }] }),
    ).toEqual({
      items: [
        { email: "bt@ornek.com", phone: "+905321234567" },
        { email: "x@y.com", phone: null },
      ],
    });
    const six = Array.from({ length: NOTIFY_CONTACTS_MAX + 1 }, (_, i) => ({ email: `a${i}@ornek.com` }));
    expect(putNotifyContactsInputSchema.safeParse({ items: six }).success).toBe(false);
  });

  it("AC-337: aynı adres (büyük/küçük harf, +ek) ikinci kez yazılamaz; geçersiz e-posta/telefon 400", () => {
    const dup = putNotifyContactsInputSchema.safeParse({ items: [{ email: "Ali@Ornek.com" }, { email: "ali+bt@ornek.com" }] });
    expect(dup.success).toBe(false);
    expect(dup.error?.issues[0]?.path).toEqual(["items", 1, "email"]);
    expect(putNotifyContactsInputSchema.safeParse({ items: [{ email: "adres" }] }).success).toBe(false);
    expect(putNotifyContactsInputSchema.safeParse({ items: [{ email: "a@b.com", phone: "12" }] }).success).toBe(false);
  });

  it("AC-296: bildirim türleri outbox kind sütununa (VARCHAR(20)) sığar; talep türleri değişmedi", () => {
    expect(NOTIFY_KINDS).toEqual(["REQ_ACCEPTED", "REQ_REJECTED", "REQ_EXPIRED"]);
    expect(UNATTENDED_NOTIFY_KINDS).toEqual(["UNATTENDED_STARTED", "UN_CONTACTS_CHANGED", "UN_DEVICE_REGISTERED"]);
    expect(OUTBOX_KINDS).toHaveLength(6);
    for (const k of OUTBOX_KINDS) expect(k.length).toBeLessThanOrEqual(20);
  });
});

describe("P27 /ws/device protokolü", () => {
  it("AC-273: imza girdisi bağlam önekli ve fixture ile aynı", () => {
    const a = deviceFixture.authMessage;
    expect(deviceAuthMessage(a.nonce, a.deviceId, a.origin)).toBe(a.expected);
  });

  it("AC-273: fixture valid.* örnekleri geçer", () => {
    for (const m of deviceFixture.valid.deviceAuth) expect(deviceAuthSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    for (const m of deviceFixture.valid.deviceInbound) expect(deviceInboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    for (const m of deviceFixture.valid.deviceOutbound) expect(deviceOutboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
  });

  it("AC-273: fixture invalid.* örnekleri reddedilir (kimlik sonrası device.auth dahil)", () => {
    for (const m of deviceFixture.invalid.deviceAuth) expect(deviceAuthSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    for (const m of deviceFixture.invalid.deviceInbound) expect(deviceInboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    for (const m of deviceFixture.invalid.deviceOutbound) expect(deviceOutboundSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
  });

  it("AC-295: sunucudan cihaza yerel anahtarı değiştiren mesaj yok", () => {
    const outbound = deviceOutboundSchema.options.map((o) => o.shape.t.value);
    expect(outbound).toEqual(["device.hello", "device.ready", "connect", "disconnect", "revoked"]);
    for (const o of deviceOutboundSchema.options) expect(Object.keys(o.shape)).not.toContain("localEnabled");
  });

  it("AC-342: gösterge metni; unsigned modda TEST önekli, üst sınırda kesilir", () => {
    expect(deviceIndicatorText("Ayşe K.", "Nokta Destek", false)).toBe("Uzaktan bağlantı: Ayşe K. — Nokta Destek");
    expect(deviceIndicatorText("Ayşe K.", "Nokta Destek", true)).toBe(
      `${DEVICE_INDICATOR_TEST_PREFIX}Uzaktan bağlantı: Ayşe K. — Nokta Destek`,
    );
    expect([...deviceIndicatorText("ş".repeat(200), "x", true)]).toHaveLength(DEVICE_INDICATOR_TEXT_MAX);
  });
});

describe("P27 konsol ve oturum sözleşmesi ekleri", () => {
  it("AC-273: misafirden GRANTED yalnız UI ya da UNATTENDED; VIEW'da UNATTENDED yok; sunucu kaynakları reddedilir", () => {
    expect(controlStateSchema.safeParse({ t: "control.state", state: "GRANTED", source: "UNATTENDED" }).success).toBe(true);
    expect(controlStateSchema.safeParse({ t: "control.state", state: "GRANTED", source: "UI" }).success).toBe(true);
    expect(controlStateSchema.safeParse({ t: "control.state", state: "GRANTED", source: "TECH" }).success).toBe(false);
    expect(controlStateSchema.safeParse({ t: "control.state", state: "VIEW", source: "UNATTENDED" }).success).toBe(false);
    expect(guestInboundSchema.safeParse({ t: "control.state", state: "GRANTED", source: "SYSTEM" }).success).toBe(false);
  });

  it("AC-275/AC-293/AC-295: yeni bitiş nedenleri session.ended'da geçerli ve hepsinin Türkçe etiketi var", () => {
    const added = ["permission", "device_revoked", "local_disabled", "indicator_failed", "device_timeout", "session_changed"] as const;
    for (const reason of added) {
      expect(SESSION_ENDED_REASONS).toContain(reason);
      expect(serverOutboundSchema.safeParse({ t: "session.ended", reason }).success, reason).toBe(true);
    }
    for (const r of [...added, ...DEVICE_CONNECT_FAIL_REASONS]) expect(END_REASON_LABELS[r], r).toBeTruthy();
  });

  it("AC-275: teknisyen hello'su isteğe bağlı gözetimsiz cihaz bilgisi taşır", () => {
    const hello = { t: "hello", role: "tech", sessionId: ID2, peerPresent: false, iceServers: [], maxEndsAt: null };
    expect(serverOutboundSchema.safeParse(hello).success).toBe(true);
    expect(serverOutboundSchema.safeParse({ ...hello, unattended: { deviceId: ID, deviceName: "MUHASEBE-PC" } }).success).toBe(true);
    expect(serverOutboundSchema.safeParse({ ...hello, unattended: { deviceId: ID } }).success).toBe(false);
  });

  it("AC-275: oturum modu ve onay kaynağı UNATTENDED; geçmiş filtresi 'Gözetimsiz' kabul eder", () => {
    expect(SESSION_MODES).toContain("UNATTENDED");
    expect(CONSENT_RECORD_SOURCES).toContain("UNATTENDED");
    expect(SESSION_MODE_LABELS.UNATTENDED).toBe("Gözetimsiz");
    expect(CONSENT_SOURCE_LABELS.UNATTENDED).toBeTruthy();
    expect(listSessionsQuerySchema.safeParse({ mode: "UNATTENDED" }).success).toBe(true);
  });

  it("AC-339: geçmiş listesi deviceId filtresi (ULID) kabul eder, geçersiz kimliği ve bilinmeyen alanı reddeder", () => {
    const deviceId = "01J0000000000000000000DEV1";
    expect(listSessionsQuerySchema.parse({ mode: "UNATTENDED", deviceId, pageSize: "20" })).toMatchObject({ deviceId, pageSize: 20 });
    expect(listSessionsQuerySchema.safeParse({ deviceId: "x" }).success).toBe(false);
    expect(listSessionsQuerySchema.safeParse({ device: deviceId }).success).toBe(false);
  });

  it("AC-273: P27 audit eylemleri benzersiz, `unattended.` önekli ve etiketli", () => {
    const actions = Object.values(UNATTENDED_AUDIT);
    expect(new Set(actions).size).toBe(actions.length);
    for (const a of actions) {
      expect(a.startsWith("unattended.")).toBe(true);
      expect(a.length).toBeLessThanOrEqual(60);
      expect(UNATTENDED_AUDIT_LABELS[a]).toBeTruthy();
    }
  });
});
