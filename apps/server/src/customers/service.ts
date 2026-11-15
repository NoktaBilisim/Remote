// Müşteri firmalar servisi (P8c; mimari-e10 §3.1, §3.4, §3.7, §5.7, §15.6; mimari-api "Müşteriler (P8c)"; AC-165..180, 195).
// Çoklu yazma tek TX + audit (K19 `customerAuditView`, ham PII audit'e girmez); bellek (talep iptali/hub) commit SONRASI.
// Ref üretimi: `request_refs` (append-only ad alanı) — oluşturmada önce customers sonra request_refs (FK); yenileme ve
// yeniden aktif etmede önce request_refs sonra customers. PK/UQ çakışması → tüm TX yeni ref ile (en çok 5 deneme).
// B-P8c2-2: geçici DB hatası (deadlock 1213 / P2034, kilit bekleme 1205, P2028) → tüm TX bir kez daha (§15.4 kayıt
// verme yolu `device_bindings → customers` sırasıyla kilitler; pasife alma/yenileme `customers → device_bindings`).
import type {
  CreateCustomerData,
  CustomerDetail,
  CustomerFirmRef,
  CustomerListItem,
  CustomerListResponse,
  CustomerOptionsQuery,
  CustomerOptionsResponse,
  CustomerStatus,
  CustomerTabQuery,
  GeneralLinkResponse,
  ListCustomersQuery,
  UpdateCustomerData,
} from "@remote/contracts/api/customers";
import {
  CUSTOMER_NAME_CONFLICT_MESSAGE,
  CUSTOMER_OPTIONS_MAX,
  customerKeys,
  digitsOf,
  foldKey,
  suggestFileLabel,
} from "@remote/contracts/api/customers";
import type { SupportRequestListResponse } from "@remote/contracts/api/requests";
import type { SessionListResponse } from "@remote/contracts/api/sessions";
import { CUSTOMER_AUDIT } from "@remote/contracts/audit";
import { customerAuditView, type CustomerAuditFields } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { countRevoked } from "../bindings/service.ts";
import * as brepo from "../bindings/repo.ts";
import { conflictIndex, isTransientDbError } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newTenantRef } from "../lib/ids.ts";
import { ensureSettings, generalRotatedAt, toItem } from "../requests/panel.ts";
import { requestDownloadUrl, requestFileName } from "../requests/ref.ts";
import * as rrepo from "../requests/repo.ts";
import { SYSTEM, SYSTEM_CTX, type RequestService } from "../requests/service.ts";
import { toListItem } from "../sessions/history.ts";
import { withWaitingGuests } from "../sessions/lobby.ts";
import * as hrepo from "../sessions/history-repo.ts";
import { historyScope } from "../sessions/service.ts";
import * as repo from "./repo.ts";

const ENTITY = "customer";
const REF_ATTEMPTS = 5;
const TRANSIENT_RETRIES = 1;
const NAME_UQ = "customers_tenant_id_name_key_key";
const REF_CONFLICTS: ReadonlySet<string> = new Set(["PRIMARY", "customers_request_ref_key"]);
const DAY_MS = 86_400_000;

const who = (auth: AuthContext, tenantId: string) => ({
  tenantId,
  userId: auth.user.id,
  username: auth.user.email,
});
const nameConflict = (): AppError =>
  new AppError("CONFLICT", {
    message: CUSTOMER_NAME_CONFLICT_MESSAGE,
    fields: { name: CUSTOMER_NAME_CONFLICT_MESSAGE },
  });
const isRefConflict = (err: unknown): boolean => REF_CONFLICTS.has(conflictIndex(err) ?? "-");

/**
 * Tüm TX'i yeniden dener: ref çakışmasında en çok 5 deneme, geçici DB hatasında (B-P8c2-2) bir kez. Geri alınan TX'in
 * audit/kayıt geçersizleştirmesi de geri alındığından yeniden deneme çift yazmaz. Ad çakışması 409.
 */
