// P8b sözleşmesi (contracts şemaları + ortak fixture; fixture okuma node:fs gerektirdiği için sunucu birim testinde): talep formu, ret mesajı, güvenilen CIDR, durum makinesi, WS örnekleri (AC-134, 140, 143, 152, 157).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REQUEST_REJECT_PRESETS,
  REQUEST_STATUSES,
  REQUEST_TRANSITIONS,
  canTransition,
  checkTrustedCidr,
  createRequestInputSchema,
  customerNameSchema,
  descriptionSchema,
  isFirstSeenSource,
  listRequestsQuerySchema,
  networkBadge,
  optionalEmailSchema,
  phoneSchema,
  refFromFileName,
  rejectMessageSchema,
  updateRequestSettingsInputSchema,
} from "@remote/contracts/api/requests";
import { PERMISSION_KEYS, effectivePermissions } from "@remote/contracts/permissions";
import { panelOutboundSchema, requestInboundSchema, requestOutboundSchema } from "@remote/contracts/ws-request";

type Case = { in: string; out: string | null; valid?: boolean };
const form = JSON.parse(
  readFileSync(new URL("../../../../packages/contracts/fixtures/request-form.json", import.meta.url), "utf8"),
) as Record<string, Case[]>;
const ws = JSON.parse(readFileSync(new URL("../../../../packages/contracts/fixtures/ws-request.json", import.meta.url), "utf8")) as {
  valid: Record<string, unknown[]>;
  invalid: Record<string, unknown[]>;
};

const outOf = (r: { success: boolean; data?: unknown }): unknown => (r.success ? r.data : null);

describe("talep formu alanları (AC-134)", () => {
  it("AC-134: telefon normalizasyonu ortak fixture ile", () => {
    for (const c of form.phone ?? []) expect(outOf(phoneSchema.safeParse(c.in)), c.in).toBe(c.out);
  });
  it("AC-134: ad soyad 2..80 kod noktası, Cc/Cf yok, trim", () => {
    for (const c of form.customerName ?? []) expect(outOf(customerNameSchema.safeParse(c.in)), c.in).toBe(c.out);
    expect(customerNameSchema.safeParse("😀".repeat(80)).success).toBe(true);
    expect(customerNameSchema.safeParse("😀".repeat(81)).success).toBe(false);
  });
  it("AC-134: açıklama tek satıra iner, 10..500, görünmez karakter yok", () => {
    for (const c of form.description ?? []) expect(outOf(descriptionSchema.safeParse(c.in)), JSON.stringify(c.in)).toBe(c.out);
    expect(descriptionSchema.safeParse("a".repeat(500)).success).toBe(true);
    expect(descriptionSchema.safeParse("a".repeat(501)).success).toBe(false);
  });
  it("AC-134: e-posta opsiyonel, boş → undefined", () => {
    for (const c of form.email ?? []) {
      const r = optionalEmailSchema.safeParse(c.in);
      expect(r.success, c.in).toBe(c.valid);
      if (r.success) expect(r.data ?? null).toBe(c.out);
    }
  });
  it("AC-134: firma dosya adından ref", () => {
    for (const c of form.fileName ?? []) expect(refFromFileName(c.in), c.in).toBe(c.out);
  });
  it("AC-134/135: POST /public/requests gövdesi strict, onay true zorunlu", () => {
    const body = {
      ref: "abcdefghijk23456",
      clientInstanceId: "A".repeat(22),
      clientVersion: "0.9.0",
      customerName: "Ayşe",
      phone: "0532 123 45 67",
      description: "Yazıcı çalışmıyor",
      consentTextId: "01JC0000000000000000000000",
      consentAccepted: true,
    };
    expect(createRequestInputSchema.parse(body)).toMatchObject({ phone: "+905321234567" });
    expect(createRequestInputSchema.safeParse({ ...body, consentAccepted: false }).success).toBe(false);
    expect(createRequestInputSchema.safeParse({ ...body, extra: 1 }).success).toBe(false);
    expect(createRequestInputSchema.safeParse({ ...body, deviceKey: "kisa" }).success).toBe(false);
    expect(createRequestInputSchema.safeParse({ ...body, email: "" }).success).toBe(true);
  });
});

describe("ret mesajı (AC-157, G-E9-12)", () => {
  it("AC-157: hazır metinler geçer; 5..200; bağlantı/e-posta/telefon/alan adı reddedilir", () => {
    for (const p of REQUEST_REJECT_PRESETS) expect(rejectMessageSchema.safeParse(p).success, p).toBe(true);
    const bad = [
      "kısa",
      "x".repeat(201),
      "bakınız https://kotu.example",
      "www.kotu",
      "kotu.com adresine girin",
      "mail: a@b",
      "Bizi 0532 123 45 67 arayın",
      "satır\nsonu",
      "gizli​karakter",
    ];
    for (const b of bad) expect(rejectMessageSchema.safeParse(b).success, b).toBe(false);
    expect(rejectMessageSchema.safeParse("  Yarın 10.30'da arayacağız  ").success).toBe(true);
  });
});

