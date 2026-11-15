// P10 birim testleri: TOTP (RFC 6238 Ek B), AES-256-GCM kutusu, netguard (G-12), şablonlar, env anahtar ayrıştırma.
import { SMTP_INSECURE_AUTH_MESSAGE, SMTP_PORT_MESSAGE, smtpHostSchema, smtpSettingsInputSchema } from "@remote/contracts/api/tenants";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import {
  base32Decode,
  hotp,
  matchTotp,
  newRecoveryCode,
  normalizeRecoveryCode,
  otpauthUrl,
  recoveryCodeCandidates,
  recoveryCodeHash,
  stepOf,
} from "../../src/auth/mfa.ts";
import type { LoginUser } from "../../src/auth/repo.ts";
import { mfaStageOf } from "../../src/auth/session.ts";
import { loadEnv, parseEncryptionKeys } from "../../src/env.ts";
import { aadFor, SecretBox } from "../../src/lib/crypto.ts";
import type { Db } from "../../src/lib/db.ts";
import { base32Lower, sha256Hex } from "../../src/lib/ids.ts";
import { canonicalIp, createNetGuard, isBlockedIp } from "../../src/lib/netguard.ts";
import { MailService, type SmtpConfig, type TransportFactory } from "../../src/mail/service.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { FAKE_APP_ENCRYPTION_KEYS } from "../helpers/secrets.ts";
import { renderMailHtml, sessionLinkMail } from "../../src/mail/templates.ts";

describe("AC-67 TOTP (RFC 6238)", () => {
  const key = Buffer.from("12345678901234567890", "ascii");
  it("AC-67: RFC 6238 Ek B SHA-1 vektörleri (8 hane)", () => {
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [t, code] of vectors) expect(hotp(key, Math.floor(t / 30), 8)).toBe(code);
  });
  it("AC-67: ±1 adım kabul, ±2 ret; eşleşen adım döner", () => {
    const b32 = base32Lower(key).toUpperCase();
    const now = 1_700_000_000_000;
    const s = stepOf(now);
    expect(matchTotp(b32, hotp(key, s), now)).toBe(s);
    expect(matchTotp(b32, hotp(key, s - 1), now)).toBe(s - 1);
    expect(matchTotp(b32, hotp(key, s + 1), now)).toBe(s + 1);
    expect(matchTotp(b32, hotp(key, s + 2), now)).toBeNull();
    expect(base32Decode(b32).equals(key)).toBe(true);
  });
  it("AC-67: otpauth URL ve kurtarma kodu biçimi", () => {
    expect(otpauthUrl("ABC", "a@b.test")).toMatch(
      /^otpauth:\/\/totp\/Nokta%20Destek%3Aa%40b\.test\?secret=ABC&issuer=Nokta%20Destek&algorithm=SHA1&digits=6&period=30$/,
    );
    const c = newRecoveryCode();
    expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(normalizeRecoveryCode(` ${c.toUpperCase()} `)).toBe(c.replace("-", ""));
  });
});

