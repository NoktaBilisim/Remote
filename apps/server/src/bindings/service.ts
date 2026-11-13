// Bilgisayar kaydı servisi (P8c; mimari-e10 §3.4, §5, §15.1–15.5; ADR-0017; AC-181, 182, 184–187, 195).
// Kayıt YALNIZ talep açar: oturum, ticket, reconnect ve TURN uçları bu modüle bakmaz (AC-184).
// Anahtar yalnız `binding.issued` mesajında döner; DB'de SHA-256; log/audit'te asla (logger REDACT `*.bindingKey`).
import type { BindingInfo, BindingRevokeReason } from "@remote/contracts/api/bindings";
import { BINDING_DENIED_MESSAGE, bindingKeySchema, bindingRevokeInputSchema, bindingStatusInputSchema } from "@remote/contracts/api/bindings";
import { BINDING_AUDIT } from "@remote/contracts/audit";
import type { ServerOutbound } from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { conflictIndex, isTransientDbError, REQUEST_TX_OPTIONS } from "../lib/db.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { newBindingKey, newId, sha256Hex } from "../lib/ids.ts";
import { ipKey } from "../lib/ip.ts";
import { isOutdated } from "../lib/version.ts";
import { outdated } from "../sessions/public.ts";
import { ensureSettings } from "../requests/panel.ts";
import * as crepo from "../customers/repo.ts";
import * as rrepo from "../requests/repo.ts";
import { CUSTOMER, SYSTEM, SYSTEM_CTX, type RequestService } from "../requests/service.ts";
import * as repo from "./repo.ts";

const DAY_MS = 86_400_000;
const ACTIVE_SESSION_UQ = "device_bindings_active_session_id_key";
const ENTITY = "device_bindings";
const BATCH = 1000;

const tenantActive = (t: { status: string; deletedAt: Date | null }): boolean => t.status === "ACTIVE" && t.deletedAt === null;

/** Kullanım koşulları (§3.4): tenant aktif, müşteri yok ya da aktif, son kullanımdan saklama süresi geçmemiş, ayar satırı var. */
function usable(row: repo.BindingUseRow, now: number): boolean {
  if (!tenantActive(row.tenant) || !row.tenant.requestSettings) return false;
  if (row.customer && row.customer.status !== "ACTIVE") return false;
  const retention = row.tenant.settings?.retentionDays ?? 365;
  return row.lastUsedAt.getTime() > now - retention * DAY_MS;
}

/** Anahtar → kullanılabilir kayıt; biçim dışı / yok / geçersiz → null (neden ayırt edilmez, §5.2). */
export async function resolveUsable(svc: RequestService, key: unknown): Promise<{ row: repo.BindingUseRow; keyHash: string } | null> {
  if (!bindingKeySchema.safeParse(key).success) return null;
  const keyHash = sha256Hex(key as string);
  const row = await repo.findActiveByHash(svc.d.db, keyHash);
  return row && usable(row, svc.d.clock.now()) ? { row, keyHash } : null;
}

/** Tek 404 `BINDING_INVALID`; geçersiz ref ile aynı `req.ref_invalid` kovası (ipKey 10/dk) + metrikler. */
export function bindingInvalid(svc: RequestService, ip: string): AppError {
  svc.d.metrics.inc("rs_binding_invalid_total");
  const e = svc.refInvalid(ip);
  return e.code === "RATE_LIMITED" ? e : new AppError("BINDING_INVALID");
}

/** POST /public/bindings/status (AC-182, 185). `last_used_at` değişmez (K21). */
export async function bindingStatus(svc: RequestService, ctx: AuditContext, body: unknown): Promise<BindingInfo> {
  const ip = ipKey(ctx.ip);
  svc.assertRefNotBlocked(ip);
  // B-P8c-5 (§5.2): biçim dışı anahtar da aynı 404 + `req.ref_invalid` kovası; yalnız `clientVersion` hatası 400 kalır.
  const rawKey = typeof body === "object" && body !== null ? (body as { bindingKey?: unknown }).bindingKey : undefined;
  if (!bindingKeySchema.safeParse(rawKey).success) throw bindingInvalid(svc, ip);
  const input = parseInput(bindingStatusInputSchema, body);
  if (isOutdated(input.clientVersion, svc.d.env.MIN_AGENT_VERSION)) throw outdated(svc.d.env.MIN_AGENT_VERSION);
  const b = await resolveUsable(svc, input.bindingKey);
  if (!b) throw bindingInvalid(svc, ip);
  await svc.limit(ctx, b.row.tenantId, "bindingStatus", "binding.status", "ip", ip);
  const info = await svc.requestInfo(b.row.tenantId, b.row.tenant, b.row.tenant.requestSettings?.waitMinutes ?? 30);
  return { ...info, customer: b.row.customer ? { name: b.row.customer.name } : null };
}

