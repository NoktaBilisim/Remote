// Müşteri firmalar servisi (P8c; mimari-e10 §3.1, §3.4, §3.7, §5.7, §15.6; mimari-api "Müşteriler (P8c)"; AC-165..180, 195).
// Çoklu yazma tek TX + audit (K19 `customerAuditView`, ham PII audit'e girmez); bellek (talep iptali/hub) commit SONRASI.
// Ref üretimi: `request_refs` (append-only ad alanı) — oluşturmada önce customers sonra request_refs (FK); yenileme ve
// yeniden aktif etmede önce request_refs sonra customers. PK/UQ çakışması → tüm TX yeni ref ile (en çok 5 deneme).
// B-P8c2-2: geçici DB hatası (deadlock 1213 / P2034, kilit bekleme 1205, P2028) → tüm TX bir kez daha (§15.4 kayıt
// verme yolu `device_bindings → customers` sırasıyla kilitler; pasife alma/yenileme `customers → device_bindings`).
import type { CreateCustomerData, CustomerDetail, UpdateCustomerData } from "@remote/contracts/api/customers";
import { customerKeys, suggestFileLabel } from "@remote/contracts/api/customers";
import { CUSTOMER_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { countRevoked } from "../bindings/service.ts";
import { conflictIndex, isTransientDbError } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import { ensureSettings } from "../requests/panel.ts";
import * as rrepo from "../requests/repo.ts";
import { SYSTEM, SYSTEM_CTX, type RequestService } from "../requests/service.ts";
import * as repo from "./repo.ts";
import { detail, ENTITY, nameConflict } from "./view.ts";
import { deactivateTx, insertCustomerTx, PII, reactivateTx, rotateRefTx, updateCustomerTx } from "./write-tx.ts";

const REF_ATTEMPTS = 5;
const TRANSIENT_RETRIES = 1;
const NAME_UQ = "customers_tenant_id_name_key_key";
const REF_CONFLICTS: ReadonlySet<string> = new Set(["PRIMARY", "customers_request_ref_key"]);
const DAY_MS = 86_400_000;

const isRefConflict = (err: unknown): boolean => REF_CONFLICTS.has(conflictIndex(err) ?? "-");

/**
 * Tüm TX'i yeniden dener: ref çakışmasında en çok 5 deneme, geçici DB hatasında (B-P8c2-2) bir kez. Geri alınan TX'in
 * audit/kayıt geçersizleştirmesi de geri alındığından yeniden deneme çift yazmaz. Ad çakışması 409.
 */
export async function withTxRetry<T>(fn: () => Promise<T>): Promise<T> {
  let transient = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (conflictIndex(err) === NAME_UQ) throw nameConflict();
      if (attempt < REF_ATTEMPTS && isRefConflict(err)) continue;
      if (transient < TRANSIENT_RETRIES && isTransientDbError(err)) {
        transient++;
        continue;
      }
      throw err;
    }
  }
}

async function writeLimit(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string): Promise<void> {
  await svc.limit(ctx, tenantId, "customersWrite", "customers.write", "user", auth.user.id);
}

// ------------------------------------------------------------------ yazma

/** POST /customers (AC-167, 168): ayar tembel → TX [customers INSERT → request_refs INSERT → audit]. */
export async function createCustomer(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: CreateCustomerData,
): Promise<CustomerDetail> {
  await writeLimit(svc, ctx, auth, tenantId);
  await ensureSettings(svc, tenantId);
  const id = newId();
  const contactName = input.contactName ?? null;
  const phone = input.phone ?? null;
  const fileLabel = input.fileLabel ?? suggestFileLabel(input.name);
  await withTxRetry(() =>
    svc.d.db.$transaction(async (tx) => insertCustomerTx(tx, svc, ctx, auth, tenantId, { id, input, contactName, phone, fileLabel })),
  );
  svc.refreshCustomersGauge();
  return detail(svc, tenantId, id);
}

/** PATCH /customers/:id (AC-167, 195): yalnız değişen alanlar; boşaltma; pasifte de serbest; audit maskeli (K19). */
export async function updateCustomer(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  input: UpdateCustomerData,
): Promise<CustomerDetail> {
  await writeLimit(svc, ctx, auth, tenantId);
  try {
    await svc.d.db.$transaction(async (tx) => updateCustomerTx(tx, ctx, auth, tenantId, id, input));
  } catch (err) {
    if (conflictIndex(err) === NAME_UQ) throw nameConflict();
    throw err;
  }
  return detail(svc, tenantId, id);
}