describe("AC-78 gizli alan şifreleme", () => {
  const AAD = aadFor.smtpPassword("01TENANTA");
  it("AC-78: ver|iv|tag|ct, rotasyonda eski sürüm okunur, yanlış anahtar/bozuk veri hata", () => {
    const k1 = parseEncryptionKeys(`v1:${Buffer.alloc(32, 1).toString("base64")}`);
    const box1 = new SecretBox(k1);
    const enc = box1.encrypt("gizli-şifre", AAD);
    expect(enc[0]).toBe(1);
    expect(Buffer.from(enc).toString("utf8")).not.toContain("gizli");
    const both = new SecretBox(
      parseEncryptionKeys(`v1:${Buffer.alloc(32, 1).toString("base64")},v2:${Buffer.alloc(32, 2).toString("base64")}`),
    );
    expect(both.decrypt(enc, AAD)).toBe("gizli-şifre");
    expect(both.encrypt("x", AAD)[0]).toBe(2);
    const tampered = Uint8Array.from(enc);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => box1.decrypt(tampered, AAD)).toThrow();
    expect(() => new SecretBox(parseEncryptionKeys(`v2:${Buffer.alloc(32, 3).toString("base64")}`)).decrypt(enc, AAD)).toThrow();
  });
  it("B-P10-8: AAD tablo.sütun:satır bağlaması — başka satıra/sütuna taşınan değer çözülemez", () => {
    const box = new SecretBox(parseEncryptionKeys(FAKE_APP_ENCRYPTION_KEYS));
    const enc = box.encrypt("smtp-sifresi", AAD);
    expect(AAD).toBe("tenant_settings.smtp_pass_enc:01TENANTA");
    expect(aadFor.totpSecret("01USER")).toBe("users.totp_secret_enc:01USER");
    expect(box.decrypt(enc, AAD)).toBe("smtp-sifresi");
    expect(() => box.decrypt(enc, aadFor.smtpPassword("01TENANTB"))).toThrow(); // başka satır
    expect(() => box.decrypt(enc, aadFor.totpSecret("01TENANTA"))).toThrow(); // başka sütun
    expect(() => box.decrypt(enc, "")).toThrow(); // AAD'siz (eski biçim) okunmaz
  });
  it("B-P10-7: kurtarma kodu HMAC-SHA-256 (HKDF amaç anahtarı); düz SHA-256 değil, anahtara bağlı, rotasyonda eski sürüm eşleşir", () => {
    const k1 = `v1:${Buffer.alloc(32, 1).toString("base64")}`;
    const box1 = new SecretBox(parseEncryptionKeys(k1));
    const code = "abcde-fghij";
    const h = recoveryCodeHash(box1, code);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(sha256Hex(normalizeRecoveryCode(code)));
    expect(recoveryCodeHash(box1, " ABCDE FGHIJ ")).toBe(h);
    expect(recoveryCodeHash(new SecretBox(parseEncryptionKeys(`v1:${Buffer.alloc(32, 9).toString("base64")}`)), code)).not.toBe(h);
    const rotated = new SecretBox(parseEncryptionKeys(`${k1},v2:${Buffer.alloc(32, 2).toString("base64")}`));
    expect(recoveryCodeHash(rotated, code)).not.toBe(h);
    expect(recoveryCodeCandidates(rotated, code)).toContain(h);
  });
  it("AC-78: APP_ENCRYPTION_KEYS biçim doğrulaması", () => {
    expect(parseEncryptionKeys("v1:abc")).toBeNull();
    expect(parseEncryptionKeys(`v1:${Buffer.alloc(32).toString("base64")},v1:${Buffer.alloc(32).toString("base64")}`)).toBeNull();
    expect(parseEncryptionKeys(`v0:${Buffer.alloc(32).toString("base64")}`)).toBeNull();
  });
});