/** POST /public/bindings/revoke (AC-186): her durumda 204; etkin satır düştüyse audit `binding.revoked{FORGOTTEN}`. */
export async function bindingRevoke(svc: RequestService, ctx: AuditContext, body: unknown): Promise<void> {
  await svc.limit(ctx, null, "bindingRevoke", "binding.revoke", "ip", ipKey(ctx.ip));
  const parsed = bindingRevokeInputSchema.safeParse(body ?? {});
  if (!parsed.success) return; // oracle yok: biçim dışı da 204
  const keyHash = sha256Hex(parsed.data.bindingKey);
  const now = new Date(svc.d.clock.now());
  const done = await svc.d.db.$transaction(async (tx) => {
    const row = await tx.deviceBinding.findFirst({ where: { keyHash, revokedAt: null }, select: { id: true, tenantId: true } });
    if (!row || (await repo.revokeById(tx, row.id, row.tenantId, "FORGOTTEN", now)) === 0) return false;
    await writeAudit(tx, ctx, { tenantId: row.tenantId, ...CUSTOMER, action: BINDING_AUDIT.REVOKED, entity: ENTITY, entityId: row.id, result: "success", newValue: { reason: "FORGOTTEN" } });
    return true;
  });
  if (done) svc.d.metrics.inc("rs_bindings_revoked_total", { reason: "FORGOTTEN" });
}

// ------------------------------------------------------------------ verme (WS binding.request)

/** Ret nedeni yalnız sunucuda (audit `binding.denied{reason}` + `rs_binding_denied_total{reason}`); istemciye tek mesaj. */

class Denied extends Error {
  readonly reason: "stale_source" | "inactive";
  readonly requestId: string | null;
  constructor(reason: "stale_source" | "inactive", requestId: string | null = null) {
    super("binding_denied");
    this.reason = reason;
    this.requestId = requestId;
  }
}

export type IssueResult = { ok: true; msg: Extract<ServerOutbound, { t: "binding.issued" }> } | { ok: false; message: string };

const sessionSelect = {
  tenantId: true,
  customerId: true,
  requestId: true,
  tenant: { select: { name: true, status: true, deletedAt: true, requestSettings: { select: { refRotatedAt: true } } } },
  customer: { select: { name: true } },
  request: { select: { createdAt: true, bindingId: true, binding: { select: { revokedAt: true } }, customer: { select: { refRotatedAt: true } } } },
} as const;

/**
 * Verme TX'i (§3.4 + §15.1 bayat kaynak + §15.3 adım sırası + §15.4 müşteri ataması). Kabul koşulları: oturum ACTIVE +
 * mode AGENT, tenant aktif, oturumun müşterisi varsa aktif (satır FOR SHARE → eşzamanlı pasife alma bekler).
 * UQ(active_session_id) ihlali ya da kilitlenme (eşzamanlı iki istek) → TX bir kez yeniden denenir.
 */
export async function issueBinding(svc: RequestService, ctx: AuditContext, a: { sessionId: string; clientVersion: string; previousKey?: string | undefined }): Promise<IssueResult> {
  const head = await svc.d.db.supportSession.findFirst({ where: { id: a.sessionId }, select: { tenantId: true } });
  if (!head) {
    svc.d.metrics.inc("rs_binding_denied_total", { reason: "inactive" });
    return { ok: false, message: BINDING_DENIED_MESSAGE };
  }
  await ensureSettings(svc, head.tenantId); // Genel/müşteri kayıtla talep TX'i ayar satırını kilitler (§3.4 (2))
  for (let attempt = 1; ; attempt++) {
    try {
      return await issueTx(svc, ctx, a);
    } catch (err) {
      if (err instanceof Denied) {
        // B-P8c-4: her ret nedeni audit + metrik (oturum başına en çok 3 istek → audit seli yok).
        svc.d.metrics.inc("rs_binding_denied_total", { reason: err.reason });
        await writeAudit(svc.d.db, ctx, { tenantId: head.tenantId, ...CUSTOMER, action: BINDING_AUDIT.DENIED, entity: ENTITY, result: "fail", newValue: { reason: err.reason, ...(err.requestId ? { requestId: err.requestId } : {}) } });
        return { ok: false, message: BINDING_DENIED_MESSAGE };
      }
      // Eşzamanlı iki istek: ikisi de yok olan `active_session_id` aralığını FOR UPDATE ile kilitleyip INSERT eder →
      // UQ ihlali ya da InnoDB gap-lock kilitlenmesi (1213). İkisinde de bir kez yeniden denenir; ikinci denemede §15.3
      // adım 3 (cur) çalışır.
      if (attempt < 2 && (conflictIndex(err) === ACTIVE_SESSION_UQ || isTransientDbError(err))) continue;
      throw err;
    }
  }
}