/** POST /customers/:id/rotate-ref (AC-170): yeni ref; bu müşterinin kayıtları CUSTOMER_ROTATED; bekleyen talepler etkilenmez. */
export async function rotateCustomerRef(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<CustomerDetail> {
  await writeLimit(svc, ctx, auth, tenantId);
  const revoked = await withTxRetry(() => svc.d.db.$transaction(async (tx) => rotateRefTx(tx, svc, ctx, auth, tenantId, id)));
  countRevoked(svc, "CUSTOMER_ROTATED", revoked);
  return detail(svc, tenantId, id);
}

/**
 * POST /customers/:id/deactivate (AC-171): TX [ACTIVE→PASSIVE koşullu → kayıtlar CUSTOMER_PASSIVE → audit]; commit sonrası
 * bekleyen talepler CANCELLED(CUSTOMER_PASSIVE) (süpürücü yedek ≤ 60 sn).
 */
export async function deactivateCustomer(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<CustomerDetail> {
  await writeLimit(svc, ctx, auth, tenantId);
  const { revoked, cancelled } = await withTxRetry(() =>
    svc.d.db.$transaction(async (tx) => deactivateTx(tx, svc, ctx, auth, tenantId, id)),
  );
  countRevoked(svc, "CUSTOMER_PASSIVE", revoked);
  for (const rid of cancelled)
    await svc.closedAfterCommit(tenantId, rid, "CANCELLED", {
      reason: "CUSTOMER_PASSIVE",
    });
  svc.refreshCustomersGauge();
  return detail(svc, tenantId, id);
}

/** POST /customers/:id/reactivate (AC-171): YENİ ref; eski dosyalar ve kayıtlar geçersiz kalır. */
export async function reactivateCustomer(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<CustomerDetail> {
  await writeLimit(svc, ctx, auth, tenantId);
  await withTxRetry(() => svc.d.db.$transaction(async (tx) => reactivateTx(tx, svc, ctx, auth, tenantId, id)));
  svc.refreshCustomersGauge();
  return detail(svc, tenantId, id);
}

// ------------------------------------------------------------------ işler

/** 30 sn süpürücü yedeği (AC-171): pasif müşterinin bekleyen talepleri → CANCELLED(CUSTOMER_PASSIVE). */
export async function sweepCustomerPassive(svc: RequestService, take = 500): Promise<number> {
  let n = 0;
  for (const r of await rrepo.findCustomerPassivePending(svc.d.db, take)) if (await svc.cancelSystem(r.id, "CUSTOMER_PASSIVE")) n++;
  return n;
}

/**
 * Günlük 03:30 (AC-195, §3.7): pasif + `passive_at`'ten tenant `retention_days` geçmiş müşterilerin kişisel alanları
 * NULL + `search_key` yeniden + `anonymized_at`; audit `customer.anonymized` (system, eski değer yok — §15.6 (3)).
 */
export async function anonymizeCustomersOf(
  svc: RequestService,
  t: { tenantId: string; retentionDays: number },
  now: Date,
): Promise<number> {
  let total = 0;
  const cutoff = new Date(now.getTime() - t.retentionDays * DAY_MS);
  for (const c of await repo.anonymizeCandidates(svc.d.db, t.tenantId, cutoff, 1000)) {
    const done = await svc.d.db.$transaction(async (tx) => {
      const n = await repo.update(
        tx,
        t.tenantId,
        c.id,
        {
          contactName: null,
          phone: null,
          email: null,
          note: null,
          ...customerKeys(c.name, null, null),
          anonymizedAt: now,
        },
        { status: "PASSIVE", anonymizedAt: null },
      );
      if (n === 0) return false;
      await writeAudit(tx, SYSTEM_CTX, {
        tenantId: t.tenantId,
        ...SYSTEM,
        action: CUSTOMER_AUDIT.ANONYMIZED,
        entity: ENTITY,
        entityId: c.id,
        result: "success",
        newValue: { fields: [...PII] },
      });
      return true;
    });
    if (done) total++;
  }
  return total;
}
