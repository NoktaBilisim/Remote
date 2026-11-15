// P11 birim testleri: audit okuma süzgeci (G-15, B-P10 koşulu), filtre/imleç, CSV kaçışı, MySQL yoklama sınıflandırma ve
// kesin zaman aşımı, sözleşme şemaları (DB CHECK kurallarıyla birebir).
import { AUDIT_EXPORT_MAX_ROWS, listAuditQuerySchema } from "@remote/contracts/api/audit";
import { consentTextInputSchema, mysqlSettingsInputSchema, turnSettingsInputSchema } from "@remote/contracts/api/system-settings";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, resolveAuditFilter } from "../../src/audit/read.ts";
import { auditValueView, isOutboundAction } from "../../src/audit/view.ts";
import { csvRow } from "../../src/lib/csv.ts";
import { AppError } from "../../src/lib/errors.ts";
import { classifyMysqlError, probeMysql, type MariadbDriver, type TextConnection } from "../../src/settings/mysql-probe.ts";
import { mysqlFromUrl } from "../../src/settings/system.ts";

describe("P11 audit okuma görünümü", () => {
  it("AC-76/AC-75: okumada maske yeniden uygulanır (savunma derinliği)", () => {
    expect(auditValueView("user.updated", { password: "düz", nested: { apiKey: "k", name: "Ali" }, permKey: "audit.view" })).toEqual({
      password: "***",
      nested: { apiKey: "***", name: "Ali" },
      permKey: "audit.view",
    });
    expect(auditValueView("user.updated", null)).toBeNull();
  });

  it("AC-76 (B-P10 koşulu): mail.* / settings.*.test / SMTP kayıtlarında yalnız izinli alan + reason sınıfı", () => {
    for (const a of [
      "mail.sent",
      "settings.smtp.test",
      "settings.email.test",
      "settings.whatsapp.test",
      "settings.mysql.test",
      "session.email",
      "tenant.smtp_changed",
    ])
      expect(isOutboundAction(a), a).toBe(true);
    for (const a of ["auth.login", "settings.mysql.updated", "session.created"]) expect(isOutboundAction(a), a).toBe(false);
    const raw = {
      kind: "smtp_test",
      recipient: "a***@x.test",
      reason: "554 5.7.1 Relay denied by mx.example banner",
      responseCode: 554,
      response: "220 mx.example ESMTP",
      error: "Connection refused",
      result: "fail",
      detail: { msg: "x" },
    };
    expect(auditValueView("mail.sent", raw)).toEqual({ kind: "smtp_test", recipient: "a***@x.test", reason: "other", result: "fail" });
    expect(auditValueView("settings.smtp.test", { recipient: "a***@x.test", result: "fail", reason: "auth" })).toEqual({
      recipient: "a***@x.test",
      result: "fail",
      reason: "auth",
    });
    expect(auditValueView("mail.sent", ["dizi"])).toBeNull();
  });

  it("AC-76: imleç gidiş-dönüş; biçim dışı imleç 400", () => {
    const c = { createdAt: new Date("2026-11-12T10:00:00.123Z"), id: 123456789012345n };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(() => decodeCursor("bm90LWEtY3Vyc29y")).toThrow(AppError);
  });

  it("AC-76 (B-P11-5): imleç id'si BIGINT aralığında — sınır geçer, aşan 400 VALIDATION", () => {
    const max = { createdAt: new Date(1), id: 9_223_372_036_854_775_807n };
    expect(decodeCursor(encodeCursor(max))).toEqual(max);
    for (const id of ["9223372036854775808", "9999999999999999999"]) {
      const err = (() => {
        try {
          decodeCursor(Buffer.from(`1.${id}`).toString("base64url"));
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(err, id).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VALIDATION");
    }
  });

  it("AC-76: varsayılan son 30 gün; > 731 gün 400; tenant kapsamında tenantId yok sayılır; önek filtresi", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const tid = "01J00000000000000000000000";
    const f = resolveAuditFilter(
      { kind: "tenant", tenantId: "01K00000000000000000000000" },
      listAuditQuerySchema.parse({ tenantId: tid, action: "auth.*" }),
      now,
    );
    expect(f.to).toEqual(now);
    expect(now.getTime() - f.from.getTime()).toBe(30 * 86_400_000);
    expect(f.tenantId).toBeUndefined();
    expect(f.action).toEqual({ value: "auth.", prefix: true });
    expect(resolveAuditFilter({ kind: "all" }, listAuditQuerySchema.parse({ tenantId: tid, action: "auth.login" }), now)).toMatchObject({
      tenantId: tid,
      action: { value: "auth.login", prefix: false },
    });
    expect(() => resolveAuditFilter({ kind: "all" }, listAuditQuerySchema.parse({ from: "2024-01-01", to: "2026-01-01" }), now)).toThrow(
      AppError,
    );
    // 731 gün (dahil) geçer
    expect(() =>
      resolveAuditFilter({ kind: "all" }, listAuditQuerySchema.parse({ from: "2024-01-01", to: "2025-12-31" }), now),
    ).not.toThrow();
  });

  it("AC-76: sorgu şeması — geçersiz işlem/sonuç/tarih, ters aralık, bilinmeyen alan reddedilir", () => {
    for (const q of [
      { action: "AUTH.*" },
      { action: "auth*" },
      { action: "auth.%" },
      { result: "ok" },
      { from: "2026-02-30" },
      { from: "2026-02-02", to: "2026-02-01" },
      { page: "2" },
      { cursor: "a b" },
    ]) {
      expect(listAuditQuerySchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
    expect(listAuditQuerySchema.parse({ action: "", result: "" })).toEqual({});
    expect(AUDIT_EXPORT_MAX_ROWS).toBe(50_000);
  });

  it("AC-124: audit CSV hücreleri formül kaçışlı (=, +, -, @, TAB, CR) ve RFC 4180 tırnaklı", () => {
    expect(csvRow(['=HYPERLINK("x")', "+1", "-2", "@SUM(A1)", "\tx", "\rx", '{"a":1}'])).toBe(
      `"'=HYPERLINK(""x"")";'+1;'-2;'@SUM(A1);'\tx;"'\rx";"{""a"":1}"\r\n`,
    );
  });
});

describe("P11 MySQL bağlantı testi", () => {
  it("AC-77: hata sınıflandırma (ham metin dönmez)", () => {
    expect(classifyMysqlError({ errno: 1045 })).toBe("auth");
    expect(classifyMysqlError({ errno: 1049 })).toBe("database");
    expect(classifyMysqlError({ errno: 1044 })).toBe("database");
    expect(classifyMysqlError({ errno: 45012, code: "ER_CONNECTION_TIMEOUT" })).toBe("timeout");
    expect(classifyMysqlError({ code: "ECONNREFUSED" })).toBe("connect");
    expect(classifyMysqlError(new Error("getaddrinfo ENOTFOUND"))).toBe("connect");
  });

  it("AC-77: kesin zaman aşımı — sürücü hiç yanıt vermese de süre dolunca timeout; geç gelen bağlantı kapatılır", async () => {
    let destroyed = false;
    let resolveConn: (c: TextConnection) => void = () => undefined;
    const drv: MariadbDriver = { createConnection: () => new Promise<TextConnection>((r) => (resolveConn = r)) };
    const out = await probeMysql(
      { host: "db.test", port: 3306, database: "d", user: "u", password: "p", requireTls: false },
      50,
      drv,
      async () => ["10.0.0.5"],
    );
    expect(out).toMatchObject({ ok: false, reason: "timeout" });
    expect(out.latencyMs).toBeLessThan(1000);
    resolveConn({ query: async () => [], end: async () => undefined, destroy: () => (destroyed = true) });
    await new Promise((r) => setTimeout(r, 10));
    expect(destroyed).toBe(true);
  });

  it("AC-77: başarılı yoklama SELECT 1 çalıştırır ve bağlantıyı kapatır; IPv6 köşeli parantezsiz verilir", async () => {
    const calls: string[] = [];
    const drv: MariadbDriver = {
      createConnection: async (o) => {
        calls.push(`host=${String(o.host)}`);
        return { query: async (sql) => void calls.push(sql), end: async () => void calls.push("end"), destroy: () => undefined };
      },
    };
    const out = await probeMysql({ host: "[::1]", port: 3306, database: "d", user: "u", password: "p", requireTls: false }, 1000, drv);
    expect(out.ok).toBe(true);
    expect(calls).toEqual(["host=::1", "SELECT 1", "end"]);
  });

  it("AC-77: DATABASE_URL'den görünüm türetme (şifre ayrı)", () => {
    expect(mysqlFromUrl("mysql://app:s%40fre@db:3307/remote?x=1")).toEqual({
      host: "db",
      port: 3307,
      database: "remote",
      user: "app",
      password: "s@fre",
    });
    expect(mysqlFromUrl("mysql://app@db/remote").port).toBe(3306);
  });
});

describe("P11 sözleşme şemaları (DB CHECK ile birebir)", () => {
  it("AC-77/AC-78: mysql — port varsayılan 3306, tamsayı; database/user/host kuralları; boş şifre = korunur", () => {
    expect(mysqlSettingsInputSchema.parse({ host: "DB.Example.com", database: "remote", user: "rapor", password: "" })).toEqual({
      host: "db.example.com",
      port: 3306,
      database: "remote",
      user: "rapor",
      requireTls: false,
    });
    for (const bad of [
      { host: "db", port: "3306", database: "r", user: "u" },
      { host: "db", port: 0, database: "r", user: "u" },
      { host: "db", port: 70000, database: "r", user: "u" },
      { host: "db/x", database: "r", user: "u" },
      { host: "db", database: "a b", user: "u" },
      { host: "db", database: "x".repeat(65), user: "u" },
      { host: "db", database: "r", user: "x".repeat(33) },
      { host: "db", database: "r", user: "a\u202Eb" },
      { host: "db", database: "r", user: "u", extra: 1 },
    ])
      expect(mysqlSettingsInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("AC-78: turn — şema, tekil, ≤ 10, en az 1, secret 32..256 ASCII", () => {
    expect(turnSettingsInputSchema.parse({ urls: ["stun:s.test:3478", "turns:t.test:5349"], secret: "" })).toEqual({
      urls: ["stun:s.test:3478", "turns:t.test:5349"],
    });
    for (const bad of [
      { urls: [] },
      { urls: ["http://x.test"] },
      { urls: ["turn:a b"] },
      { urls: ["turn:a.test", "turn:a.test"] },
      { urls: Array.from({ length: 11 }, (_, i) => `stun:s${i}.test`) },
      { urls: ["turn:a.test"], secret: "kısa" },
      { urls: ["turn:a.test"], secret: "ş".repeat(40) },
      { urls: ["turn:a.test"], secret: `${"a".repeat(32)}#yorum` },
      { urls: ["turn:a.test"], secret: `${"a".repeat(32)} b` },
    ])
      expect(turnSettingsInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("AC-29: aydınlatma metni — CRLF → LF, kırpma, 50..20000, kontrol/bidi karakteri reddi", () => {
    const body = `${"a".repeat(30)}\r\n${"b".repeat(30)}  `;
    expect(consentTextInputSchema.parse({ body }).body).toBe(`${"a".repeat(30)}\n${"b".repeat(30)}`);
    expect(consentTextInputSchema.safeParse({ body: "a".repeat(49) }).success).toBe(false);
    expect(consentTextInputSchema.safeParse({ body: "a".repeat(20_001) }).success).toBe(false);
    expect(consentTextInputSchema.safeParse({ body: `${"a".repeat(60)}\u202E` }).success).toBe(false);
    expect(consentTextInputSchema.safeParse({ body: `${"a".repeat(60)}\u0007` }).success).toBe(false);
    expect(consentTextInputSchema.safeParse({ body: `${"ç".repeat(60)}\n\tx` }).success).toBe(true);
  });
});
