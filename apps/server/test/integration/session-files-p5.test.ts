// P5 veri katmanı (dba): session_files (AC-53/54/55 — yalnız meta, içerik yok) ve
// support_sessions.quality_summary (AC-46). Kısıtlar migration.sql'de (CHECK/bileşik FK), yetki grants.sql'de.
// Testler uygulamanın `app` DB kullanıcısıyla (TEST_DATABASE_URL) çalışır.
import { describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";

const HASH = sha256Hex("dosya içeriği");

async function activeSession(status: "ACTIVE" | "PENDING" | "ENDED" = "ACTIVE") {
  const tenant = await createTenant();
  const tech = await createUser({ tenantId: tenant.id });
  const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: tech.id, status });
  return { tenantId: tenant.id, sessionId: s.id };
}

type FileRow = {
  sessionId: string;
  tenantId: string;
  direction?: string;
  fileName?: string;
  sizeBytes?: bigint;
  sha256?: string;
  result?: string;
};
const insertFile = (r: FileRow) =>
  testDb().sessionFile.create({
    data: {
      id: newId(),
      sessionId: r.sessionId,
      tenantId: r.tenantId,
      direction: r.direction ?? "TO_CUSTOMER",
      fileName: r.fileName ?? "rapor.pdf",
      sizeBytes: r.sizeBytes ?? 1024n,
      sha256: r.sha256 ?? HASH,
      result: r.result ?? "OK",
    },
  });

