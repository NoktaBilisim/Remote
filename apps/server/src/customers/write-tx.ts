// Müşteri yazma TX gövdeleri (customers/service.ts; TX sınırı, yeniden deneme ve commit sonrası işler orada). Sıra:
// oluşturmada önce customers sonra request_refs (FK); yenileme ve yeniden aktif etmede önce request_refs sonra customers.
import type { CreateCustomerData, UpdateCustomerData } from "@remote/contracts/api/customers";
import { customerKeys } from "@remote/contracts/api/customers";
import { CUSTOMER_AUDIT } from "@remote/contracts/audit";
import { customerAuditView, type CustomerAuditFields } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import * as brepo from "../bindings/repo.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { newTenantRef } from "../lib/ids.ts";
import * as rrepo from "../requests/repo.ts";
import type { RequestService } from "../requests/service.ts";
import * as repo from "./repo.ts";
import { auditFields, ENTITY, who } from "./view.ts";
import { revokeCustomerDevicesTx } from "../unattended/customer-passive.ts";

type Tx = Prisma.TransactionClient;

const FIELDS = ["name", "fileLabel", "contactName", "phone", "email", "note", "defaultPriority", "slaMinutes"] as const;
export const PII = ["contactName", "phone", "email", "note"] as const;

/** customers satırı (oluşturma). */
function insertData(
  tenantId: string,
  createdBy: string,
  c: { id: string; input: CreateCustomerData; contactName: string | null; phone: string | null; fileLabel: string },
  ref: string,
  now: Date,
) {
  const { id, input, contactName, phone, fileLabel } = c;
  return {
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
    defaultPriority: input.defaultPriority ?? null,
    slaMinutes: input.slaMinutes ?? null,
    status: "ACTIVE",
    createdBy,
    createdAt: now,
  };
}

/** Oluşturma: customers INSERT → request_refs INSERT → audit (§15.6 (3): oluşturma PII taşımaz). */
export async function insertCustomerTx(
  tx: Tx,
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  c: { id: string; input: CreateCustomerData; contactName: string | null; phone: string | null; fileLabel: string },
): Promise<void> {
  const { id, input, fileLabel } = c;
  const now = new Date(svc.d.clock.now());
  const ref = newTenantRef();
  await repo.insert(tx, insertData(tenantId, auth.user.id, c, ref, now));
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
      ...(input.defaultPriority ? { defaultPriority: input.defaultPriority } : {}),
      ...(input.slaMinutes ? { slaMinutes: input.slaMinutes } : {}),
    }),
  });
}

/** Mevcut değerler + girdideki tanımlı alanlar. */
function mergeFields(c: repo.CustomerRow, input: UpdateCustomerData) {
  const next = {
    name: c.name,
    fileLabel: c.fileLabel,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    note: c.note,
    defaultPriority: c.defaultPriority,
    slaMinutes: c.slaMinutes,
  };
  for (const f of FIELDS) {
    const v = input[f];
    if (v !== undefined) (next as Record<string, string | number | null>)[f] = v;
  }
  return next;
}

/** Güncelleme: kilit → yalnız değişen alanlar (yoksa yazım/audit yok) → audit maskeli (K19). */
export async function updateCustomerTx(
  tx: Tx,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  input: UpdateCustomerData,
): Promise<void> {
  const c = await repo.lock(tx, tenantId, id);
  if (!c) throw new AppError("NOT_FOUND");
  const next = mergeFields(c, input);
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
}

/** Ref yenileme: kilit → request_refs → customers → kayıtlar CUSTOMER_ROTATED → audit. Dönen: geçersizleşen kayıt sayısı. */
export async function rotateRefTx(
  tx: Tx,
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<number> {
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
}

/**
 * B-P8c-1/6: bekleyenler aynı TX'te iptal (talep TX'i müşteriyi FOR SHARE ile doğruladığından bu kilitten sonra yeni
 * bekleyen doğamaz); dönen gerçekte iptal edilen talepler. Süpürücü yalnız savunma yedeği.
 */
async function cancelPendingTx(tx: Tx, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string, now: Date): Promise<string[]> {
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
  return ids;
}

/** Pasife alma: ACTIVE→PASSIVE koşullu → kayıtlar CUSTOMER_PASSIVE → bekleyen talepler iptal → audit. */
export async function deactivateTx(
  tx: Tx,
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<{ revoked: number; cancelled: string[]; devices: string[] }> {
  const c = await repo.lock(tx, tenantId, id);
  if (!c) throw new AppError("NOT_FOUND");
  if (c.status !== "ACTIVE") throw new AppError("CONFLICT", { message: "Müşteri zaten pasif." });
  const now = new Date(svc.d.clock.now());
  await repo.update(tx, tenantId, id, {
    status: "PASSIVE",
    passiveAt: now,
  });
  const n = await brepo.revokeForOwner(tx, tenantId, id, "CUSTOMER_PASSIVE", now);
  const ids = await cancelPendingTx(tx, ctx, auth, tenantId, id, now);
  const devices = await revokeCustomerDevicesTx(
    tx,
    ctx,
    { userId: auth.user.id, username: auth.user.email },
    { tenantId, customerId: id, now },
  );
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
      revokedDevices: devices.length,
    },
  });
  return { revoked: n, cancelled: ids, devices };
}

/** Yeniden aktif etme: kilit → YENİ ref (request_refs → customers) → audit. */
export async function reactivateTx(
  tx: Tx,
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<void> {
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
}
