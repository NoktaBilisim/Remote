// P14a A3 birim testleri: AC-208 (kod kapısı metriği), AC-211 (MySQL TLS / açık anahtar kuralı, host sınıfı),
// AC-212 (MySQL test hata sınıfı → metrik etiketi).
import { describe, expect, it } from "vitest";
import pino from "pino";
import { FixedWindowCounter } from "../../src/lib/rate.ts";
import { classifyHost, classifyIp } from "../../src/lib/netguard.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { assertLookupAllowed, countFailedLookup, createPublicLimits, closePublicLimits } from "../../src/sessions/public.ts";
import { classifyMysqlError, connectionOptions, type ProbeTarget } from "../../src/settings/mysql-probe.ts";
import { mysqlFailureClass } from "../../src/settings/system.ts";

const target = (o: Partial<ProbeTarget> = {}): ProbeTarget => ({
  host: "db.example.com",
  port: 3306,
  database: "d",
  user: "u",
  password: "p",
  requireTls: false,
  ...o,
});
const resolvesTo = (ips: string[]) => async () => ips;

describe("AC-208: kod denemesi 429'ları scope etiketiyle sayılır", () => {
  it("AC-208/S14-6: önek kovası kilitlenince prefix, IP kovası kilitlenince ip; kilitli kova başına bir (yeniden denemeler sayılmaz)", () => {
    const metrics = createMetrics();
    const l = createPublicLimits(pino({ level: "silent" }), undefined, metrics);
    try {
      // Önek kovası: farklı IP'lerden 30 başarısız → 31.'de prefix kilidi (IP'ler 10'a ulaşmaz).
      let thrown = 0;
      for (let i = 0; i < 31; i++) {
        try {
          countFailedLookup(l, `ip${i % 5}`, "pfx");
        } catch {
          thrown++;
        }
      }
      expect(thrown).toBe(1);
      for (let i = 0; i < 25; i++) expect(() => assertLookupAllowed(l, "ip-yeni", "pfx")).toThrow();
      const text = metrics.render();
      expect(text).toContain('rs_guest_code_rate_limited_total{scope="prefix"} 1');
      expect(text).not.toContain('scope="ip"');
      // IP kovası: aynı IP'den 11. başarısız → ip kilidi.
      for (let i = 0; i < 11; i++) {
        try {
          countFailedLookup(l, "tek-ip", `p${i}`);
        } catch {
          /* 11.'de 429 */
        }
      }
      for (let i = 0; i < 5; i++) expect(() => assertLookupAllowed(l, "tek-ip", "p-baska")).toThrow();
      expect(metrics.render()).toContain('rs_guest_code_rate_limited_total{scope="ip"} 1');
    } finally {
      closePublicLimits(l);
    }
  });

  it("AC-208: metrik /metrics çıktısında sıfırla da yayımlanır", () => {
    expect(createMetrics().render()).toContain("rs_guest_code_rate_limited_total 0");
  });
});

