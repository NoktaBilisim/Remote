// P8 veri katmanı (dba): support_sessions oturum geçmişi alanları (customer_name/email, ticket_no, note — AC-62/63),
// liste indeksi (AC-60) ve performans seed betiği (scripts/perf-sessions.ts; yalnız dev/test).
// Kısıtlar migration.sql'de (CHECK), testler uygulamanın `app` DB kullanıcısıyla (TEST_DATABASE_URL) çalışır.
import { describe, expect, it } from "vitest";
import { listPage, seedPerfSessions } from "../../scripts/perf-sessions.ts";
import { newId } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";
import { rejectsWith } from "../helpers/db-grants.ts";

async function session(status: "ACTIVE" | "PENDING" | "ENDED" = "ENDED") {
  const tenant = await createTenant();
  const tech = await createUser({ tenantId: tenant.id });
  const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: tech.id, status });
  return { tenantId: tenant.id, id: s.id };
}

type P8 = { customerName?: string | null; customerEmail?: string | null; ticketNo?: string | null; note?: string | null };
const patch = (s: { id: string; tenantId: string }, data: P8) =>
  testDb().supportSession.updateMany({ where: { id: s.id, tenantId: s.tenantId }, data });

describe("P8 support_sessions geçmiş alanları", () => {
  it("AC-62/63: müşteri adı/e-posta, ticket no ve not yazılır/okunur; Türkçe çok baytlı sınır değerler kabul", async () => {
    const s = await session("ENDED");
    const name = "Çağrı Şükrü Öztürk İğdeli".padEnd(100, "ğ"); // 100 karakter, çok baytlı
    const note = `${"ç".repeat(3990)}\nSatır 2\t.`; // 4000 karakter, satır sonu/sekme serbest
    expect(note.length).toBe(4000);
    await patch(s, { customerName: name, customerEmail: "ayse@example.test", ticketNo: "INC-ÇĞ-".padEnd(50, "9"), note });
    const row = await testDb().supportSession.findFirstOrThrow({
      where: { id: s.id, tenantId: s.tenantId },
      select: { customerName: true, customerEmail: true, ticketNo: true, note: true },
    });
    expect(row).toEqual({ customerName: name, customerEmail: "ayse@example.test", ticketNo: "INC-ÇĞ-".padEnd(50, "9"), note });
    // Temizleme = NULL (boş metin saklanmaz).
    await patch(s, { ticketNo: null, note: null });
    expect(await testDb().supportSession.count({ where: { id: s.id, ticketNo: null, note: null } })).toBe(1);
    // PENDING oturuma ticket/not yazılabilir (kısıt yalnız müşteri bilgisinde).
    const p = await session("PENDING");
    await patch(p, { ticketNo: "INC-1", note: "bekleyen" });
  });

  it("CHECK: uzunluk, kırpılmamış/boş değer, kontrol ve bidi karakterleri reddedilir", async () => {
    const s = await session("ENDED");
    await rejectsWith(patch(s, { note: "n".repeat(4001) }), /support_sessions_note_chk/);
    await rejectsWith(patch(s, { note: "" }), /support_sessions_note_chk/);
    await rejectsWith(patch(s, { ticketNo: "" }), /support_sessions_ticket_no_chk/);
    await rejectsWith(patch(s, { ticketNo: " INC-1" }), /support_sessions_ticket_no_chk/);
    await rejectsWith(patch(s, { ticketNo: "INC-1 " }), /support_sessions_ticket_no_chk/);
    await rejectsWith(patch(s, { ticketNo: "INC\n1" }), /support_sessions_ticket_no_chk/);
    await rejectsWith(patch(s, { ticketNo: "INC\u202E1" }), /support_sessions_ticket_no_chk/);
    await rejectsWith(patch(s, { ticketNo: "INC\u20281" }), /support_sessions_ticket_no_chk/); // Zl (mimari-api §4)
    for (const bad of ["satır\r\nsonu", "a\u0000b", "a\u0085b", "a\u202Eb", "a\u200Bb"]) {
      await rejectsWith(patch(s, { note: bad }), /support_sessions_note_chk/); // yalnız \n ve \t serbest
    }
    await rejectsWith(patch(s, { ticketNo: "x".repeat(51) }), /too long|1406|ticket_no/i); // VARCHAR(50) strict mod
    for (const bad of ["A", "Ayşe ", " Ayşe", "Ali\tVeli", "Ali\u202Efdp.exe", "Ali\u200BVeli", "Ali\u0000"]) {
      await rejectsWith(patch(s, { customerName: bad }), /support_sessions_customer_name_chk/);
    }
    await rejectsWith(patch(s, { customerName: "Ayşe Yılmaz", customerEmail: "gecersiz" }), /support_sessions_customer_email_chk/);
    await rejectsWith(patch(s, { customerName: "Ayşe Yılmaz", customerEmail: "a b@example.test" }), /support_sessions_customer_email_chk/);
    await rejectsWith(patch(s, { customerName: null, customerEmail: "ayse@example.test" }), /support_sessions_customer_email_chk/);
  });

  it("müşteri bilgisi yalnız admit edilmiş (consumed_at dolu) oturumda; admit UPDATE'i ile birlikte yazılabilir", async () => {
    const p = await session("PENDING");
    await rejectsWith(patch(p, { customerName: "Ayşe Yılmaz" }), /support_sessions_customer_consumed_chk/);
    // A1 admit: tek atomik koşullu UPDATE müşteri adını da yazar (backend P8).
    const now = new Date();
    const r = await testDb().supportSession.updateMany({
      where: { id: p.id, tenantId: p.tenantId, status: "PENDING", expiresAt: { gt: now } },
      data: {
        status: "ACTIVE",
        activeCode: null,
        consumedAt: now,
        mode: "BROWSER",
        customerName: "Ayşe Yılmaz",
        customerEmail: "ayse@example.test",
      },
    });
    expect(r.count).toBe(1);
  });

  it("şema: yeni sütunlar ve P8 indeksleri var", async () => {
    const cols = await testDb().$queryRaw<{ c: string; t: string }[]>`
      SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_sessions'
        AND COLUMN_NAME IN ('customer_name','customer_email','ticket_no','note') ORDER BY COLUMN_NAME`;
    expect(cols).toEqual([
      { c: "customer_email", t: "varchar(254)" }, // P8b-1: 190→254 (talep e-postası AC-134)
      { c: "customer_name", t: "varchar(100)" },
      { c: "note", t: "text" },
      { c: "ticket_no", t: "varchar(50)" },
    ]);
    const idx = await testDb().$queryRaw<{ c: string }[]>`
      SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_sessions'
        AND INDEX_NAME = 'support_sessions_tenant_id_status_created_at_idx' ORDER BY SEQ_IN_INDEX`;
    expect(idx.map((r) => r.c)).toEqual(["tenant_id", "status", "created_at"]);
    const more = await testDb().$queryRaw<{ t: string; i: string; c: string }[]>`
      SELECT TABLE_NAME AS t, INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('support_sessions_created_at_idx', 'audit_logs_tenant_id_entity_entity_id_created_at_idx')
      GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME`;
    expect(more).toEqual([
      { t: "audit_logs", i: "audit_logs_tenant_id_entity_entity_id_created_at_idx", c: "tenant_id,entity,entity_id,created_at" },
      { t: "support_sessions", i: "support_sessions_created_at_idx", c: "created_at" },
    ]);
  });
});

