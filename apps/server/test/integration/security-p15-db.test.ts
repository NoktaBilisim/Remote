// P15 veri katmanı (dba): migration 20261117000000_p15_g3 (mimari-e11 §6; AC-233, 235, 238, 239 + P14 devri e-posta `\z`).
// Testler `app` kullanıcısıyla (TEST_DATABASE_URL). Ön kontrol (SIGNAL P15_PRECHECK) ve down/up döngüsü paylaşılan test
// DB'sinde koşulamaz (DDL); geçici konteynerde elle sınandı → docs/db-notlari.md "P15".
import { describe, expect, it } from "vitest";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";
import { errorText, TERMINATORS } from "../helpers/db-grants.ts";
import { createCustomerRow, createRequestRow, createRequestSettings } from "../helpers/requests.ts";

const db = () => testDb();

const EMAIL_CHECKS = [
  "customers_email_fmt_chk",
  "support_requests_email_fmt_chk",
  "support_sessions_customer_email_chk",
  "tenant_settings_smtp_from_email_chk",
] as const;

async function emailTargets() {
  const tenant = await createTenant();
  const tech = await createUser({ tenantId: tenant.id });
  await createRequestSettings(tenant.id);
  const customer = await createCustomerRow(tenant.id);
  const request = await createRequestRow(tenant.id);
  const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: tech.id, status: "ACTIVE" });
  return {
    tenant,
    tech,
    session: s,
    t: {
      customers_email_fmt_chk: { sql: "UPDATE customers SET email = ? WHERE id = ?", id: customer.id },
      support_requests_email_fmt_chk: { sql: "UPDATE support_requests SET customer_email = ? WHERE id = ?", id: request.id },
      support_sessions_customer_email_chk: {
        sql: "UPDATE support_sessions SET customer_name = 'Ayse Yilmaz', customer_email = ? WHERE id = ?",
        id: s.id,
      },
      tenant_settings_smtp_from_email_chk: {
        sql: "UPDATE tenant_settings SET smtp_host = 'smtp.example.com', smtp_port = 465, smtp_security = 'SSL', smtp_from_email = ? WHERE tenant_id = ?",
        id: tenant.id,
      },
    } satisfies Record<(typeof EMAIL_CHECKS)[number], { sql: string; id: string }>,
  };
}

