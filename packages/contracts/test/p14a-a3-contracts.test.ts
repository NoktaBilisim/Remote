// P14a A3 sözleşme eklemeleri: AC-211 (MySQL requireTls + tls sınıfı), AC-216 (panel 4429 `retry=`), AC-217 (sabitler).
import { describe, expect, it } from "vitest";
import { MYSQL_TEST_MESSAGES, MYSQL_TEST_REASONS, canonicalWaUrl, mysqlSettingsInputSchema } from "../src/api/system-settings.ts";
import { RETENTION_DEFAULT_DAYS, TENANT_SETTINGS_LIMITS } from "../src/api/tenants.ts";
import { WS_PANEL_UPGRADES_PER_MIN, WS_REQUEST_CLOSE, panelRetryReason, parsePanelRetry } from "../src/ws-request.ts";

describe("P14a A3 sözleşmeleri", () => {
  it("AC-211: requireTls varsayılan false, yalnız boolean; tls sınıfı ve mesajı var", () => {
    const base = { host: "db", database: "remote", user: "app" };
    expect(mysqlSettingsInputSchema.parse(base).requireTls).toBe(false);
    expect(mysqlSettingsInputSchema.parse({ ...base, requireTls: true }).requireTls).toBe(true);
    expect(mysqlSettingsInputSchema.safeParse({ ...base, requireTls: "true" }).success).toBe(false);
    expect(MYSQL_TEST_REASONS).toContain("tls");
    expect(MYSQL_TEST_MESSAGES.tls).toMatch(/TLS/);
  });

  it("AC-216: 4429 gerekçesi retry=<sn> gidiş-dönüş; too_many ve bozuk biçim null; sınır 30/dk", () => {
    expect(WS_REQUEST_CLOSE.TOO_MANY).toBe(4429);
    expect(WS_PANEL_UPGRADES_PER_MIN).toBe(30);
    expect(panelRetryReason(37.2)).toBe("retry=38");
    expect(panelRetryReason(0)).toBe("retry=1");
    expect(parsePanelRetry(panelRetryReason(60))).toBe(60);
    for (const r of ["too_many", "retry=", "retry=0", "retry=-5", "retry=12x", " retry=5"]) expect(parsePanelRetry(r)).toBeNull();
  });

  it("AC-217: RETENTION_DEFAULT_DAYS contracts'ta ve aralıkta; canonicalWaUrl tek kaynak (geçersizde null)", () => {
    const { min, max } = TENANT_SETTINGS_LIMITS.retentionDays;
    expect(RETENTION_DEFAULT_DAYS).toBe(365);
    expect(RETENTION_DEFAULT_DAYS).toBeGreaterThanOrEqual(min);
    expect(RETENTION_DEFAULT_DAYS).toBeLessThanOrEqual(max);
    expect(canonicalWaUrl("HTTPS://WA.Ornek.com:443/")).toBe("https://wa.ornek.com");
    expect(canonicalWaUrl("bozuk adres/")).toBeNull();
  });
});