describe("P8 performans seed betiği (scripts/perf-sessions.ts)", () => {
  it("idempotent, tenant'a özgü; liste sorgusu sıralı/sayfalı, contains joker karakterleri düz metin", async () => {
    const slug = `perf-t-${newId().toLowerCase()}`;
    const a = await seedPerfSessions(testDb(), { slug, sessions: 300, technicians: 3 });
    expect(a).toMatchObject({ inserted: 300, total: 300 });
    const again = await seedPerfSessions(testDb(), { slug, sessions: 300, technicians: 3 });
    expect(again).toMatchObject({ tenantId: a.tenantId, inserted: 0, total: 300 });
    const other = await seedPerfSessions(testDb(), { slug: `${slug}-x`, sessions: 50, technicians: 1 });

    const page1 = await listPage(testDb(), { tenantId: a.tenantId }, 1, 25);
    expect(page1.total).toBe(300);
    expect(page1.rows).toHaveLength(25);
    const keys = page1.rows.map((r) => `${r.createdAt.toISOString()}|${r.id}`);
    expect([...keys].sort().reverse()).toEqual(keys); // created_at DESC, id DESC
    const last = await listPage(testDb(), { tenantId: a.tenantId }, 12, 25);
    expect(last.rows).toHaveLength(25);
    expect(new Set([...page1.rows, ...last.rows].map((r) => r.id)).size).toBe(50);

    // Tenant kapsamı: diğer tenant'ın kayıtları görünmez.
    expect((await listPage(testDb(), { tenantId: other.tenantId })).total).toBe(50);
    expect(await testDb().supportSession.count({ where: { tenantId: a.tenantId, technicianId: { in: other.technicianIds } } })).toBe(0);

    // Üretilen veri: geçmişte yalnız bitmiş durumlar; müşteri bilgisi yalnız tüketilmiş oturumda.
    const statuses = await testDb().supportSession.groupBy({ by: ["status"], where: { tenantId: a.tenantId }, _count: true });
    expect(statuses.map((s) => s.status).sort()).toEqual(
      ["CANCELLED", "ENDED", "EXPIRED"].filter((x) => statuses.some((s) => s.status === x)),
    );
    expect(await testDb().supportSession.count({ where: { tenantId: a.tenantId, customerName: { not: null }, consumedAt: null } })).toBe(0);

    // Prisma 7 (MySQL) `contains` LIKE jokerlerini (% _ \) KAÇIŞLAMAZ: "%" her adı eşler. Backend müşteri filtresinde
    // önce kaçışlamalı (docs/db-notlari.md P8 "Backend-dev için"); kaçışlı değer düz metin aranır.
    const named = await testDb().supportSession.count({ where: { tenantId: a.tenantId, customerName: { not: null } } });
    expect(named).toBeGreaterThan(0);
    expect((await listPage(testDb(), { tenantId: a.tenantId, customerName: { contains: "%" } })).total).toBe(named);
    const esc = (q: string) => q.replace(/[\\%_]/g, "\\$&");
    expect((await listPage(testDb(), { tenantId: a.tenantId, customerName: { contains: esc("%") } })).total).toBe(0);
    expect((await listPage(testDb(), { tenantId: a.tenantId, customerName: { contains: esc("_") } })).total).toBe(0);
    expect((await listPage(testDb(), { tenantId: a.tenantId, customerName: { contains: esc("\\") } })).total).toBe(0);
    // utf8mb4_unicode_ci: büyük/küçük harf duyarsız arama.
    const lower = await listPage(testDb(), { tenantId: a.tenantId, customerName: { contains: "yılmaz" } });
    const exact = await listPage(testDb(), { tenantId: a.tenantId, customerName: { contains: "Yılmaz" } });
    expect(lower.total).toBe(exact.total);
  });
});