describe("AC-122 netguard (G-12)", () => {
  it("AC-122: özel, loopback, link-local, CGNAT, Docker, IPv6 ULA/link-local, IPv4-mapped engellenir; genel adres geçer", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "172.17.0.1",
      "172.30.0.2",
      "192.168.1.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "224.0.0.1",
    ])
      expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "185.126.217.99", "2a00:1450:4001::1"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("AC-122: adlardan biri bile yasaksa ret; çözülemeyen ad ret; ilk izinli IP döner", async () => {
    const g = createNetGuard({
      lookupAll: async (h) => (h === "mixed.test" ? ["8.8.8.8", "10.0.0.1"] : h === "ok.test" ? ["8.8.4.4"] : []),
    });
    await expect(g.resolve("mixed.test")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED", message: "Bu sunucu adresi kullanılamaz." });
    await expect(g.resolve("yok.test")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("localhost")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("[::1]")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("ok.test")).resolves.toBe("8.8.4.4");
  });
  it("B-P10-4: IPv6 — IPv4-compatible, mapped (her yazım), SIIT, NAT64 (/96 ve yerel /48), 6to4, Teredo, site-local, ULA, multicast, belirtilmemiş, discard engellenir; global unicast ve genel mapped IPv4 geçer", () => {
    const blocked = [
      "::127.0.0.1",
      "::7f00:1",
      "::a00:1", // IPv4-compatible (::/96)
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:7f00:1",
      "::FFFF:10.0.0.1", // IPv4-mapped → gömülü IPv4 kuralı
      "::ffff:0:7f00:1", // SIIT ::ffff:0:0:0/96
      "64:ff9b::7f00:1",
      "64:ff9b::808:808",
      "64:ff9b:1::1", // NAT64
      "2002:7f00:1::1",
      "2002:808:808::1", // 6to4 (tamamen)
      "2001::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
      "fec0::1",
      "fd12::1",
      "fc00::1",
      "fe80::1",
      "fe80::1%eth0",
      "ff02::1",
      "ff0e::1",
      "::",
      "::1",
      "100::1",
      "2001:db8::1",
      "3fff::1",
    ];
    for (const ip of blocked) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ["2a00:1450:4001::1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isBlockedIp(ip), ip).toBe(false);
    expect(canonicalIp("::ffff:7f00:1")).toBe("127.0.0.1");
  });
  it("B-P10-1: PUBLIC_BASE_URL hostunun çözümlendiği IP'ler (kendi genel adresimiz) engellenir; mapped yazımı da", async () => {
    const lookupAll = async (h: string) =>
      h === "rs.example.test"
        ? ["185.126.217.99"]
        : h === "smtp.ok.test"
          ? ["8.8.4.4"]
          : h === "self-alias.test"
            ? ["::ffff:185.126.217.99"]
            : [];
    const g = createNetGuard({ lookupAll, denyHosts: ["rs.example.test"] });
    await expect(g.resolve("185.126.217.99")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("self-alias.test")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("smtp.ok.test")).resolves.toBe("8.8.4.4");
    // IP literal PUBLIC_BASE_URL (staging biçimi)
    await expect(createNetGuard({ lookupAll, denyHosts: ["185.126.217.99"] }).resolve("rs.example.test")).rejects.toMatchObject({
      code: "HOST_NOT_ALLOWED",
    });
  });
});

describe("B-P10-10 netguard kendi-IP kuralı: fail-closed + kanonik IPv6", () => {
  const SELF6 = "2a01:4f8:c0c:1::1";
  it("B-P10-10: canonicalIp IPv6'yı RFC 5952 biçimine getirir (sıfır dolgu, büyük harf, uzun yazım)", () => {
    for (const v of ["2a01:04f8:0c0c:0001:0000::1", "2A01:4F8:C0C:1:0:0:0:1", "2a01:4f8:c0c:1::0001"])
      expect(canonicalIp(v), v).toBe(SELF6);
    expect(canonicalIp("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1"); // eşit uzunlukta ilk sıfır grubu
    expect(canonicalIp("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1"); // tek sıfır grubu kısaltılmaz
    expect(canonicalIp("8.8.8.8")).toBe("8.8.8.8");
  });
  it("B-P10-10: sıfır dolgulu IPv6 yazımı kendi adresimizi atlatamaz (hedef ve kendi-ad çözümü)", async () => {
    const lookupAll = async (h: string) =>
      h === "rs.example.test"
        ? ["2a01:04f8:0c0c:0001::0001"]
        : h === "padded.test"
          ? ["2A01:4F8:C0C:1:0:0:0:1"]
          : h === "smtp.ok.test"
            ? ["8.8.4.4"]
            : [];
    const g = createNetGuard({ lookupAll, denyHosts: ["rs.example.test"] });
    await expect(g.resolve("[2a01:04f8:0c0c:0001:0000::1]")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("padded.test")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("smtp.ok.test")).resolves.toBe("8.8.4.4");
  });
  it("B-P10-10: kendi ad çözülemezse (DNS hatası) ve önbellek yoksa ret; uyarı çağrılır", async () => {
    const seen: [string, boolean][] = [];
    const g = createNetGuard({
      lookupAll: async (h) => {
        if (h === "rs.example.test") throw Object.assign(new Error("dns"), { code: "ESERVFAIL" });
        return ["8.8.4.4"];
      },
      denyHosts: ["rs.example.test"],
      onSelfUnresolved: (host, cached) => seen.push([host, cached]),
    });
    await expect(g.resolve("185.126.217.99")).rejects.toMatchObject({
      code: "HOST_NOT_ALLOWED",
      message: "Bu sunucu adresi kullanılamaz.",
    });
    await expect(g.resolve("smtp.ok.test")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" }); // fail-closed: hiçbir hedef geçmez
    expect(seen).toEqual([
      ["rs.example.test", false],
      ["rs.example.test", false],
    ]);
  });
  it("B-P10-10: geçici DNS hatasında son başarılı çözüm kullanılır (kendi IP yine engelli, diğer hedefler geçer)", async () => {
    let dnsUp = true;
    const seen: boolean[] = [];
    const g = createNetGuard({
      lookupAll: async (h) => {
        if (h === "rs.example.test") {
          if (!dnsUp) throw new Error("dns");
          return ["185.126.217.99"];
        }
        return h === "smtp.ok.test" ? ["8.8.4.4"] : [];
      },
      denyHosts: ["rs.example.test"],
      onSelfUnresolved: (_h, cached) => seen.push(cached),
    });
    await expect(g.resolve("smtp.ok.test")).resolves.toBe("8.8.4.4");
    dnsUp = false;
    await expect(g.resolve("185.126.217.99")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("[::ffff:185.126.217.99]")).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(g.resolve("smtp.ok.test")).resolves.toBe("8.8.4.4");
    expect(seen).toEqual([true, true, true]);
  });
});

describe("AC-79 SMTP şeması", () => {
  it("AC-79: host IDN → punycode, IPv6 köşeli, URL/boşluk/CRLF reddi; şifre kullanıcı ister; boş şifre korunur", () => {
    expect(smtpHostSchema.parse(" Posta.Örnek.com.tr ")).toBe("posta.xn--rnek-4qa.com.tr");
    expect(smtpHostSchema.parse("[2001:db8::1]")).toBe("[2001:db8::1]");
    for (const bad of ["smtp.test:25", "a b", "smtp.test\r\nX", "http://x", "u@h"])
      expect(smtpHostSchema.safeParse(bad).success, bad).toBe(false);
    const base = { host: "smtp.test", port: 587, security: "STARTTLS", fromEmail: "a@b.test" };
    expect(smtpSettingsInputSchema.safeParse({ ...base, password: "x" }).success).toBe(false);
    expect(smtpSettingsInputSchema.parse({ ...base, user: "u", password: "" }).password).toBeUndefined();
    expect(smtpSettingsInputSchema.safeParse({ ...base, fromName: "A\nB" }).success).toBe(false);
  });
  it("B-P10-1: port yalnız 25/465/587/2525", () => {
    const base = { host: "smtp.test", security: "STARTTLS", fromEmail: "a@b.test" };
    for (const port of [25, 465, 587, 2525]) expect(smtpSettingsInputSchema.safeParse({ ...base, port }).success, String(port)).toBe(true);
    for (const port of [22, 443, 3306, 4444, 0, 65535, 587.5]) {
      const r = smtpSettingsInputSchema.safeParse({ ...base, port });
      expect(r.success, String(port)).toBe(false);
      expect(r.error?.issues[0]).toMatchObject({ path: ["port"], message: SMTP_PORT_MESSAGE });
    }
  });
  it("B-P10-5: güvenlik Yok + kullanıcı adı/şifre → alan hatası `security`; kimliksiz Yok ve TLS'li kimlik kabul", () => {
    const base = { host: "smtp.test", port: 25, fromEmail: "a@b.test" };
    for (const bad of [{ user: "u" }, { user: "u", password: "p" }]) {
      const r = smtpSettingsInputSchema.safeParse({ ...base, security: "NONE", ...bad });
      expect(r.success).toBe(false);
      expect(r.error?.issues.find((i) => i.path[0] === "security")?.message).toBe(SMTP_INSECURE_AUTH_MESSAGE);
    }
    expect(smtpSettingsInputSchema.safeParse({ ...base, security: "NONE" }).success).toBe(true);
    expect(smtpSettingsInputSchema.safeParse({ ...base, port: 587, security: "STARTTLS", user: "u", password: "p" }).success).toBe(true);
  });
});

describe("B-P10-1/5 gönderim katmanı", () => {
  const log = { warn: () => undefined, error: () => undefined };
  const logo = { logoUrlFor: async () => "https://rs.test/img/logo.png", fallbackLogoUrl: "https://rs.test/img/logo.png" };
  const netguard = createNetGuard({ lookupAll: async () => ["8.8.4.4"] });
  const cfg: SmtpConfig = {
    host: "smtp.ok.test",
    port: 587,
    security: "STARTTLS",
    user: null,
    pass: null,
    fromName: null,
    fromEmail: "a@b.test",
  };
  const content = { subject: "s", text: "t", bodyHtml: "<p>t</p>" };
  const mk = (transport: TransportFactory, attemptCapMs?: number) =>
    new MailService({
      db: {} as Db,
      secrets: new SecretBox(null),
      netguard,
      metrics: createMetrics(),
      log,
      ...logo,
      transport,
      ...(attemptCapMs ? { attemptCapMs } : {}),
    });

  it("B-P10-1/5: izinsiz port (DB'de eski değer) ve Yok+kimlik bilgisi bağlantı kurulmadan reddedilir", async () => {
    let opened = 0;
    const svc = mk(() => ((opened += 1), { sendMail: async () => ({}), close: () => undefined }));
    expect(await svc.deliver({ ...cfg, port: 22 }, "x@y.test", content)).toEqual({ ok: false, reason: "port_not_allowed" });
    expect(await svc.deliver({ ...cfg, security: "NONE", port: 25, user: "u", pass: "p" }, "x@y.test", content)).toEqual({
      ok: false,
      reason: "insecure_auth",
    });
    expect(opened).toBe(0);
    expect(await svc.deliver(cfg, "x@y.test", content)).toEqual({ ok: true });
    expect(opened).toBe(1);
  });

  it("B-P10-1: deneme tavanı (asılı sunucu) ve etkileşimli başarısızlıkta sabit süre tabanı — anında ret ile zaman aşımı aynı sürede döner", async () => {
    const audit = { auditLog: { create: async () => ({}) } } as unknown as Db;
    const ctx = { ip: "", userAgent: "", requestId: "" };
    const a = { tenantId: null, kind: "test", entity: "tenant_settings" };
    const time = async (send: () => Promise<unknown>) => {
      const t0 = Date.now();
      await send();
      return Date.now() - t0;
    };
    const refused = new MailService({
      db: audit,
      secrets: new SecretBox(null),
      netguard,
      metrics: createMetrics(),
      log,
      ...logo,
      attemptCapMs: 400,
      transport: () => ({
        sendMail: async () => Promise.reject(Object.assign(new Error("x"), { code: "ECONNECTION" })),
        close: () => undefined,
      }),
    });
    const hanging = new MailService({
      db: audit,
      secrets: new SecretBox(null),
      netguard,
      metrics: createMetrics(),
      log,
      ...logo,
      attemptCapMs: 400,
      transport: () => ({ sendMail: () => new Promise(() => undefined), close: () => undefined }),
    });
    const tr = await time(() => refused.sendForTenant(ctx, a, "x@y.test", content, cfg, { interactive: true }));
    const th = await time(() => hanging.sendForTenant(ctx, a, "x@y.test", content, cfg, { interactive: true }));
    expect(tr).toBeGreaterThanOrEqual(390);
    expect(th).toBeGreaterThanOrEqual(390);
    expect(Math.abs(tr - th)).toBeLessThan(250);
    expect(await hanging.deliver(cfg, "x@y.test", content, 1)).toEqual({ ok: false, reason: "connect" });
  });
});

describe("B-P10-3 test kanalı production'da kapalı", () => {
  it("B-P10-3: NODE_ENV=production iken buildApp({mfaSetupEnforcement:false}) hata fırlatır", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://rs.test",
      DATABASE_URL: "mysql://app:x@db/remote",
      TRUSTED_PROXY_CIDR: "172.30.0.2/32",
      SESSION_REF_KEY: "k".repeat(32),
      APP_ENCRYPTION_KEYS: FAKE_APP_ENCRYPTION_KEYS,
      LOG_LEVEL: "silent",
    });
    expect(() => buildApp({ env, db: {} as Db, mfaSetupEnforcement: false })).toThrow(/production/);
  });
  it("QA-P10: 2FA kurulum zorunluluğu uygulama örneğine ait — `false` örneği diğer örnekleri etkilemez", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "https://rs.test",
      DATABASE_URL: "mysql://app:x@db/remote",
      SESSION_REF_KEY: "k".repeat(32),
      APP_ENCRYPTION_KEYS: FAKE_APP_ENCRYPTION_KEYS,
      LOG_LEVEL: "silent",
    });
    const strict = buildApp({ env, db: {} as Db });
    const loose = buildApp({ env, db: {} as Db, mfaSetupEnforcement: false });
    const strict2 = buildApp({ env, db: {} as Db, mfaSetupEnforcement: true });
    try {
      expect([strict.mfaSetupEnforced, loose.mfaSetupEnforced, strict2.mfaSetupEnforced]).toEqual([true, false, true]);
    } finally {
      await Promise.all([strict.close(), loose.close(), strict2.close()]);
    }
  });
  it("AC-67: mfaStageOf — kurulum aşaması yalnız `setupEnforced` iken; etkin 2FA doğrulaması her zaman", () => {
    const admin = { role: "ADMIN", totpEnabled: false, tenant: null } as unknown as LoginUser;
    expect(mfaStageOf(admin, true, true)).toBe("setup");
    expect(mfaStageOf(admin, true, false)).toBe("ok");
    const withTotp = { ...admin, totpEnabled: true } as LoginUser;
    expect(mfaStageOf(withTotp, false, false)).toBe("verify");
    expect(mfaStageOf(withTotp, true, true)).toBe("ok");
  });
});

describe("AC-10 şablon", () => {
  it("AC-10: logo, teknisyen, link, kod, Europe/Istanbul son geçerlilik; HTML kaçışlı; konu tek satır", () => {
    const m = sessionLinkMail({
      firm: "A<b>\r\nX",
      technician: "Ayşe <x>",
      link: "https://rs.test/session/abc",
      code: "12345678",
      expiresAt: new Date("2026-11-12T10:00:00Z"),
    });
    expect(m.subject).not.toMatch(/[\r\n]/);
    const html = renderMailHtml("https://rs.test/img/logo.png", m.bodyHtml);
    expect(html).toContain('<img src="https://rs.test/img/logo.png"');
    expect(m.bodyHtml).toContain("Ayşe &#60;x&#62;");
    expect(m.text).toContain("1234 5678");
    expect(m.text).toContain("13:00");
    expect(m.text).toContain("https://rs.test/session/abc");
  });
});