async function withTxRetry<T>(fn: () => Promise<T>): Promise<T> {
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

function link(svc: RequestService, c: { status: string; fileLabel: string; requestRef: string }) {
  const active = c.status === "ACTIVE";
  return {
    downloadUrl: active ? requestDownloadUrl(svc.d.env.PUBLIC_BASE_URL, c.requestRef) : null,
    fileName: active ? requestFileName(c.fileLabel, c.requestRef) : null,
  };
}

function listItem(svc: RequestService, c: repo.CustomerListRow, stats: { count: number; last: Date | null } | undefined): CustomerListItem {
  return {
    id: c.id,
    name: c.name,
    status: c.status as CustomerStatus,
    ...link(svc, c),
    createdAt: c.createdAt.toISOString(),
    lastRequestAt: stats?.last?.toISOString() ?? null,
    requestCount: stats?.count ?? 0,
  };
}

async function detail(svc: RequestService, tenantId: string, id: string): Promise<CustomerDetail> {
  const c = await repo.find(svc.d.db, tenantId, id);
  if (!c) throw new AppError("NOT_FOUND");
  const [stats, sessionCount] = await Promise.all([repo.requestStats(svc.d.db, tenantId, [id]), repo.sessionCount(svc.d.db, tenantId, id)]);
  return {
    ...listItem(svc, c, stats.get(id)),
    fileLabel: c.fileLabel,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    note: c.note,
    refRotatedAt: c.refRotatedAt?.toISOString() ?? null,
    passiveAt: c.passiveAt?.toISOString() ?? null,
    anonymizedAt: c.anonymizedAt?.toISOString() ?? null,
    sessionCount,
  };
}

const auditFields = (c: repo.CustomerRow): CustomerAuditFields => ({
  name: c.name,
  fileLabel: c.fileLabel,
  status: c.status,
  contactName: c.contactName,
  phone: c.phone,
  email: c.email,
  note: c.note,
});

async function writeLimit(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string): Promise<void> {
  await svc.limit(ctx, tenantId, "customersWrite", "customers.write", "user", auth.user.id);
}

// ------------------------------------------------------------------ okuma

/** GET /customers (AC-166): durum + arama + sayfa; sayaçlar sayfadaki id'ler için tek gruplama sorgusu. */
export async function listCustomers(svc: RequestService, tenantId: string, q: ListCustomersQuery): Promise<CustomerListResponse> {
  const folded = q.q ? foldKey(q.q) : undefined;
  const d = q.q && /^[\d\s+\-()]+$/.test(q.q) ? digitsOf(q.q).replace(/^0+/, "") : undefined;
  const { rows, total } = await repo.list(
    svc.d.db,
    tenantId,
    {
      status: q.status,
      folded,
      digits: d && d.length >= 2 ? d : undefined,
      sort: q.sort,
    },
    { skip: (q.page - 1) * q.pageSize, take: q.pageSize },
  );
  const stats = await repo.requestStats(
    svc.d.db,
    tenantId,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) => listItem(svc, r, stats.get(r.id))),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export const getCustomer = (svc: RequestService, tenantId: string, id: string): Promise<CustomerDetail> => detail(svc, tenantId, id);

export async function customerOptions(svc: RequestService, tenantId: string, q: CustomerOptionsQuery): Promise<CustomerOptionsResponse> {
  const folded = q.q ? foldKey(q.q) : undefined;
  const rows = await repo.options(svc.d.db, tenantId, q.status, folded || undefined, CUSTOMER_OPTIONS_MAX);
  return {
    items: rows.map((r): CustomerFirmRef => ({
      id: r.id,
      name: r.name,
      status: r.status as CustomerStatus,
    })),
  };
}

/** GET /customers/general-link (AC-175): salt okunur; ayar yoksa tembel oluşturulur. */
export async function generalLink(svc: RequestService, tenantId: string): Promise<GeneralLinkResponse> {
  const s = await ensureSettings(svc, tenantId);
  return {
    downloadUrl: requestDownloadUrl(svc.d.env.PUBLIC_BASE_URL, s.requestRef),
    fileName: requestFileName(s.fileLabel, s.requestRef),
  };
}

async function assertExists(svc: RequestService, tenantId: string, id: string): Promise<void> {
  if (
    !(await svc.d.db.customer.findFirst({
      where: { id, tenantId },
      select: { id: true },
    }))
  )
    throw new AppError("NOT_FOUND");
}

/** GET /customers/:id/requests (AC-178): tüm durumlar, yeniden eskiye. */
export async function customerRequests(
  svc: RequestService,
  tenantId: string,
  id: string,
  q: CustomerTabQuery,
): Promise<SupportRequestListResponse> {
  await assertExists(svc, tenantId, id);
  const { rows, total } = await rrepo.listByCustomer(svc.d.db, tenantId, id, {
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  const now = svc.d.clock.now();
  const rotated = await generalRotatedAt(svc, tenantId);
  return {
    items: rows.map((r) => toItem(r, now, rotated)),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

/** GET /customers/:id/sessions (AC-178, K23): oturum geçmişi kapsamı (USER yalnız kendi oturumları). */
export async function customerSessions(
  svc: RequestService,
  auth: AuthContext,
  tenantId: string,
  id: string,
  q: CustomerTabQuery,
): Promise<SessionListResponse> {
  await assertExists(svc, tenantId, id);
  const scope = historyScope(auth); // tenantScope önce zorlandı → kind "tenant"
  const { rows, total } = await hrepo.listHistory(svc.d.db, scope, { customerFirm: id }, "createdAt:desc", {
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  // P13b-L: SessionListItem.waitingGuests (S13L-1: sessions.view yoksa 0).
  return withWaitingGuests(
    { items: rows.map((r) => toListItem(r, scope, auth.user.id)), page: q.page, pageSize: q.pageSize, total },
    svc.d.rooms,
    auth,
  );
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
    svc.d.db.$transaction(async (tx) => {
      const now = new Date(svc.d.clock.now());
      const ref = newTenantRef();
      await repo.insert(tx, {
        id,
        tenantId,
        name: input.name,
        ...customerKeys(input.name, contactName, phone),
        fileLabel,
        requestRef: ref,
        contactName,
        phone,
        email: input.email ?? null,
        note: input.note ?? null,
        status: "ACTIVE",
        createdBy: auth.user.id,
        createdAt: now,
      });
      await rrepo.insertRequestRef(tx, {
        ref,
        tenantId,
        customerId: id,
        createdAt: now,
      });
      // §15.6 (3): oluşturma PII taşımaz.
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: CUSTOMER_AUDIT.CREATED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        newValue: customerAuditView({
          name: input.name,
          fileLabel,
          refPrefix: ref,
        }),
      });
    }),
  );
  svc.refreshCustomersGauge();
  return detail(svc, tenantId, id);
}

const FIELDS = ["name", "fileLabel", "contactName", "phone", "email", "note"] as const;
const PII = ["contactName", "phone", "email", "note"] as const;

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
    await svc.d.db.$transaction(async (tx) => {
      const c = await repo.lock(tx, tenantId, id);
      if (!c) throw new AppError("NOT_FOUND");
      const next = {
        name: c.name,
        fileLabel: c.fileLabel,
        contactName: c.contactName,
        phone: c.phone,
        email: c.email,
        note: c.note,
      };
      for (const f of FIELDS) {
        const v = input[f];
        if (v !== undefined) (next as Record<string, string | null>)[f] = v;
      }
      const changed = FIELDS.filter((f) => next[f] !== c[f]);
      if (changed.length === 0) return;
      const writesPii = PII.some((f) => changed.includes(f) && next[f] !== null);
      await repo.update(tx, tenantId, id, {
        ...Object.fromEntries(changed.map((f) => [f, next[f]])),
        ...customerKeys(next.name, next.contactName, next.phone),
        ...(writesPii ? { anonymizedAt: null } : {}), // CHECK customers_anonymized_chk
      });
      const pick = (src: CustomerAuditFields): CustomerAuditFields =>
        Object.fromEntries(changed.map((f) => [f, src[f]])) as CustomerAuditFields;
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: CUSTOMER_AUDIT.UPDATED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        oldValue: customerAuditView(pick(auditFields(c))),
        newValue: { changed: [...changed], ...customerAuditView(pick(next)) },
      });
    });
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
  const revoked = await withTxRetry(() =>
    svc.d.db.$transaction(async (tx) => {
      const c = await repo.lock(tx, tenantId, id);
      if (!c) throw new AppError("NOT_FOUND");
      if (c.status !== "ACTIVE")
        throw new AppError("CONFLICT", {
          message: "Pasif müşterinin bağlantısı yenilenemez; önce yeniden aktif edin.",
        });
      const now = new Date(svc.d.clock.now());
      const ref = newTenantRef();
      await rrepo.insertRequestRef(tx, {
        ref,
        tenantId,
        customerId: id,
        createdAt: now,
      });
      await repo.update(tx, tenantId, id, {
        requestRef: ref,
        refRotatedAt: now,
      });
      const n = await brepo.revokeForOwner(tx, tenantId, id, "CUSTOMER_ROTATED", now);
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: CUSTOMER_AUDIT.REF_ROTATED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        oldValue: { oldRefPrefix: c.requestRef.slice(0, 4) },
        newValue: { newRefPrefix: ref.slice(0, 4), revokedBindings: n },
      });
      return n;
    }),
  );
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
    svc.d.db.$transaction(async (tx) => {
      const c = await repo.lock(tx, tenantId, id);
      if (!c) throw new AppError("NOT_FOUND");
      if (c.status !== "ACTIVE") throw new AppError("CONFLICT", { message: "Müşteri zaten pasif." });
      const now = new Date(svc.d.clock.now());
      await repo.update(tx, tenantId, id, {
        status: "PASSIVE",
        passiveAt: now,
      });
      const n = await brepo.revokeForOwner(tx, tenantId, id, "CUSTOMER_PASSIVE", now);
      // B-P8c-1/6: bekleyenler aynı TX'te iptal (talep TX'i müşteriyi FOR SHARE ile doğruladığından bu kilitten sonra yeni
      // bekleyen doğamaz); `cancelledRequests` gerçekte iptal edilen sayıdır. Süpürücü yalnız savunma yedeği.
      const ids: string[] = [];
      for (const p of await rrepo.findPendingOfCustomer(tx, tenantId, id)) {
        if ((await rrepo.cancelPending(tx, p.id, "CUSTOMER_PASSIVE", now)) === 0) continue;
        ids.push(p.id);
        await writeAudit(tx, ctx, {
          ...who(auth, tenantId),
          action: "request.cancelled",
          entity: "support_requests",
          entityId: p.id,
          result: "success",
          oldValue: { status: "PENDING" },
          newValue: { status: "CANCELLED", reason: "CUSTOMER_PASSIVE" },
        });
      }
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: CUSTOMER_AUDIT.DEACTIVATED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        oldValue: customerAuditView({ status: "ACTIVE" }),
        newValue: {
          ...customerAuditView({ status: "PASSIVE", refPrefix: c.requestRef }),
          revokedBindings: n,
          cancelledRequests: ids.length,
        },
      });
      return { revoked: n, cancelled: ids };
    }),
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
  await withTxRetry(() =>
    svc.d.db.$transaction(async (tx) => {
      const c = await repo.lock(tx, tenantId, id);
      if (!c) throw new AppError("NOT_FOUND");
      if (c.status !== "PASSIVE") throw new AppError("CONFLICT", { message: "Müşteri zaten aktif." });
      const now = new Date(svc.d.clock.now());
      const ref = newTenantRef();
      await rrepo.insertRequestRef(tx, {
        ref,
        tenantId,
        customerId: id,
        createdAt: now,
      });
      await repo.update(tx, tenantId, id, {
        status: "ACTIVE",
        passiveAt: null,
        requestRef: ref,
        refRotatedAt: now,
      });
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: CUSTOMER_AUDIT.REACTIVATED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        oldValue: { oldRefPrefix: c.requestRef.slice(0, 4), status: "PASSIVE" },
        newValue: { newRefPrefix: ref.slice(0, 4), status: "ACTIVE" },
      });
    }),
  );
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
