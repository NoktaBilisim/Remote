// P14a A1 veri katmanı (dba): migration 20261116000000_p14a_security (mimari-e11 §4.1; AC-201, AC-206, AC-215).
// 6 biçim CHECK'i `$` → `\z`; users.version, auth_sessions.step_up_at. Testler `app` kullanıcısıyla (TEST_DATABASE_URL).
// Ön kontrol (SIGNAL P14A_PRECHECK) ve down/up döngüsü paylaşılan test DB'sinde koşulamaz (DDL); geçici konteynerde elle
// sınandı → docs/db-notlari.md "P14a".
import { describe, expect, it } from "vitest";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";
import { createCustomerRow, createRequestRow, createRequestSettings } from "../helpers/requests.ts";

const db = () => testDb();

async function errorText(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "reddedilmeliydi").toBeInstanceOf(Error);
  return `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
}

// ICU `$` girdinin sonundaki TEK satır sonlandırıcıdan önce de eşleşiyordu (8.4.13'te denendi); `\z` hepsini reddeder.
const TERMINATORS = { LF: "\n", CR: "\r", CRLF: "\r\n", VT: "\v", FF: "\f", NEL: "\u0085", LS: " ", PS: " " };

const CHECKS = [
  "customers_file_label_chk",
  "customers_phone_fmt_chk",
  "support_requests_phone_fmt_chk",
  "support_requests_client_version_fmt_chk",
  "device_bindings_client_version_fmt_chk",
  "tenant_request_settings_file_label_chk",
] as const;

/** Her CHECK için: geçerli değer + sondaki sonlandırıcıyla aynı değer (ham SQL; Prisma'nın tip katmanı aradan çıkar). */
async function targets() {
  const tenant = await createTenant();
  const tech = await createUser({ tenantId: tenant.id });
  await createRequestSettings(tenant.id);
  const customer = await createCustomerRow(tenant.id, { phone: "+905301112233" });
  const request = await createRequestRow(tenant.id);
  const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: tech.id, status: "ACTIVE" });
  const binding = await db().deviceBinding.create({
    data: {
      id: newId(),
      tenantId: tenant.id,
      keyHash: sha256Hex(newId()),
      clientVersion: "0.10.0",
      firstSessionId: s.id,
      lastSessionId: s.id,
      lastUsedAt: new Date(),
    },
  });
  return {
    customers_file_label_chk: { sql: "UPDATE customers SET file_label = ? WHERE id = ?", id: customer.id, ok: "Musteri01" },
    customers_phone_fmt_chk: { sql: "UPDATE customers SET phone = ? WHERE id = ?", id: customer.id, ok: "+905301112233" },
    support_requests_phone_fmt_chk: {
      sql: "UPDATE support_requests SET customer_phone = ? WHERE id = ?",
      id: request.id,
      ok: "+905321234567",
    },
    support_requests_client_version_fmt_chk: {
      sql: "UPDATE support_requests SET client_version = ? WHERE id = ?",
      id: request.id,
      ok: "0.9.0",
    },
    device_bindings_client_version_fmt_chk: {
      sql: "UPDATE device_bindings SET client_version = ? WHERE id = ?",
      id: binding.id,
      ok: "0.10.1",
    },
    tenant_request_settings_file_label_chk: {
      sql: "UPDATE tenant_request_settings SET file_label = ? WHERE tenant_id = ?",
      id: tenant.id,
      ok: "TestFirma",
    },
  } satisfies Record<(typeof CHECKS)[number], { sql: string; id: string; ok: string }>;
}

describe("P14a AC-201: 6 biçim CHECK'i `\\z` ile (sondaki satır sonlandırıcı reddedilir)", () => {
  it("AC-201: sonu `\\n` olan değer 6 CHECK'te de 3819 ile reddedilir; geçerli değer kabul", async () => {
    const t = await targets();
    for (const name of CHECKS) {
      const { sql, id, ok } = t[name];
      await expect(db().$executeRawUnsafe(sql, ok, id), name).resolves.toBe(1);
      const text = await errorText(db().$executeRawUnsafe(sql, `${ok}\n`, id));
      expect(text, name).toMatch(new RegExp(`3819|Check constraint '${name}' is violated`));
      expect(text, name).toContain(name);
    }
  });

  it("AC-201: CR, CRLF, VT, FF, NEL, U+2028, U+2029 sonlu değerler de reddedilir (ICU `$` açığı kapalı)", async () => {
    const t = await targets();
    for (const name of CHECKS) {
      const { sql, id, ok } = t[name];
      for (const [label, term] of Object.entries(TERMINATORS)) {
        // Sütun genişliği aşılırsa 1406 (Data too long) döner — o da ret; kısıt adını yalnız sığan değerde bekleriz.
        const text = await errorText(db().$executeRawUnsafe(sql, `${ok}${term}`, id));
        expect(text, `${name} ${label}`).toMatch(new RegExp(`${name}|Data too long`));
      }
    }
  });

  it("AC-201: information_schema'da 6 CHECK `\\z` ile biter, hiçbiri `$` ile bitmez", async () => {
    const rows = await db().$queryRawUnsafe<{ n: string; c: string }[]>(
      `SELECT CONSTRAINT_NAME AS n, CHECK_CLAUSE AS c FROM information_schema.CHECK_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN (${CHECKS.map(() => "?").join(",")})`,
      ...CHECKS,
    );
    expect(rows.map((r) => r.n).sort()).toEqual([...CHECKS].sort());
    for (const r of rows) {
      expect(r.c, r.n).toMatch(/\\z/);
      expect(r.c, r.n).not.toMatch(/\$\\?'/);
    }
  });
});

describe("P14a yeni sütunlar (AC-206 users.version, AC-215 auth_sessions.step_up_at)", () => {
  it("users.version: yeni kullanıcı 0, artırılabilir, negatif değer reddedilir (UNSIGNED)", async () => {
    const tenant = await createTenant();
    const u = await createUser({ tenantId: tenant.id });
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id }, select: { version: true } })).version).toBe(0);
    // ADR-0023 koşullu UPDATE kalıbı: eşleşen version 1 satır, eskimiş version 0 satır.
    const bump = (v: number) => db().$executeRawUnsafe("UPDATE users SET version = version + 1 WHERE id = ? AND version = ?", u.id, v);
    await expect(bump(0)).resolves.toBe(1);
    await expect(bump(0)).resolves.toBe(0);
    expect(await errorText(db().$executeRawUnsafe("UPDATE users SET version = -1 WHERE id = ?", u.id))).toMatch(/out of range|1264/i);
  });

  it("auth_sessions.step_up_at: NULL varsayılan, app yazabilir", async () => {
    const cols = await db().$queryRawUnsafe<{ t: string; n: string; d: string | null }[]>(
      `SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_sessions' AND COLUMN_NAME = 'step_up_at'`,
    );
    expect(cols).toEqual([{ t: "datetime(3)", n: "YES", d: null }]);
    await expect(db().$executeRawUnsafe("UPDATE auth_sessions SET step_up_at = UTC_TIMESTAMP(3) WHERE id = ''")).resolves.toBe(0);
  });
});