/** Hata mesajında beklenen kısıt adı (CHECK 3819 / FK 1452 / yetki 1142). */
async function rejectsWith(p: Promise<unknown>, needle: string | RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `reddedilmeliydi: ${String(needle)}`).toBeInstanceOf(Error);
  const text = `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
  expect(text).toMatch(needle);
}

describe("P5 session_files", () => {
  it("AC-55: iki yön ve dört sonuç meta olarak yazılır; oturum detayında tenant filtresiyle okunur", async () => {
    const s = await activeSession();
    const rows = [
      { direction: "TO_CUSTOMER", result: "OK", fileName: "Kurulum Kılavuzu çğıöşü İ.pdf" },
      { direction: "TO_TECH", result: "CORRUPT", fileName: "log (1).txt" },
      { direction: "TO_CUSTOMER", result: "REJECTED", fileName: "fatura.pdf.exe" }, // tehlikeli ad: uyarı UI'da, kayıt serbest
      { direction: "TO_TECH", result: "CANCELLED", fileName: "boş", sizeBytes: 0n },
      { direction: "TO_TECH", result: "OK", fileName: "büyük.iso", sizeBytes: 2_147_483_648n }, // tavan 2048 MiB
    ];
    for (const r of rows) await insertFile({ ...s, ...r });
    const detail = await testDb().supportSession.findFirstOrThrow({
      where: { id: s.sessionId, tenantId: s.tenantId },
      select: {
        files: { orderBy: { createdAt: "asc" }, select: { direction: true, fileName: true, sizeBytes: true, sha256: true, result: true } },
      },
    });
    expect(detail.files).toHaveLength(rows.length);
    expect(detail.files.map((f) => f.result)).toEqual(["OK", "CORRUPT", "REJECTED", "CANCELLED", "OK"]);
    expect(detail.files[0]).toMatchObject({ fileName: "Kurulum Kılavuzu çğıöşü İ.pdf", sha256: HASH, sizeBytes: 1024n });
    // İçerik sütunu yok (AC-55): tablo yalnız meta sütunlarını taşır.
    const cols = await testDb().$queryRaw<
      { c: string }[]
    >`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'session_files' ORDER BY ORDINAL_POSITION`;
    expect(cols.map((r) => r.c)).toEqual([
      "id",
      "session_id",
      "tenant_id",
      "direction",
      "file_name",
      "size_bytes",
      "sha256",
      "result",
      "created_at",
    ]);
  });

  it("tenant izolasyonu: başka tenant'ın oturumuna (session_id, tenant_id uyuşmaz) ve var olmayan oturuma kayıt FK ile reddedilir", async () => {
    const a = await activeSession();
    const b = await activeSession();
    await rejectsWith(
      insertFile({ sessionId: a.sessionId, tenantId: b.tenantId }),
      /session_files_session_id_tenant_id_fkey|Foreign key constraint/i,
    );
    await rejectsWith(
      insertFile({ sessionId: newId(), tenantId: a.tenantId }),
      /session_files_session_id_tenant_id_fkey|Foreign key constraint/i,
    );
    await insertFile(a);
    expect(await testDb().sessionFile.count({ where: { sessionId: a.sessionId, tenantId: b.tenantId } })).toBe(0);
    expect(await testDb().sessionFile.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });

  it("CHECK: yön/sonuç enum, sha256 küçük harf hex, boyut 0..2 GiB", async () => {
    const s = await activeSession();
    await rejectsWith(insertFile({ ...s, direction: "BOTH" }), /session_files_direction_chk/);
    await rejectsWith(insertFile({ ...s, result: "DONE" }), /session_files_result_chk/);
    await rejectsWith(insertFile({ ...s, sha256: HASH.toUpperCase() }), /session_files_sha256_fmt_chk/);
    await rejectsWith(insertFile({ ...s, sha256: "a".repeat(63) + "g" }), /session_files_sha256_fmt_chk/);
    await rejectsWith(insertFile({ ...s, sizeBytes: -1n }), /session_files_size_chk/);
    await rejectsWith(insertFile({ ...s, sizeBytes: 2_147_483_649n }), /session_files_size_chk/);
  });

  it("CHECK (G-06): file_name temizlenmiş olmalı — yol, yasak karakter, kontrol/Cf (RTLO), sonda nokta/boşluk, boş ad reddedilir", async () => {
    const s = await activeSession();
    const bad = [
      "",
      "..\\..\\win.ini",
      "a/b.txt",
      "a:b.txt",
      "a*b",
      "a?b",
      'a"b',
      "a<b",
      "a>b",
      "a|b",
      "a\u0000b",
      "a\u001Fb",
      "fatura‮fdp.exe",
      "a​b",
      "a﻿b",
      "rapor.",
      "rapor ",
    ];
    for (const fileName of bad) await rejectsWith(insertFile({ ...s, fileName }), /session_files_file_name_chk/);
    for (const fileName of ["_CON.txt", ".gizli", "a b.c d", "x".repeat(255), "日本語.txt", "emoji 😀.png"])
      await insertFile({ ...s, fileName });
  });

  it("G-15: app kullanıcısı session_files'ta UPDATE/DDL yapamaz; DELETE yalnız P13a retention için (K-P13-2)", async () => {
    const s = await activeSession();
    const f = await insertFile(s);
    await rejectsWith(testDb().$executeRaw`UPDATE session_files SET file_name = 'x.txt' WHERE id = ${f.id}`, /UPDATE command denied|1142/);
    await expect(testDb().$executeRaw`DELETE FROM session_files WHERE id = ${f.id}`).resolves.toBe(1); // P13a: anonimleştirmede satır silinir
    await rejectsWith(testDb().$executeRawUnsafe("ALTER TABLE session_files ADD COLUMN x INT"), /ALTER command denied|1142/);
    await rejectsWith(testDb().$executeRawUnsafe("DROP TABLE session_files"), /DROP command denied|1142/);
  });
});

describe("P5 support_sessions.quality_summary (AC-46)", () => {
  const summary = {
    fps: { avg: 24.6, min: 12, max: 30 },
    kbps: { avg: 2400, min: 800, max: 5200 },
    rttMs: { avg: 42, min: 18, max: 120 },
    connType: "srflx",
  };

  it("ACTIVE/ENDED (tüketilmiş) oturumda JSON nesne yazılır ve aynen okunur; periyodik güncelleme üzerine yazar", async () => {
    const s = await activeSession("ACTIVE");
    await testDb().supportSession.update({
      where: { id: s.sessionId },
      data: { qualitySummary: { ...summary, fps: { avg: 10, min: 5, max: 15 } } },
    });
    await testDb().supportSession.update({ where: { id: s.sessionId }, data: { qualitySummary: summary } });
    expect(
      (await testDb().supportSession.findUniqueOrThrow({ where: { id: s.sessionId }, select: { qualitySummary: true } })).qualitySummary,
    ).toEqual(summary);
    const ended = await activeSession("ENDED");
    await testDb().supportSession.update({ where: { id: ended.sessionId }, data: { qualitySummary: summary } });
    await testDb().supportSession.update({ where: { id: ended.sessionId }, data: { qualitySummary: Prisma.DbNull } });
  });

  it("CHECK: tüketilmemiş (PENDING) oturumda, nesne olmayan JSON'da ve 4 KB üstünde reddedilir", async () => {
    const pending = await activeSession("PENDING");
    await rejectsWith(
      testDb().supportSession.update({ where: { id: pending.sessionId }, data: { qualitySummary: summary } }),
      /support_sessions_quality_summary_chk/,
    );
    const s = await activeSession("ACTIVE");
    await rejectsWith(
      testDb().supportSession.update({ where: { id: s.sessionId }, data: { qualitySummary: [1, 2, 3] } }),
      /support_sessions_quality_summary_chk/,
    );
    await rejectsWith(
      testDb().supportSession.update({ where: { id: s.sessionId }, data: { qualitySummary: "metin" } }),
      /support_sessions_quality_summary_chk/,
    );
    await rejectsWith(
      testDb().supportSession.update({ where: { id: s.sessionId }, data: { qualitySummary: { ...summary, pad: "x".repeat(4100) } } }),
      /support_sessions_quality_summary_chk/,
    );
  });
});
