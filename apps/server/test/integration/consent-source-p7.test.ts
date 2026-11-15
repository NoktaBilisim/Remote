// P7 veri katmanı (dba, ADR-0013): session_consents_source_chk kümesine `TECH` eklendi
// (teknisyen bırakması/iptali → CONTROL/REVOKED/TECH). Kısıt migration 20261111050000_p7_consent_source_tech'te.
// Testler uygulamanın `app` DB kullanıcısıyla (TEST_DATABASE_URL) çalışır.
import { describe, expect, it } from "vitest";
import { newId } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";

async function activeSession() {
  const tenant = await createTenant();
  const tech = await createUser({ tenantId: tenant.id });
  const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: tech.id, status: "ACTIVE" });
  return { tenantId: tenant.id, sessionId: s.id };
}

const insertConsent = (s: { tenantId: string; sessionId: string }, source: string, level = "CONTROL", decision = "REVOKED") =>
  testDb().sessionConsent.create({ data: { id: newId(), sessionId: s.sessionId, tenantId: s.tenantId, level, decision, source } });

describe("P7 session_consents.source", () => {
  it("TECH kabul edilir; P4 kaynakları geçerliliğini korur ve zaman çizelgesinde okunur", async () => {
    const s = await activeSession();
    await insertConsent(s, "UI", "CONTROL", "GRANTED");
    await insertConsent(s, "TECH"); // control.release
    for (const src of ["HOTKEY", "RECONNECT", "SYSTEM"]) await insertConsent(s, src);
    const rows = await testDb().sessionConsent.findMany({
      where: { sessionId: s.sessionId, tenantId: s.tenantId },
      orderBy: { createdAt: "asc" }, // IX(session_id, tenant_id, created_at); aynı ms'de sıra garanti değil
      select: { level: true, decision: true, source: true },
    });
    expect(rows.map((r) => r.source).sort()).toEqual(["HOTKEY", "RECONNECT", "SYSTEM", "TECH", "UI"]);
    expect(rows).toContainEqual({ level: "CONTROL", decision: "REVOKED", source: "TECH" });
  });

  // Not: sütun utf8mb4_unicode_ci → IN karşılaştırması harf duyarsız ('tech' geçer; P4'teki tüm enum CHECK'leri
  // gibi). Büyük harf yazımı uygulamadaki sabitlerle (contracts) garanti edilir — db-notlari P7.
  it("küme dışı kaynak CHECK ile reddedilir", async () => {
    const s = await activeSession();
    for (const bad of ["TECHNICIAN", "DENIED", "ADMIN", ""]) {
      const err = await insertConsent(s, bad).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, `reddedilmeliydi: ${bad}`).toBeInstanceOf(Error);
      expect(`${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`).toMatch(/session_consents_source_chk/);
    }
  });
});