async function issueTx(svc: RequestService, ctx: AuditContext, a: { sessionId: string; clientVersion: string; previousKey?: string | undefined }): Promise<IssueResult> {
  const { db } = svc.d;
  const key = newBindingKey();
  const keyHash = sha256Hex(key);
  const out = await db.$transaction(async (tx) => {
    const now = new Date(svc.d.clock.now());
    const s = await tx.supportSession.findFirst({ where: { id: a.sessionId, status: "ACTIVE", mode: "AGENT" }, select: sessionSelect });
    if (!s || !tenantActive(s.tenant)) throw new Denied("inactive");
    // Durum kilitli okumanın kendisinden (anlık görüntü değil): eşzamanlı pasife alma commit'i kaçmaz (B-P8c-1).
    if (s.customerId && (await crepo.shareStatus(tx, s.tenantId, s.customerId)) !== "ACTIVE") throw new Denied("inactive");
    // §15.1 bayat kaynak: talepten doğan oturum. Kod yolu (requestId NULL) muaf.
    if (s.requestId && s.request) {
      const r = s.request;
      const stale = r.bindingId
        ? r.binding?.revokedAt !== null
        : r.createdAt.getTime() < ((r.customer ? r.customer.refRotatedAt : s.tenant.requestSettings?.refRotatedAt)?.getTime() ?? 0);
      if (stale) throw new Denied("stale_source", s.requestId);
    }

    // §15.3 adım 1–2
    const cur = await repo.lockActiveOfSession(tx, a.sessionId);
    const prev = !cur && a.previousKey ? await repo.lockActiveByHash(tx, sha256Hex(a.previousKey)) : null;
    const target = cur ?? (prev && prev.tenantId === s.tenantId ? prev : null);
    let bindingId: string;
    let customerId: string | null = s.customerId;
    let replaced: { id: string; tenantId: string } | null = null;
    if (target) {
      // §15.4: müşterisiz oturum aynı tenant kaydının müşteri bağını korur (müşteri hâlâ aktifse).
      if (!s.customerId && target.customerId) {
        customerId = (await crepo.shareStatus(tx, s.tenantId, target.customerId)) === "ACTIVE" ? target.customerId : null;
      }
      await repo.renew(tx, target.id, { keyHash, customerId, sessionId: a.sessionId, clientVersion: a.clientVersion, now });
      bindingId = target.id;
    } else {
      if (prev) {
        // §15.3 adım 5 + G-E10-4: başka tenant'ın kaydı REPLACED; karşı tenant kimliği hiçbir tarafta yazılmaz.
        await repo.revokeById(tx, prev.id, prev.tenantId, "REPLACED", now);
        await writeAudit(tx, ctx, { tenantId: prev.tenantId, ...CUSTOMER, action: BINDING_AUDIT.REVOKED, entity: ENTITY, entityId: prev.id, result: "success", newValue: { reason: "REPLACED" } });
        replaced = prev;
      }
      bindingId = newId();
      await repo.insertBinding(tx, { id: bindingId, tenantId: s.tenantId, customerId, keyHash, sessionId: a.sessionId, clientVersion: a.clientVersion, now });
    }
    const renewed = target !== null;
    await writeAudit(tx, ctx, {
      tenantId: s.tenantId,
      ...CUSTOMER,
      action: BINDING_AUDIT.ISSUED,
      entity: ENTITY,
      entityId: bindingId,
      result: "success",
      newValue: { customerId, renewed, replacedOtherTenant: replaced !== null },
    });
    const firm = customerId ? (customerId === s.customerId ? (s.customer?.name ?? null) : ((await tx.customer.findUnique({ where: { id: customerId }, select: { name: true } }))?.name ?? null)) : null;
    return { renewed, replaced, tenantName: s.tenant.name, firm };
  }, REQUEST_TX_OPTIONS);
  svc.d.metrics.inc("rs_bindings_issued_total", { renewed: String(out.renewed) });
  if (out.replaced) svc.d.metrics.inc("rs_bindings_revoked_total", { reason: "REPLACED" });
  return { ok: true, msg: { t: "binding.issued", bindingKey: key, tenantName: out.tenantName.slice(0, 120), customerFirmName: out.firm?.slice(0, 100) ?? null, renewed: out.renewed } };
}

