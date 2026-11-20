// P31-D (dba) — support_requests.client_os DB düzeyi kurallar (mimari-p31 §5, §15 S-P31-7, K-P31-4; AC-511 "migration testi").
// Uygulama kodu yok: app bağlantısı (testDb) yetki/CHECK'e tabi; migrator (testFixtureDb) information_schema için.
import { afterAll, describe, expect, it } from "vitest";
import { anonymizeBatch } from "../../src/requests/repo.ts";
import { createTenant, testDb, testFixtureDb } from "../helpers/app.ts";
import { createRequestRow } from "../helpers/requests.ts";

afterAll(async () => {
  await testDb().$disconnect();
  await testFixtureDb().$disconnect();
});

const osOf = async (id: string) =>
  (await testDb().supportRequest.findUniqueOrThrow({ where: { id }, select: { clientOs: true } })).clientOs;

describe("P31-D support_requests.client_os (AC-511, K-P31-4)", () => {
  it("AGENT: windows / macos / NULL (varsayılan NULL = windows; eski satırlar böyle)", async () => {
    const t = await createTenant();
    expect(await osOf((await createRequestRow(t.id)).id)).toBeNull();
    expect(await osOf((await createRequestRow(t.id, { clientOs: "macos" })).id)).toBe("macos");
    expect(await osOf((await createRequestRow(t.id, { clientOs: "windows" })).id)).toBe("windows");
  });

  it("client_os_chk: ikili enum — linux, büyük harf, sonda boşluk/satır sonu, boş, Türkçe İ 3819 (S-P31-7)", async () => {
    const t = await createTenant();
    for (const bad of ["linux", "MACOS", "Macos", "macos ", "macos\n", "", "WİNDOWS", "darwin"]) {
      await expect(createRequestRow(t.id, { clientOs: bad }), JSON.stringify(bad)).rejects.toThrow(/client_os_chk/);
    }
    const r = await createRequestRow(t.id);
    await expect(testDb().$executeRaw`UPDATE support_requests SET client_os = ${"MacOS"} WHERE id = ${r.id}`).rejects.toThrow(
      /client_os_chk/,
    );
  });

  it("source_client_os_chk: WEB talebinde client_os NULL; WEB + macos/windows 3819", async () => {
    const t = await createTenant();
    const web = await createRequestRow(t.id, { source: "WEB" });
    expect(await osOf(web.id)).toBeNull();
    for (const os of ["macos", "windows"]) {
      await expect(createRequestRow(t.id, { source: "WEB", clientOs: os })).rejects.toThrow(/source_client_os_chk/);
      await expect(testDb().supportRequest.update({ where: { id: web.id }, data: { clientOs: os } })).rejects.toThrow(
        /source_client_os_chk/,
      );
    }
    // AGENT + macos satırı WEB'e çevrilemez (source_version_chk'den önce/aynı anda client_os kuralı da tutar).
    const agent = await createRequestRow(t.id, { clientOs: "macos" });
    await expect(testDb().supportRequest.update({ where: { id: agent.id }, data: { source: "WEB", clientVersion: null } })).rejects.toThrow(
      /source_client_os_chk/,
    );
  });

  it("anonimleştirme client_os'u korur (kişisel veri değil, §5)", async () => {
    const t = await createTenant();
    const old = new Date(Date.now() - 400 * 86_400_000);
    const r = await createRequestRow(t.id, { createdAt: old, waitMinutes: 10, clientOs: "macos" });
    await testDb().supportRequest.update({ where: { id: r.id }, data: { status: "EXPIRED", closedAt: old } });
    const n = await anonymizeBatch(testDb(), t.id, new Date(Date.now() - 365 * 86_400_000), 1000);
    expect(n.requests).toBe(1);
    const row = await testDb().supportRequest.findUniqueOrThrow({
      where: { id: r.id },
      select: { anonymizedAt: true, customerName: true, clientOs: true },
    });
    expect(row.anonymizedAt).not.toBeNull();
    expect(row.customerName).toBeNull();
    expect(row.clientOs).toBe("macos");
  });

  it("information_schema: VARCHAR(10) NULL, indeks yok, iki CHECK ve ikili karşılaştırma", async () => {
    const db = testFixtureDb();
    const cols = await db.$queryRaw<{ t: string; n: string }[]>`
      SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_requests' AND COLUMN_NAME = 'client_os'`;
    expect(cols).toEqual([{ t: "varchar(10)", n: "YES" }]);
    const idx = await db.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_requests' AND COLUMN_NAME = 'client_os'`;
    expect(Number(idx[0]?.c)).toBe(0);
    const checks = await db.$queryRaw<{ n: string; c: string }[]>`
      SELECT CONSTRAINT_NAME AS n, CHECK_CLAUSE AS c FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'support_requests%client_os%' ORDER BY CONSTRAINT_NAME`;
    expect(checks.map((r) => r.n)).toEqual(["support_requests_client_os_chk", "support_requests_source_client_os_chk"]);
    expect(checks[0]?.c).toMatch(/charset binary/);
  });
});
