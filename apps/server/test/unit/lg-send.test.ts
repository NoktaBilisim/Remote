// LG-2 birim testleri (mimari-link-gonderme §3.1, §5, §12; güvenlik LG tasarım turu O-LG-1, D-LG-3, D-LG-4): `renderFor`
// şablonları, indirme belirteci türetme ve K2 WhatsApp taşıma yüklemi.
import { CHANNELS_BY_KIND } from "@remote/contracts/api/customer-send";
import { normalizeRegistrationCode } from "@remote/contracts/api/unattended";
import { describe, expect, it } from "vitest";
import { SecretBox } from "../../src/lib/crypto.ts";
import type { Db } from "../../src/lib/db.ts";
import { sha256Hex } from "../../src/lib/ids.ts";
import { renderFor, type TemplateInput } from "../../src/notify/customer-templates.ts";
import { WhatsappNotifier } from "../../src/notify/whatsapp.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { codeHash, downloadToken, downloadTokenHash } from "../../src/unattended/registration.ts";
import { FakeClock } from "../helpers/ws.ts";

const EXP = new Date("2026-11-20T10:00:00Z");
const LINK = `https://rs.test/session/${"a".repeat(43)}`;
const AGENT = { url: "https://rs.test/api/v1/public/agent/download?ref=REF", sha256: "c".repeat(64) };
const k1 = (o: Partial<Extract<TemplateInput, { kind: "SESSION" }>> = {}): TemplateInput => ({
  kind: "SESSION",
  firm: "Nokta Bilişim",
  technician: "Mehmet Ali Yılmaz",
  link: LINK,
  code: "12345678",
  expiresAt: EXP,
  agent: AGENT,
  ...o,
});
const k2 = (firm = "Nokta Bilişim"): TemplateInput => ({
  kind: "UNATTENDED_CODE",
  firm,
  downloadUrl: `https://rs.test/api/v1/public/unattended/download?t=${"T".repeat(43)}`,
  code: "ABCD-1234-EFGH-5678",
  expiresAt: EXP,
  sha256: "d".repeat(64),
});
const k3 = (firm = "Nokta Bilişim", webFormUrl: string | null = "https://rs.test/r/abcdefghijklmnop"): TemplateInput => ({
  kind: "CUSTOMER",
  firm,
  downloadUrl: "https://rs.test/downloads/NoktaDestek-firma-abcdefghijklmnop.exe",
  webFormUrl,
  origin: "https://rs.test",
});