// ------------------------------------------------------------------ panel: tek kayıt iptali (§15.2)

/** POST /support-requests/:id/revoke-binding (G-E10-2): kayıt talebin `binding_id`'sinden; istemciden kimlik alınmaz. */
export async function revokeRequestBinding(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string, requestId: string): Promise<void> {
  await svc.limit(ctx, tenantId, "customersWrite", "customers.write", "user", auth.user.id);
  const now = new Date(svc.d.clock.now());
  const cancelled = await svc.d.db.$transaction(async (tx) => {
    const r = await tx.supportRequest.findFirst({ where: { id: requestId, tenantId }, select: { bindingId: true } });
    if (!r?.bindingId) throw new AppError("NOT_FOUND");
    if ((await repo.revokeById(tx, r.bindingId, tenantId, "ADMIN_REVOKED", now)) === 0) throw new AppError("CONFLICT", { message: "Bu bilgisayarın kaydı zaten geçersiz." });
    const ids: string[] = [];
    for (const p of await repo.pendingOfBinding(tx, tenantId, r.bindingId)) {
      if ((await rrepo.cancelPending(tx, p.id, "BINDING_REVOKED", now)) === 0) continue;
      ids.push(p.id);
      await writeAudit(tx, ctx, { tenantId, userId: auth.user.id, username: auth.user.email, action: "request.cancelled", entity: "support_requests", entityId: p.id, result: "success", oldValue: { status: "PENDING" }, newValue: { status: "CANCELLED", reason: "BINDING_REVOKED" } });
    }
    await writeAudit(tx, ctx, { tenantId, userId: auth.user.id, username: auth.user.email, action: BINDING_AUDIT.REVOKED, entity: ENTITY, entityId: r.bindingId, result: "success", newValue: { reason: "ADMIN_REVOKED", requestId, cancelledRequests: ids.length } });
    return ids;
  });
  svc.d.metrics.inc("rs_bindings_revoked_total", { reason: "ADMIN_REVOKED" });
  for (const id of cancelled) await svc.closedAfterCommit(tenantId, id, "CANCELLED", { reason: "BINDING_REVOKED" });
}

/** Toplu geçersizleştirme metriği (çağıran TX commit'inden sonra). */
export function countRevoked(svc: RequestService, reason: BindingRevokeReason, n: number): void {
  if (n > 0) svc.d.metrics.inc("rs_bindings_revoked_total", { reason }, n);
}

// ------------------------------------------------------------------ işler

/** Pasif tenant'ın etkin kayıtları → TENANT_PASSIVE (P9 `revokeForTenant` + 30 sn süpürücü yedeği). Tenant başına tek özet audit. */
export async function revokeForTenant(svc: RequestService, tenantId: string): Promise<number> {
  let total = 0;
  const now = new Date(svc.d.clock.now());
  for (;;) {
    const n = await repo.revokeForTenant(svc.d.db, tenantId, now, BATCH);
    total += n;
    if (n < BATCH) break;
  }
  if (total > 0) {
    await writeAudit(svc.d.db, SYSTEM_CTX, { tenantId, ...SYSTEM, action: BINDING_AUDIT.REVOKED, entity: ENTITY, result: "success", newValue: { reason: "TENANT_PASSIVE", count: total } });
    countRevoked(svc, "TENANT_PASSIVE", total);
  }
  return total;
}

export async function sweepPassiveTenantBindings(svc: RequestService): Promise<number> {
  let n = 0;
  for (const t of await repo.passiveTenantsWithBindings(svc.d.db, 100)) n += await revokeForTenant(svc, t);
  return n;
}

/** Günlük 03:30 (V28): son kullanımdan tenant `retention_days` geçmiş etkin kayıtlar → EXPIRED; tenant başına özet audit. */
export async function expireIdleBindings(svc: RequestService, now = new Date(svc.d.clock.now())): Promise<number> {
  let total = 0;
  for (const t of await rrepo.retentionTenants(svc.d.db)) {
    const cutoff = new Date(now.getTime() - t.retentionDays * DAY_MS);
    let n = 0;
    for (;;) {
      const k = await repo.expireIdle(svc.d.db, t.tenantId, cutoff, now, BATCH);
      n += k;
      if (k < BATCH) break;
    }
    if (n > 0) await writeAudit(svc.d.db, SYSTEM_CTX, { tenantId: t.tenantId, ...SYSTEM, action: BINDING_AUDIT.REVOKED, entity: ENTITY, result: "success", newValue: { reason: "EXPIRED", count: n } });
    total += n;
  }
  countRevoked(svc, "EXPIRED", total);
  return total;
}
