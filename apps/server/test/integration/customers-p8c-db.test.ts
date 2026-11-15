// P8c-1 veri katmanı (dba): customers, request_refs (tek ref ad alanı), device_bindings (bilgisayar kaydı), talep/oturum
// müşteri ve kayıt bağı. mimari-e10 §3 + §15 (r2) DB kısıtları; migration 20261112120000_p8c_customers (elle CHECK'ler,
// STORED üretilmiş active_session_id, utf8mb4_bin katlanmış anahtarlar, request_refs geri doldurma).
// Testler uygulamanın `app` DB kullanıcısıyla (TEST_DATABASE_URL) çalışır.
import { describe, expect, it } from "vitest";
import { newId, newTenantRef, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";
import { rejectsWith } from "../helpers/db-grants.ts";
import { createRequestRow } from "../helpers/requests.ts";

const db = () => testDb();
const hash = () => sha256Hex(newId());

/** Müşteri + ad alanı kaydı (servis sırası: önce customers, sonra request_refs — FK anında denetlenir). */
async function customer(tenantId: string, o: { name?: string; nameKey?: string; phone?: string | null } = {}) {
  const id = newId();
  const name = o.name ?? `Musteri ${id.slice(-8)}`;
  const nameKey = o.nameKey ?? name.toLowerCase();
  const ref = newTenantRef();
  const c = await db().customer.create({
    data: {
      id,
      tenantId,
      name,
      nameKey,
      searchKey: `${nameKey}  ${o.phone?.replace(/\D/g, "") ?? ""}`.trimEnd(),
      fileLabel: "Musteri",
      requestRef: ref,
      phone: o.phone ?? null,
    },
  });
  await db().requestRef.create({ data: { ref, tenantId, customerId: id } });
  return c;
}

async function fixture() {
  const tenant = await createTenant();
  const tech = await createUser({ tenantId: tenant.id });
  const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: tech.id, status: "ACTIVE" });
  return { tenantId: tenant.id, techId: tech.id, sessionId: s.id };
}

function binding(tenantId: string, sessionId: string, o: { customerId?: string | null; keyHash?: string } = {}) {
  return db().deviceBinding.create({
    data: {
      id: newId(),
      tenantId,
      customerId: o.customerId ?? null,
      keyHash: o.keyHash ?? hash(),
      clientVersion: "0.10.0",
      firstSessionId: sessionId,
      lastSessionId: sessionId,
      lastUsedAt: new Date(),
    },
  });
}

const revoke = (id: string, reason = "FORGOTTEN") =>
  db().deviceBinding.update({ where: { id }, data: { revokedAt: new Date(), revokeReason: reason, keyHash: null } });