describe("güvenilen CIDR (AC-152, §13.6)", () => {
  it("AC-152: IPv4 ≥ /16, IPv6 ≥ /32, ağ adresine normalize; özel/loopback reddi", () => {
    expect(checkTrustedCidr("203.0.113.77/24")).toEqual({ ok: true, cidr: "203.0.113.0/24" });
    expect(checkTrustedCidr("2001:db8:abcd:12::1/48")).toEqual({ ok: true, cidr: "2001:db8:abcd::/48" });
    expect(checkTrustedCidr("2001:DB8::/32")).toEqual({ ok: true, cidr: "2001:db8::/32" });
    for (const b of [
      "203.0.0.0/15",
      "2001::/31",
      "10.1.0.0/16",
      "192.168.1.0/24",
      "127.0.0.1/32",
      "fe80::/64",
      "fd00::/48",
      "::1/128",
      "1.2.3.4",
      "1.2.3.4/33",
      "01.2.3.4/24",
      "abc/24",
    ]) {
      expect(checkTrustedCidr(b).ok, b).toBe(false);
    }
  });
  it("AC-152: ayar gövdesi — tekil liste, ≤ 10 CIDR, ≤ 5 alıcı, kanal açık ⇒ ≥ 1 alıcı, bekleme 10..120", () => {
    const base = {
      waitMinutes: 30,
      trustedCidrs: [],
      whatsapp: { enabled: false, recipients: [] },
      email: { enabled: false, recipients: [] },
    };
    expect(
      updateRequestSettingsInputSchema.parse({ ...base, whatsapp: { enabled: true, recipients: ["0532 123 45 67"] } }).whatsapp.recipients,
    ).toEqual(["+905321234567"]);
    const bad = [
      { ...base, waitMinutes: 9 },
      { ...base, waitMinutes: 121 },
      { ...base, whatsapp: { enabled: true, recipients: [] } },
      { ...base, whatsapp: { enabled: false, recipients: ["05321234567", "+905321234567"] } },
      { ...base, trustedCidrs: ["203.0.113.1/24", "203.0.113.0/24"] },
      { ...base, trustedCidrs: Array.from({ length: 11 }, (_, i) => `203.0.${i}.0/24`) },
      { ...base, whatsapp: { enabled: false, recipients: Array.from({ length: 6 }, (_, i) => `+9053212345${60 + i}`) } },
    ];
    for (const b of bad) expect(updateRequestSettingsInputSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});

describe("durum makinesi (AC-140)", () => {
  it("AC-140: yalnız tanımlı geçişler; tüm (kaynak, hedef) çiftleri", () => {
    const allowed = new Set([
      "PENDING>ACCEPTED",
      "PENDING>REJECTED",
      "PENDING>CANCELLED",
      "PENDING>EXPIRED",
      "ACCEPTED>CONNECT_FAILED",
      "ACCEPTED>CANCELLED",
    ]);
    for (const from of REQUEST_STATUSES)
      for (const to of REQUEST_STATUSES) expect(canTransition(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
    expect(Object.keys(REQUEST_TRANSITIONS).sort()).toEqual([...REQUEST_STATUSES].sort());
  });
  it("AC-146 (G-E9-15): rozet yalnız IP/TRUSTED; PREFIX uyarıyı kaldırmaz", () => {
    expect(networkBadge("PREFIX")).toBe(false);
    expect(isFirstSeenSource("PREFIX", false)).toBe(true);
    expect(isFirstSeenSource("IP", false)).toBe(false);
    expect(isFirstSeenSource("NONE", true)).toBe(false);
  });
  it("AC-146: liste sorgusu — status yalnız history, pageSize ≤ 100", () => {
    expect(listRequestsQuerySchema.parse({})).toEqual({ tab: "pending", page: 1, pageSize: 25 });
    expect(listRequestsQuerySchema.safeParse({ status: "EXPIRED" }).success).toBe(false);
    expect(listRequestsQuerySchema.safeParse({ tab: "history", status: "PENDING" }).success).toBe(false);
    expect(listRequestsQuerySchema.safeParse({ tab: "history", pageSize: "101" }).success).toBe(false);
  });
});

describe("yetkiler (AC-147)", () => {
  it("AC-147: support_requests.view/accept tek tanımda; ADMIN varsayılan açık, USER kapalı", () => {
    expect(PERMISSION_KEYS).toEqual(expect.arrayContaining(["support_requests.view", "support_requests.accept"]));
    expect(effectivePermissions("ADMIN", [])).toContain("support_requests.accept");
    expect(effectivePermissions("USER", [])).not.toContain("support_requests.view");
  });
});

describe("WS sözleşme örnekleri (mimari-protokol §5)", () => {
  const schemas = {
    requestInbound: requestInboundSchema,
    requestOutbound: requestOutboundSchema,
    panelOutbound: panelOutboundSchema,
  } as const;
  it("AC-139/141/149: valid geçer, invalid reddedilir (G-E9-15: knownNetwork alanı artık geçersiz)", () => {
    for (const [k, schema] of Object.entries(schemas)) {
      for (const m of ws.valid[k] ?? []) expect(schema.safeParse(m).success, `${k} ${JSON.stringify(m)}`).toBe(true);
      for (const m of ws.invalid[k] ?? []) expect(schema.safeParse(m).success, `${k} ${JSON.stringify(m)}`).toBe(false);
    }
  });
});