describe("P15 (P14 devri): 4 e-posta CHECK'i `\\z` ile", () => {
  it("geçerli e-posta kabul; 8 satır sonlandırıcının her biriyle biten değer 3819 + kısıt adıyla reddedilir", async () => {
    const { t } = await emailTargets();
    for (const name of EMAIL_CHECKS) {
      const { sql, id } = t[name];
      await expect(db().$executeRawUnsafe(sql, "destek@example.test", id), name).resolves.toBe(1);
      for (const [label, term] of Object.entries(TERMINATORS)) {
        const text = await errorText(db().$executeRawUnsafe(sql, `destek@example.test${term}`, id));
        expect(text, `${name} ${label}`).toContain(name);
      }
    }
  });

  it("information_schema: 4 CHECK `\\z` ile biter; support_sessions'ta customer_name koşulu korunur", async () => {
    const rows = await db().$queryRawUnsafe<{ n: string; c: string }[]>(
      `SELECT CONSTRAINT_NAME AS n, CHECK_CLAUSE AS c FROM information_schema.CHECK_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN (${EMAIL_CHECKS.map(() => "?").join(",")})`,
      ...EMAIL_CHECKS,
    );
    expect(rows.map((r) => r.n).sort()).toEqual([...EMAIL_CHECKS].sort());
    for (const r of rows) {
      expect(r.c, r.n).toMatch(/\\z/);
      expect(r.c, r.n).not.toMatch(/\$\\?'/);
    }
    expect(rows.find((r) => r.n === "support_sessions_customer_email_chk")?.c).toMatch(/customer_name` is not null/);
  });
});

describe("P15 system_settings_mysql_chk: JSON şeması `$` gerçek son (değişiklik gerekmedi)", () => {
  it("host/database sonundaki her satır sonlandırıcı reddedilir (rollback'li TX; paylaşılan satır değişmez)", async () => {
    const SENTINEL = new Error("rollback");
    for (const field of ["host", "database"] as const) {
      for (const [label, term] of Object.entries(TERMINATORS)) {
        const value = {
          host: "db.internal",
          port: 3306,
          database: "remote",
          user: "rapor",
          [field]: `${field === "host" ? "db.internal" : "remote"}${term}`,
        };
        const err = await db()
          .$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              "INSERT INTO system_settings (`key`, value_json, updated_at) VALUES ('mysql', CAST(? AS JSON), NOW(3)) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)",
              JSON.stringify(value),
            );
            throw SENTINEL;
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err, `${field} ${label}`).not.toBe(SENTINEL);
        expect(String((err as Error).message) + JSON.stringify((err as { meta?: unknown }).meta ?? {}), `${field} ${label}`).toContain(
          "system_settings_mysql_chk",
        );
      }
    }
  });
});

describe("P15 AC-233: sistem logosu kaldırma = {path: null}", () => {
  it("path null kabul (secret_enc NULL); boş nesne ve sır reddedilir; app DELETE yetkisi yok", async () => {
    const SENTINEL = new Error("rollback");
    const upsert =
      "INSERT INTO system_settings (`key`, value_json, secret_enc, updated_at) VALUES ('system_logo', CAST(? AS JSON), ?, NOW(3)) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), secret_enc = VALUES(secret_enc)";
    const attempt = (json: string, secret: Uint8Array | null) =>
      db()
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe(upsert, json, secret);
          throw SENTINEL;
        })
        .then(
          () => null,
          (e: unknown) => e,
        );
    expect(await attempt('{"path":null}', null)).toBe(SENTINEL);
    for (const [json, secret] of [
      ["{}", null],
      ['{"path":null}', new Uint8Array(45)],
      ['{"path":"system/Ab_-0123456789xyz.png\\n"}', null],
    ] as const) {
      const err = await attempt(json, secret);
      expect(err, json).not.toBe(SENTINEL);
      expect(`${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`, json).toContain(
        "system_settings_system_logo_chk",
      );
    }
    expect(await errorText(db().$executeRawUnsafe("DELETE FROM system_settings WHERE `key` = 'system_logo'"))).toMatch(/denied|1142/i);
  });
});

describe("P15 AC-235: request_blocks", () => {
  async function fixture() {
    const tenant = await createTenant();
    const admin = await createUser({ tenantId: tenant.id });
    const ins = (o: {
      kind: string;
      from?: string | null;
      to?: string | null;
      hash?: string | null;
      exp?: Date | null;
      note?: string | null;
    }) =>
      db().$executeRawUnsafe(
        "INSERT INTO request_blocks (id, tenant_id, kind, ip_from, ip_to, device_key_hash, expires_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        newId(),
        tenant.id,
        o.kind,
        o.from == null ? null : Buffer.from(o.from, "hex"),
        o.to == null ? null : Buffer.from(o.to, "hex"),
        o.hash ?? null,
        o.exp ?? null,
        o.note ?? null,
        admin.id,
      );
    return { tenant, admin, ins };
  }

  it("geçerli IPv4 /32, /24, IPv6 /128, /48 ve cihaz engeli eklenir; aynı hedef ikinci kez UQ ile reddedilir; DELETE yapılır", async () => {
    const { tenant, ins } = await fixture();
    await expect(ins({ kind: "IP", from: "cb007107", to: "cb007107" })).resolves.toBe(1);
    await expect(ins({ kind: "IP", from: "cb007100", to: "cb0071ff", exp: new Date(Date.now() + 3600_000), note: "Spam" })).resolves.toBe(
      1,
    );
    const v6 = "20010db8000100000000000000000001";
    await expect(ins({ kind: "IP", from: v6, to: v6 })).resolves.toBe(1);
    await expect(ins({ kind: "IP", from: "20010db8000100000000000000000000", to: "20010db80001ffffffffffffffffffff" })).resolves.toBe(1);
    const hash = sha256Hex(newId());
    await expect(ins({ kind: "DEVICE", hash })).resolves.toBe(1);
    expect(await errorText(ins({ kind: "DEVICE", hash }))).toMatch(/Unique constraint|Duplicate|P2002|1062/i);
    expect(await errorText(ins({ kind: "IP", from: "cb007100", to: "cb0071ff" }))).toMatch(/Unique constraint|Duplicate|P2002|1062/i);
    // Kapı önbelleği yükleme kalıbı (IX(tenant_id, kind, expires_at)).
    const active = await db().requestBlock.findMany({
      where: { tenantId: tenant.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true, kind: true, ipFrom: true, ipTo: true, deviceKeyHash: true },
    });
    expect(active).toHaveLength(5);
    await expect(db().requestBlock.deleteMany({ where: { tenantId: tenant.id, kind: "DEVICE" } })).resolves.toEqual({ count: 1 });
  });

  it("CHECK'ler 3819 + kısıt adıyla reddeder", async () => {
    const { ins } = await fixture();
    const cases: [Parameters<typeof ins>[0], string][] = [
      [{ kind: "ip", from: "cb007100", to: "cb0071ff" }, "request_blocks_kind_chk"],
      [{ kind: "IP", from: "cb007100", to: null }, "request_blocks_target_chk"],
      [{ kind: "IP", from: "cb007100", to: "cb0071ff", hash: sha256Hex("x") }, "request_blocks_target_chk"],
      [{ kind: "DEVICE" }, "request_blocks_target_chk"],
      [{ kind: "IP", from: "cb000000", to: "cb00ffff" }, "request_blocks_ip_range_chk"], // /16
      [{ kind: "IP", from: "cb007101", to: "cb0071ff" }, "request_blocks_ip_range_chk"], // ağ adresi değil
      [{ kind: "IP", from: "cb007100", to: "cb0071f0" }, "request_blocks_ip_range_chk"], // CIDR değil
      [{ kind: "IP", from: "cb0071ff", to: "cb007100" }, "request_blocks_ip_range_chk"], // ters
      [{ kind: "IP", from: "cb0071", to: "cb0071" }, "request_blocks_ip_range_chk"], // 3 bayt
      [{ kind: "IP", from: "cb007100", to: "20010db8000100000000000000000000" }, "request_blocks_ip_range_chk"],
      [{ kind: "IP", from: "20010db8000000000000000000000000", to: "20010db8ffffffffffffffffffffffff" }, "request_blocks_ip_range_chk"], // /32
      [{ kind: "DEVICE", hash: sha256Hex("x").toUpperCase() }, "request_blocks_device_key_hash_fmt_chk"],
      [{ kind: "DEVICE", hash: `${"a".repeat(63)}\n` }, "request_blocks_device_key_hash_fmt_chk"],
      [{ kind: "DEVICE", hash: sha256Hex("y"), exp: new Date(Date.now() - 60_000) }, "request_blocks_expires_chk"],
      [{ kind: "DEVICE", hash: sha256Hex("z"), note: " Spam" }, "request_blocks_note_chk"],
      [{ kind: "DEVICE", hash: sha256Hex("w"), note: "a‮b" }, "request_blocks_note_chk"],
    ];
    for (const [o, name] of cases) {
      expect(await errorText(ins(o)), `${name} ${JSON.stringify(o)}`).toContain(name);
    }
  });

  it("app UPDATE yetkisi yok", async () => {
    expect(await errorText(db().$executeRawUnsafe("UPDATE request_blocks SET expires_at = NULL WHERE id = ''"))).toMatch(/denied|1142/i);
  });
});

describe("P15 AC-238/239: session_files.reported_by + match_key, tenant_request_settings.require_accept_code", () => {
  it("reported_by varsayılan TECH; CUSTOMER kabul; küçük harf/ham değer, hatalı match_key ve aynı taraf tekrar reddedilir", async () => {
    const tenant = await createTenant();
    const tech = await createUser({ tenantId: tenant.id });
    const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: tech.id, status: "ACTIVE" });
    const base = {
      sessionId: s.id,
      tenantId: tenant.id,
      direction: "TO_CUSTOMER",
      fileName: "rapor.pdf",
      sizeBytes: 1024n,
      sha256: sha256Hex("f"),
      result: "OK",
    };
    const legacy = await db().sessionFile.create({ data: { id: newId(), ...base } });
    expect(legacy.reportedBy).toBe("TECH");
    expect(legacy.matchKey).toBeNull();
    const key = sha256Hex(`${s.id}\nTO_CUSTOMER\nfid1`);
    await db().sessionFile.create({ data: { id: newId(), ...base, reportedBy: "TECH", matchKey: key } });
    await db().sessionFile.create({ data: { id: newId(), ...base, reportedBy: "CUSTOMER", matchKey: key } });
    expect(await errorText(db().sessionFile.create({ data: { id: newId(), ...base, reportedBy: "CUSTOMER", matchKey: key } }))).toMatch(
      /Unique constraint|P2002|Duplicate/i,
    );
    expect(await errorText(db().sessionFile.create({ data: { id: newId(), ...base, reportedBy: "customer" } }))).toContain(
      "session_files_reported_by_chk",
    );
    expect(await errorText(db().sessionFile.create({ data: { id: newId(), ...base, matchKey: key.toUpperCase() } }))).toContain(
      "session_files_match_key_fmt_chk",
    );
    // Eşleşme sorgusu: aynı match_key'de iki taraf.
    const pairs = await db().sessionFile.groupBy({
      by: ["matchKey"],
      where: { sessionId: s.id, matchKey: { not: null } },
      _count: { _all: true },
    });
    expect(pairs).toEqual([{ matchKey: key, _count: { _all: 2 } }]);
  });

  it("require_accept_code varsayılan false; app güncelleyebilir", async () => {
    const tenant = await createTenant();
    await createRequestSettings(tenant.id);
    const row = await db().tenantRequestSettings.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(row.requireAcceptCode).toBe(false);
    await db().tenantRequestSettings.update({ where: { tenantId: tenant.id }, data: { requireAcceptCode: true } });
    expect((await db().tenantRequestSettings.findUniqueOrThrow({ where: { tenantId: tenant.id } })).requireAcceptCode).toBe(true);
  });
});