describe("P8c-1 customers", () => {
  it("AC-167: ad tenant içinde katlanmış anahtarla tekil (pasifler dahil); başka tenant'ta aynı ad serbest", async () => {
    const a = await fixture();
    const b = await fixture();
    const c = await customer(a.tenantId, { name: "Şişli Ltd.", nameKey: "sisli ltd." });
    await db().customer.update({ where: { id: c.id }, data: { status: "PASSIVE", passiveAt: new Date() } });
    await rejectsWith(customer(a.tenantId, { name: "SISLI LTD.", nameKey: "sisli ltd." }), /customers_tenant_id_name_key_key/);
    await expect(customer(b.tenantId, { name: "Şişli Ltd.", nameKey: "sisli ltd." })).resolves.toBeDefined();
    // utf8mb4_bin: katlanmış anahtar AYNEN karşılaştırılır (ci harmanlamanın ek katlaması yok).
    await expect(customer(a.tenantId, { name: "SİSLİ LTD.", nameKey: "SİSLİ LTD." })).resolves.toBeDefined();
    const cols = await db().$queryRaw<{ c: string; k: string }[]>`
      SELECT COLUMN_NAME AS c, COLLATION_NAME AS k FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME IN ('name_key','search_key') ORDER BY COLUMN_NAME`;
    expect(cols).toEqual([
      { c: "name_key", k: "utf8mb4_bin" },
      { c: "search_key", k: "utf8mb4_bin" },
    ]);
  });

  it("AC-167/195: biçim, metin, durum ve anonimleştirme CHECK'leri", async () => {
    const { tenantId } = await fixture();
    const c = await customer(tenantId, { phone: "+905301112233" });
    const upd = (data: Record<string, unknown>) => db().customer.updateMany({ where: { id: c.id }, data });
    await rejectsWith(upd({ name: "A" }), /customers_name_chk/);
    await rejectsWith(upd({ name: "Ali‮exe.fdp" }), /customers_name_chk/);
    await rejectsWith(upd({ name: "Firma " }), /customers_name_chk/);
    await rejectsWith(upd({ fileLabel: "Firma-X" }), /customers_file_label_chk/);
    await rejectsWith(upd({ requestRef: "abcdefghijklmn01" }), /customers_ref_fmt_chk/);
    await rejectsWith(upd({ phone: "05301112233" }), /customers_phone_fmt_chk/);
    await rejectsWith(upd({ email: "gecersiz" }), /customers_email_fmt_chk/);
    await rejectsWith(upd({ contactName: "" }), /customers_contact_name_chk/);
    await rejectsWith(upd({ note: "a\tb" }), /customers_note_chk/);
    await rejectsWith(upd({ note: "a\r\nb" }), /customers_note_chk/);
    await rejectsWith(upd({ note: "a​b" }), /customers_note_chk/);
    await expect(upd({ note: "satır 1\nsatır 2", contactName: "Ayşe Yılmaz", email: "ayse@example.test" })).resolves.toEqual({ count: 1 });
    // search_key name_key ile başlamalı: ad değişip arama anahtarı yeniden hesaplanmazsa reddedilir.
    await rejectsWith(upd({ nameKey: "baska ad" }), /customers_search_key_chk/);
    await rejectsWith(upd({ nameKey: " x", searchKey: " x" }), /customers_name_key_chk/);
    // ADR-0014 ikili enum + PASSIVE ⇔ passive_at.
    for (const bad of ["passive", "PASSIVE ", "PÁSSIVE"])
      await rejectsWith(upd({ status: bad, passiveAt: new Date() }), /customers_status_chk/);
    await rejectsWith(upd({ status: "PASSIVE" }), /customers_passive_chk/);
    await rejectsWith(upd({ passiveAt: new Date() }), /customers_passive_chk/);
    await expect(upd({ status: "PASSIVE", passiveAt: new Date() })).resolves.toEqual({ count: 1 });
    // Yarım anonimleştirme reddedilir; tam anonimleştirme geçer; anonimken PII yazılamaz (önce anonymized_at NULL).
    await rejectsWith(upd({ contactName: null, anonymizedAt: new Date() }), /customers_anonymized_chk/);
    await expect(upd({ contactName: null, phone: null, email: null, note: null, anonymizedAt: new Date() })).resolves.toEqual({ count: 1 });
    await rejectsWith(upd({ phone: "+905301112233" }), /customers_anonymized_chk/);
    await expect(upd({ phone: "+905301112233", anonymizedAt: null })).resolves.toEqual({ count: 1 });
  });

  it("AC-195: app müşteri satırını silemez (hard delete yok)", async () => {
    const { tenantId } = await fixture();
    const c = await customer(tenantId);
    await expect(db().$executeRawUnsafe(`DELETE FROM customers WHERE id = '${c.id}'`)).rejects.toThrow();
  });
});

describe("P8c-1 request_refs (tek ref ad alanı, ADR-0006 r5)", () => {
  it("AC-168: aynı ref ikinci kez kaydedilemez (Genel ↔ müşteri); kayıt append-only", async () => {
    const { tenantId } = await fixture();
    const c = await customer(tenantId);
    // Müşterinin ref'i Genel olarak (veya başka sahibe) yeniden verilemez.
    await rejectsWith(db().requestRef.create({ data: { ref: c.requestRef, tenantId, customerId: null } }), /PRIMARY|P2002|Unique/i);
    // Emekli ref (müşteri yeniledi) kayıtta kalır → yine verilemez.
    const fresh = newTenantRef();
    await db().requestRef.create({ data: { ref: fresh, tenantId, customerId: c.id } });
    await db().customer.update({ where: { id: c.id }, data: { requestRef: fresh, refRotatedAt: new Date() } });
    await rejectsWith(db().requestRef.create({ data: { ref: c.requestRef, tenantId, customerId: null } }), /PRIMARY|P2002|Unique/i);
    await rejectsWith(db().requestRef.create({ data: { ref: "ABCDEFGHIJKLMNOP", tenantId } }), /request_refs_ref_fmt_chk/);
    for (const sql of [
      `UPDATE request_refs SET customer_id = NULL WHERE ref = '${fresh}'`,
      `DELETE FROM request_refs WHERE ref = '${fresh}'`,
    ]) {
      await expect(db().$executeRawUnsafe(sql), sql).rejects.toThrow();
    }
  });

  it("AC-172: ref kaydı başka tenant'ın müşterisine bağlanamaz (bileşik FK)", async () => {
    const a = await fixture();
    const b = await fixture();
    const c = await customer(a.tenantId);
    await rejectsWith(
      db().requestRef.create({ data: { ref: newTenantRef(), tenantId: b.tenantId, customerId: c.id } }),
      /request_refs_tenant_id_customer_id_fkey/,
    );
  });

  it("AC-168: geri doldurma ifadesi idempotent; tüm Genel ref'ler ad alanında", async () => {
    const { tenantId } = await fixture();
    // P8b şekli: ad alanına yazılmamış Genel ref (geri doldurmanın konusu); yardımcı P8c'de ad alanına yazdığı için doğrudan
    const ref = newTenantRef();
    await db().tenantRequestSettings.create({
      data: { tenantId, requestRef: ref, fileLabel: "TestFirma", waitMinutes: 30, waRecipients: [], emailRecipients: [], trustedCidrs: [] },
    });
    const backfill = `INSERT INTO request_refs (ref, tenant_id, customer_id, created_at)
      SELECT s.request_ref, s.tenant_id, NULL, COALESCE(s.ref_rotated_at, s.created_at) FROM tenant_request_settings s
      WHERE s.tenant_id = '${tenantId}' AND NOT EXISTS (SELECT 1 FROM request_refs r WHERE r.ref = s.request_ref)`;
    expect(await db().$executeRawUnsafe(backfill)).toBe(1);
    expect(await db().$executeRawUnsafe(backfill)).toBe(0);
    expect(await db().requestRef.findUnique({ where: { ref } })).toMatchObject({ tenantId, customerId: null });
  });
});