describe("ADR-0014 enum CHECK ikili karşılaştırma", () => {
  it("kanonik değer geçer; harf varyantı, sondaki boşluk ve aksanlı varyant reddedilir (örnek: mode, consent source)", async () => {
    const s = await session("ACTIVE");
    for (const bad of ["browser", "BROWSER ", "BR\u00D3WSER"]) {
      await rejectsWith(testDb().supportSession.updateMany({ where: { id: s.id }, data: { mode: bad } }), /support_sessions_mode_chk/);
    }
    const consent = (source: string) =>
      testDb().sessionConsent.create({
        data: { id: newId(), sessionId: s.id, tenantId: s.tenantId, level: "CONTROL", decision: "REVOKED", source },
      });
    await consent("TECH");
    for (const bad of ["tech", "TECH ", "T\u00C9CH"]) await rejectsWith(consent(bad), /session_consents_source_chk/);
    const clauses = await testDb().$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CHECK_CLAUSE LIKE '%charset binary%'`; // MySQL CAST(x AS BINARY)'yi böyle saklar
    expect(Number(clauses[0]?.n)).toBe(76); // P28e +8: session_consents text_scope/line/recording_decision, session_recordings basis/state/stop/delete, session_recording_parts storage_rel. P28u +1: support_sessions_consent_mode_chk. P28b +14: session_stored_files 12 (direction/purpose/state/scan_reason/signature/file_name/size/storage_rel/uploaded_by/scanned/delivered/expires), support_sessions_file_mode_chk, system_settings_clamav_chk. P27 +3: K0 migration'ının yeni ikili enum CHECK'leri (unattended_devices.revoke_reason vb.). P19 +8: support_requests source/source_version, notification_outbox kind/channel/state/recipient_enc/sent/last_reason. P18 +6: tenant_request_settings default_priority/after_hours_mode, customers.default_priority, support_requests.priority, session_messages sender/sender_user. P16 +7: tenants_passive_chk, users_deleted_chk, tenant_purge_jobs state/step/done/cancelled/tenant_row. P15 session_files.reported_by, request_blocks kind/target + ADR-0014 14 + P8b-1 support_requests status/cancel_reason/network_match + P8c-1 customers.status, device_bindings.revoke_reason + P11 system_settings key/mysql/turn + P12 system_logo, tenants.logo_path, users.avatar_path (öndek ikili eşitlik) + whatsapp servis ayarı
  });
});