describe("LG şablonlar (renderFor)", () => {
  it("AC-410: K1 her kanalda firma, teknisyen adı, bağlantı, kod, TR saati; istemci satırı e-posta + WhatsApp'ta (SMS'te yok); müşteri adı yok", () => {
    for (const ch of ["EMAIL", "WHATSAPP", "SMS"] as const) {
      const r = renderFor(ch, k1());
      expect(r.text).toContain("Nokta Bilişim");
      expect(r.text).toContain(LINK);
      if (ch === "SMS") expect(r.text).not.toContain("agent/download");
      else expect(r.text).toContain(AGENT.url);
      expect(r.text).toContain("1234 5678");
      expect(r.text).toContain("13:00"); // Europe/Istanbul
      expect(r.text).toContain(ch === "EMAIL" ? "Mehmet Ali Yılmaz" : "Mehmet Y.");
    }
  });

  it("AC-412: e-postada SHA-256 ve 'Destek-' ve Windows 10 / 11; kısa metinde SHA yok; kapı kapalıyken indirme yolu yok", () => {
    const mail = renderFor("EMAIL", k1());
    expect(mail.text).toContain(AGENT.sha256);
    expect(mail.text).toContain('"Destek-"');
    expect(mail.text).toContain("Windows 10 / 11");
    expect(renderFor("WHATSAPP", k1()).text).not.toContain(AGENT.sha256);
    expect(renderFor("SMS", k1()).text).not.toContain(AGENT.sha256);
    for (const ch of ["EMAIL", "WHATSAPP", "SMS"] as const) expect(renderFor(ch, k1({ agent: null })).text).not.toContain("download");
  });

  it("AC-418: K2 e-posta kod, indirme, dosya adı, SHA, 4 adım, uyarı; kısa metin SHA'sız", () => {
    const m = renderFor("EMAIL", k2());
    for (const s of ["ABCD-1234-EFGH-5678", "unattended/download?t=", "NoktaDestekServis.exe", "d".repeat(64), "4. ", "siz istemediyseniz"])
      expect(m.text).toContain(s);
    expect(m.subject).toBe("Nokta Bilişim – uzaktan destek servisi kurulumu");
    expect(renderFor("WHATSAPP", k2()).text).not.toContain("d".repeat(64));
  });

  it("AC-422: K3 indirme + form bağlantısı + uyarı; form kapalıyken form satırı yok", () => {
    const r = renderFor("WHATSAPP", k3());
    expect(r.text).toContain("NoktaDestek-firma-abcdefghijklmnop.exe");
    expect(r.text).toContain("/r/abcdefghijklmnop");
    expect(r.text).toContain("Bu bağlantılar firmanıza özeldir, paylaşmayın.");
    expect(renderFor("EMAIL", k3("F", null)).text).not.toContain("/r/");
  });

  it("AC-424 / D-LG-4: üç şablonda evil.com ve ham <b> yok; WA biçim karakterleri ve uzun rakam dizisi süzülür", () => {
    for (const firm of ["evil.com", "<b>x</b>", "*Banka* _4440000_ ~arayın~ `x`"]) {
      const inputs = [k1({ firm, technician: firm }), k2(firm), k3(firm)];
      for (const i of inputs)
        for (const ch of ["EMAIL", "WHATSAPP"] as const) {
          const r = renderFor(ch, i);
          const all = `${r.subject ?? ""}\n${r.text}\n${r.bodyHtml ?? ""}`;
          expect(all).not.toContain("evil.com");
          expect(all).not.toContain("<b>x");
          expect(all).not.toContain("4440000");
          expect(r.text).not.toMatch(/[*_~`]/);
        }
    }
  });

  it("AC-407: aynı girdi → aynı metin (önizleme = gönderim; tek fonksiyon, deterministik)", () => {
    expect(renderFor("EMAIL", k2())).toEqual(renderFor("EMAIL", k2()));
  });

  it("O-LG-3: K2 kanalları yalnız EMAIL (WhatsApp kapalı)", () => {
    expect(CHANNELS_BY_KIND.UNATTENDED_CODE).toEqual(["EMAIL"]);
  });
});

describe("AC-419 / D-LG-3 indirme belirteci", () => {
  const box = new SecretBox(new Map([[1, Buffer.alloc(32, 7)]]));
  it("AC-419: aynı kod → aynı belirteç; farklı kod → farklı; 43 karakter base64url (ham 32 bayt); hash 64 küçük hex", () => {
    const a = downloadToken(box, "ABCD1234EFGH5678");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(downloadToken(box, "ABCD1234EFGH5678")).toBe(a);
    expect(downloadToken(box, "ABCD1234EFGH5679")).not.toBe(a);
    expect(downloadTokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(downloadTokenHash(a)).toBe(sha256Hex(a));
  });

  it("D-LG-3: biçimli ve düz kod aynı belirteci verir (normalize); HKDF amacı code_hash'ten ayrı", () => {
    const code = normalizeRegistrationCode("abcd-1234-efgh-5678");
    expect(downloadToken(box, code)).toBe(downloadToken(box, "ABCD1234EFGH5678"));
    const tokenHex = Buffer.from(downloadToken(box, code), "base64url").toString("hex");
    expect(tokenHex).not.toBe(codeHash(box, code));
    expect(downloadTokenHash(downloadToken(box, code))).not.toBe(codeHash(box, code));
  });
});

describe("O-LG-1 WhatsApp transportEncrypted", () => {
  const make = (url: string, production: boolean, allow = false) =>
    new WhatsappNotifier({
      url,
      apiKey: null,
      production,
      allowInsecureHttp: allow,
      publicBaseUrl: "https://rs.test",
      db: {} as Db,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      metrics: createMetrics(),
      clock: new FakeClock(),
      fetch: async () => ({ ok: true, status: 200 }),
    });

  it("O-LG-1: K13 bayraklı http genel adres → usable ama şifresiz", () => {
    const n = make("http://203.0.113.10:3000", true, true);
    expect(n.usable).toBe(true);
    expect(n.transportEncrypted).toBe(false);
  });
  it("O-LG-1: prod dışı http genel adres → şifresiz", () => {
    const n = make("http://203.0.113.10:3000", false);
    expect(n.usable).toBe(true);
    expect(n.transportEncrypted).toBe(false);
  });
  it("O-LG-1: http özel ağ → şifresiz (özel ağ istisnası yok)", () => {
    const n = make("http://10.0.0.5:3000", true);
    expect(n.usable).toBe(true);
    expect(n.transportEncrypted).toBe(false);
  });
  it("O-LG-1: https → şifreli; loopback http → şifreli; kullanılamaz kanal → false", () => {
    expect(make("https://wa.example.com", true).transportEncrypted).toBe(true);
    expect(make("http://127.0.0.1:3000", true).transportEncrypted).toBe(true);
    expect(make("", true).transportEncrypted).toBe(false);
  });
});