describe("P8c-1 device_bindings (bilgisayar kaydı, ADR-0017)", () => {
  it("AC-181/195: yalnız özet saklanır; geçersizleşince özet NULL ve neden zorunlu (revoked ⇔ hash NULL ⇔ neden)", async () => {
    const { tenantId, sessionId } = await fixture();
    const b = await binding(tenantId, sessionId);
    const upd = (data: Record<string, unknown>) => db().deviceBinding.updateMany({ where: { id: b.id }, data });
    await rejectsWith(upd({ keyHash: "A".repeat(64) }), /device_bindings_key_hash_fmt_chk/);
    await rejectsWith(upd({ keyHash: null }), /device_bindings_revoked_chk/);
    await rejectsWith(upd({ revokedAt: new Date(), revokeReason: "FORGOTTEN" }), /device_bindings_revoked_chk/);
    await rejectsWith(upd({ revokedAt: new Date(), keyHash: null }), /device_bindings_revoked_chk/);
    await rejectsWith(upd({ clientVersion: "0.10" }), /device_bindings_client_version_fmt_chk/);
    await rejectsWith(upd({ issueCount: 0 }), /device_bindings_issue_count_chk/);
    for (const bad of ["forgotten", "FORGOTTEN ", "FÓRGOTTEN", "DELETED"]) {
      await rejectsWith(upd({ revokedAt: new Date(), revokeReason: bad, keyHash: null }), /device_bindings_revoke_reason_chk/);
    }
    await rejectsWith(
      binding(tenantId, sessionId, { keyHash: b.keyHash ?? "" }),
      /device_bindings_key_hash_key|device_bindings_active_session_id_key/,
    );
    const r = await revoke(b.id, "ADMIN_REVOKED");
    expect(r).toMatchObject({ keyHash: null, revokeReason: "ADMIN_REVOKED", activeSessionId: null });
    await expect(db().$executeRawUnsafe(`DELETE FROM device_bindings WHERE id = '${b.id}'`)).rejects.toThrow();
  });

  it("AC-181 (G-E10-3): oturum başına en çok bir etkin kayıt — active_session_id STORED + UQ", async () => {
    const { tenantId, sessionId } = await fixture();
    const first = await binding(tenantId, sessionId);
    expect(first.activeSessionId).toBe(sessionId);
    await rejectsWith(binding(tenantId, sessionId), /device_bindings_active_session_id_key/);
    // Geçersizleşen satır oturumu serbest bırakır; yeni etkin satır eklenebilir; çoklu NULL serbest.
    await revoke(first.id, "REPLACED");
    const second = await binding(tenantId, sessionId);
    expect(second.activeSessionId).toBe(sessionId);
    await revoke(second.id);
    await expect(binding(tenantId, sessionId)).resolves.toBeDefined();
    // Uygulama sütuna yazamaz (üretilmiş).
    await rejectsWith(db().deviceBinding.updateMany({ where: { id: second.id }, data: { activeSessionId: null } }), /generated column/i);
    // Eşzamanlı iki etkin kayıt: biri UQ ile düşer.
    const other = await fixture();
    const res = await Promise.allSettled([binding(other.tenantId, other.sessionId), binding(other.tenantId, other.sessionId)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db().deviceBinding.count({ where: { lastSessionId: other.sessionId, revokedAt: null } })).toBe(1);
  });

  it("AC-172: kayıt yalnız aynı tenant'ın müşterisine ve oturumuna bağlanır (bileşik FK)", async () => {
    const a = await fixture();
    const b = await fixture();
    const cb = await customer(b.tenantId);
    await rejectsWith(binding(a.tenantId, a.sessionId, { customerId: cb.id }), /device_bindings_tenant_id_customer_id_fkey/);
    await rejectsWith(binding(a.tenantId, b.sessionId), /session_id_tenant_id_fkey/);
  });
});

describe("P8c-1 support_requests / support_sessions müşteri ve kayıt bağı", () => {
  it("AC-176/177: talep ve oturum müşteri/kayıt bağı aynı tenant'la sınırlı (bileşik FK)", async () => {
    const a = await fixture();
    const b = await fixture();
    const ca = await customer(a.tenantId);
    const cb = await customer(b.tenantId);
    const ba = await binding(a.tenantId, a.sessionId, { customerId: ca.id });
    const bb = await binding(b.tenantId, b.sessionId);
    const rq = await createRequestRow(a.tenantId);
    const updR = (data: Record<string, unknown>) => db().supportRequest.updateMany({ where: { id: rq.id }, data });
    await expect(updR({ customerId: ca.id, bindingId: ba.id })).resolves.toEqual({ count: 1 });
    await rejectsWith(updR({ customerId: cb.id }), /support_requests_tenant_id_customer_id_fkey/);
    await rejectsWith(updR({ bindingId: bb.id }), /support_requests_binding_id_tenant_id_fkey/);
    const updS = (customerId: string) => db().supportSession.updateMany({ where: { id: a.sessionId }, data: { customerId } });
    await expect(updS(ca.id)).resolves.toEqual({ count: 1 });
    await rejectsWith(updS(cb.id), /support_sessions_tenant_id_customer_id_fkey/);
    // Kayıtla açılmış talep varken kayıt satırı silinemez (FK RESTRICT; ayrıca app'te DELETE yetkisi yok).
    expect(await db().supportRequest.count({ where: { bindingId: ba.id, customerId: ca.id } })).toBe(1);
  });

  it("AC-171/185: yeni iptal nedenleri CUSTOMER_PASSIVE ve BINDING_REVOKED (ikili enum)", async () => {
    const { tenantId } = await fixture();
    const close = async (reason: string) => {
      const rq = await createRequestRow(tenantId);
      return db().supportRequest.updateMany({
        where: { id: rq.id, status: "PENDING" },
        data: { status: "CANCELLED", cancelReason: reason, closedAt: new Date() },
      });
    };
    await expect(close("CUSTOMER_PASSIVE")).resolves.toEqual({ count: 1 });
    await expect(close("BINDING_REVOKED")).resolves.toEqual({ count: 1 });
    for (const bad of ["customer_passive", "BINDING_REVOKED ", "ADMIN_REVOKED"])
      await rejectsWith(close(bad), /support_requests_cancel_reason_chk/);
  });

  it("şema: P8c indeksleri ve FK sütun sırası", async () => {
    const rows = await db().$queryRaw<{ t: string; i: string; c: string }[]>`
      SELECT TABLE_NAME AS t, INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN (
        'support_requests_tenant_id_customer_id_created_at_idx', 'support_requests_binding_id_tenant_id_status_idx',
        'support_sessions_tenant_id_customer_id_created_at_idx', 'customers_tenant_id_status_name_key_idx',
        'device_bindings_active_session_id_key', 'device_bindings_revoked_at_last_used_at_idx')
      GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME`;
    expect(rows).toEqual([
      { t: "customers", i: "customers_tenant_id_status_name_key_idx", c: "tenant_id,status,name_key" },
      { t: "device_bindings", i: "device_bindings_active_session_id_key", c: "active_session_id" },
      { t: "device_bindings", i: "device_bindings_revoked_at_last_used_at_idx", c: "revoked_at,last_used_at" },
      { t: "support_requests", i: "support_requests_binding_id_tenant_id_status_idx", c: "binding_id,tenant_id,status" },
      { t: "support_requests", i: "support_requests_tenant_id_customer_id_created_at_idx", c: "tenant_id,customer_id,created_at" },
      { t: "support_sessions", i: "support_sessions_tenant_id_customer_id_created_at_idx", c: "tenant_id,customer_id,created_at" },
    ]);
  });
});