describe("AC-211: MySQL TLS ve açık anahtar kuralı", () => {
  it("AC-211: host sınıfı — loopback / özel / genel / çözülemeyen; IPv4-mapped kanonik", async () => {
    expect(classifyIp("127.0.0.5")).toBe("loopback");
    expect(classifyIp("::1")).toBe("loopback");
    expect(classifyIp("::ffff:10.1.2.3")).toBe("private");
    expect(classifyIp("172.20.0.4")).toBe("private");
    expect(classifyIp("fd00::1")).toBe("private");
    expect(classifyIp("8.8.8.8")).toBe("public");
    expect(classifyIp("fe80::1%eth0")).toBe("public");
    expect(await classifyHost("localhost")).toEqual({ cls: "loopback", ip: "127.0.0.1" });
    expect(await classifyHost("[::1]")).toEqual({ cls: "loopback", ip: "::1" });
    expect(await classifyHost("db.lan", resolvesTo(["10.0.0.2", "127.0.0.1"]))).toEqual({ cls: "private", ip: "10.0.0.2" });
    expect((await classifyHost("karma.test", resolvesTo(["10.0.0.2", "1.1.1.1"]))).cls).toBe("public");
    expect(await classifyHost("yok.test", resolvesTo([]))).toEqual({ cls: "unresolved", ip: null });
    expect((await classifyHost("hata.test", () => Promise.reject(new Error("ENOTFOUND")))).cls).toBe("unresolved");
  });

  it("AC-211: TLS kapalıyken allowPublicKeyRetrieval yalnız loopback/özel adrese çözülen adda (S14-3); bağlantı çözülen IP'ye", async () => {
    const pub = await connectionOptions(target(), 1000, resolvesTo(["93.184.216.34"]));
    expect(pub).toMatchObject({ host: "93.184.216.34", allowPublicKeyRetrieval: false });
    expect(pub).not.toHaveProperty("ssl");
    expect(await connectionOptions(target({ host: "db.lan" }), 1000, resolvesTo(["192.168.1.9"]))).toMatchObject({
      host: "192.168.1.9",
      allowPublicKeyRetrieval: true,
    });
    expect(await connectionOptions(target({ host: "127.0.0.1" }), 1000)).toMatchObject({ allowPublicKeyRetrieval: true });
    // compose servis adı (tek etiket) özel ağa çözülürse açık; S14-3: genel IP'ye çözülürse kapalı (arama alanı/ndots)
    expect(await connectionOptions(target({ host: "mysql" }), 1000, resolvesTo(["172.18.0.5"]))).toMatchObject({
      allowPublicKeyRetrieval: true,
    });
    expect(await connectionOptions(target({ host: "db" }), 1000, resolvesTo(["93.184.216.34"]))).toMatchObject({
      allowPublicKeyRetrieval: false,
    });
    await expect(connectionOptions(target(), 1000, resolvesTo([]))).rejects.toMatchObject({ code: "ENOTFOUND" });
  });

  it("AC-211: requireTls → ssl.rejectUnauthorized + ad doğrulaması; açık anahtar isteği kapalı", async () => {
    const o = await connectionOptions(target({ requireTls: true, host: "db.lan" }), 1000, resolvesTo(["10.0.0.7"]));
    expect(o).toMatchObject({ host: "10.0.0.7", allowPublicKeyRetrieval: false, ssl: { rejectUnauthorized: true, servername: "db.lan" } });
    const ssl = o.ssl as { checkServerIdentity: (h: string, c: object) => Error | undefined };
    // Sertifika ayar adına göre doğrulanır (bağlanılan IP'ye değil).
    expect(ssl.checkServerIdentity("10.0.0.7", { subject: { CN: "db.lan" }, subjectaltname: "DNS:db.lan" })).toBeUndefined();
    expect(ssl.checkServerIdentity("10.0.0.7", { subject: { CN: "x" }, subjectaltname: "DNS:baska.lan" })).toBeInstanceOf(Error);
    const lit = await connectionOptions(target({ requireTls: true, host: "127.0.0.1" }), 1000);
    expect(lit.ssl).not.toHaveProperty("servername");
  });

  it("AC-211: TLS hataları tls sınıfı (sunucu TLS'siz, sertifika, güvenli taşıma zorunlu); diğerleri bozulmaz", () => {
    expect(classifyMysqlError({ errno: 45023, code: "ER_SERVER_SSL_DISABLED" })).toBe("tls");
    expect(classifyMysqlError({ code: "SELF_SIGNED_CERT_IN_CHAIN" })).toBe("tls");
    expect(classifyMysqlError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })).toBe("tls");
    expect(classifyMysqlError({ errno: 3159 })).toBe("tls");
    expect(classifyMysqlError(new Error("self-signed certificate in certificate chain"))).toBe("tls");
    expect(classifyMysqlError({ errno: 1045 })).toBe("auth");
    expect(classifyMysqlError({ code: "ECONNREFUSED" })).toBe("connect");
  });
});

describe("AC-212: MySQL test hata sınıfı → metrik etiketi", () => {
  it("AC-212: connect|auth|tls|timeout aynen; database ve secret_unreadable → other", () => {
    expect(["connect", "auth", "tls", "timeout", "database", "secret_unreadable"].map((r) => mysqlFailureClass(r as never))).toEqual([
      "connect",
      "auth",
      "tls",
      "timeout",
      "other",
      "other",
    ]);
  });
});

describe("AC-216: panel oturum kovası", () => {
  it("AC-216: 30/dk serbest, 31.'de kilit ve kalan süre saniye cinsinden", () => {
    let t = 0;
    const c = new FixedWindowCounter(31, 60_000, 60_000, { sweepIntervalMs: 0, now: () => t });
    for (let i = 0; i < 30; i++) expect(c.hit("s")).toBe(false);
    expect(c.hit("s")).toBe(true);
    t = 15_000;
    expect(c.blockedFor("s")).toBe(45);
  });
});
