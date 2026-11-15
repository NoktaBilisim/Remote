// Bilgisayar kaydı verme TX gövdesi (service.ts `issueTx`'ten taşındı ve bölündü, PT-K12; mimari-e10 §3.4, §15.1–15.4,
// P20 §8d.2). Adım ve kilit sırası aynen: oturum → müşteri FOR SHARE → bayat kaynak → oturumun etkin kaydı FOR UPDATE →
// (çoklu dal: tenant satırları FOR UPDATE + fazlası REPLACED | tekli: önceki anahtar FOR UPDATE) → yenile/INSERT → audit.
import { BINDING_AUDIT } from "@remote/contracts/audit";
import type { ServerOutbound } from "@remote/contracts/ws";
import { BINDING_DENIED_MESSAGE } from "@remote/contracts/api/bindings";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { newId, sha256Hex } from "../lib/ids.ts";
import * as crepo from "../customers/repo.ts";
import { CUSTOMER, type RequestService } from "../requests/service.ts";
import * as repo from "./repo.ts";

type Tx = Prisma.TransactionClient;

export const ENTITY = "device_bindings";

export const tenantActive = (t: { status: string; deletedAt: Date | null }): boolean => t.status === "ACTIVE" && t.deletedAt === null;

/** Ret nedeni yalnız sunucuda (audit `binding.denied{reason}` + `rs_binding_denied_total{reason}`); istemciye tek mesaj. */
export class Denied extends Error {
  readonly reason: "stale_source" | "inactive" | "capacity";
  readonly requestId: string | null;
  constructor(reason: "stale_source" | "inactive" | "capacity", requestId: string | null = null) {
    super("binding_denied");
    this.reason = reason;
    this.requestId = requestId;
  }
}

export type IssueResult =
  { ok: true; msg: Extract<ServerOutbound, { t: "binding.issued" }> } | { ok: false; code: "CONFLICT" | "BINDING_LIMIT"; message: string };

/** WS `binding.request` girdisi. `previousKeys` (P20 çoklu dal) ile `previousKey` (eski dal) birlikte gelmez (şema). */
export type IssueInput = {
  sessionId: string;
  clientVersion: string;
  previousKey?: string | undefined;
  previousKeys?: readonly string[] | undefined;
  full?: boolean | undefined;
};
export const denied = { ok: false, code: "CONFLICT", message: BINDING_DENIED_MESSAGE } as const;

const sessionSelect = {
  tenantId: true,
  customerId: true,
  requestId: true,
  tenant: { select: { name: true, status: true, deletedAt: true, requestSettings: { select: { refRotatedAt: true } } } },
  customer: { select: { name: true } },
  request: {
    select: { createdAt: true, bindingId: true, binding: { select: { revokedAt: true } }, customer: { select: { refRotatedAt: true } } },
  },
} as const;
type SessionRow = Prisma.SupportSessionGetPayload<{ select: typeof sessionSelect }>;

/** Kabul koşulları: oturum ACTIVE + AGENT, tenant aktif, müşteri (FOR SHARE) aktif, §15.1 bayat kaynak değil. */
async function admitSession(tx: Tx, a: IssueInput): Promise<SessionRow> {
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
  return s;
}

const revokedAudit = (tenantId: string, id: string) =>
  ({
    tenantId,
    ...CUSTOMER,
    action: BINDING_AUDIT.REVOKED,
    entity: ENTITY,
    entityId: id,
    result: "success",
    newValue: { reason: "REPLACED" },
  }) as const;

interface Picked {
  target: repo.IssueRow | null;
  prev: repo.IssueRow | null;
  sameTenantReplaced: number;
}

/** P20 çoklu dal (§8d.2, S-P20-4): yalnız oturum tenant'ının satırları; başka tenant'ın satırı asla iptal edilmez. */
async function pickMulti(
  tx: Tx,
  ctx: AuditContext,
  s: SessionRow,
  a: IssueInput,
  cur: repo.IssueRow | null,
  hashes: string[],
  now: Date,
): Promise<Picked> {
  const mine = cur ? [] : await repo.lockActiveByHashesForTenant(tx, s.tenantId, hashes);
  const target = cur ?? mine[0] ?? null;
  if (!target && a.full) throw new Denied("capacity");
  let sameTenantReplaced = 0;
  for (const r of mine.slice(1)) {
    // §8d.2 adım 4: aynı tenant fazlası REPLACED (aynı tenant; karşı tenant bilgisi yok).
    if ((await repo.revokeById(tx, r.id, s.tenantId, "REPLACED", now)) === 0) continue;
    sameTenantReplaced++;
    await writeAudit(tx, ctx, revokedAudit(s.tenantId, r.id));
  }
  return { target, prev: null, sameTenantReplaced };
}

/** §15.3 adım 1–2: oturumun etkin kaydı, yoksa önceki anahtar(lar)ın kaydı. */
async function pickTarget(
  tx: Tx,
  ctx: AuditContext,
  s: SessionRow,
  a: IssueInput,
  hashes: string[] | undefined,
  now: Date,
): Promise<Picked> {
  const cur = await repo.lockActiveOfSession(tx, a.sessionId);
  if (hashes) return pickMulti(tx, ctx, s, a, cur, hashes, now);
  const prev = !cur && a.previousKey ? await repo.lockActiveByHash(tx, sha256Hex(a.previousKey)) : null;
  return { target: cur ?? (prev && prev.tenantId === s.tenantId ? prev : null), prev, sameTenantReplaced: 0 };
}

/** Hedef varsa yenile (§15.4 müşteri bağı), yoksa başka tenant'ın önceki kaydını REPLACED yapıp yeni satır ekle. */
async function writeBinding(
  tx: Tx,
  ctx: AuditContext,
  s: SessionRow,
  a: IssueInput,
  p: Picked,
  keyHash: string,
  now: Date,
): Promise<{ bindingId: string; customerId: string | null; replaced: { id: string; tenantId: string } | null }> {
  let customerId: string | null = s.customerId;
  const { target, prev } = p;
  if (target) {
    // §15.4: müşterisiz oturum aynı tenant kaydının müşteri bağını korur (müşteri hâlâ aktifse).
    if (!s.customerId && target.customerId) {
      customerId = (await crepo.shareStatus(tx, s.tenantId, target.customerId)) === "ACTIVE" ? target.customerId : null;
    }
    await repo.renew(tx, target.id, { keyHash, customerId, sessionId: a.sessionId, clientVersion: a.clientVersion, now });
    return { bindingId: target.id, customerId, replaced: null };
  }
  if (prev) {
    // §15.3 adım 5 + G-E10-4: başka tenant'ın kaydı REPLACED; karşı tenant kimliği hiçbir tarafta yazılmaz.
    await repo.revokeById(tx, prev.id, prev.tenantId, "REPLACED", now);
    await writeAudit(tx, ctx, revokedAudit(prev.tenantId, prev.id));
  }
  const bindingId = newId();
  await repo.insertBinding(tx, {
    id: bindingId,
    tenantId: s.tenantId,
    customerId,
    keyHash,
    sessionId: a.sessionId,
    clientVersion: a.clientVersion,
    now,
  });
  return { bindingId, customerId, replaced: prev };
}

async function firmNameOf(tx: Tx, s: SessionRow, customerId: string | null): Promise<string | null> {
  return customerId
    ? customerId === s.customerId
      ? (s.customer?.name ?? null)
      : ((await tx.customer.findUnique({ where: { id: customerId }, select: { name: true } }))?.name ?? null)
    : null;
}

interface IssueOutcome {
  renewed: boolean;
  replaced: number;
  tenantName: string;
  firm: string | null;
  previousIndex: number | undefined;
}

/** Verme TX gövdesi (çağıranın TX'inde; yeniden deneme `issueBinding`'de). */
export async function issueWrite(
  svc: RequestService,
  tx: Tx,
  ctx: AuditContext,
  a: IssueInput,
  keyHash: string,
  hashes: string[] | undefined,
): Promise<IssueOutcome> {
  const now = new Date(svc.d.clock.now());
  const s = await admitSession(tx, a);
  const p = await pickTarget(tx, ctx, s, a, hashes, now);
  const { target } = p;
  const previousIndex = hashes ? (target?.keyHash ? hashes.indexOf(target.keyHash) : -1) : undefined;
  const { bindingId, customerId, replaced } = await writeBinding(tx, ctx, s, a, p, keyHash, now);
  const renewed = target !== null;
  await writeAudit(tx, ctx, {
    tenantId: s.tenantId,
    ...CUSTOMER,
    action: BINDING_AUDIT.ISSUED,
    entity: ENTITY,
    entityId: bindingId,
    result: "success",
    newValue: { customerId, renewed, replacedOtherTenant: replaced !== null, ...(hashes ? { multi: true } : {}) },
  });
  const firm = await firmNameOf(tx, s, customerId);
  return { renewed, replaced: (replaced ? 1 : 0) + p.sameTenantReplaced, tenantName: s.tenant.name, firm, previousIndex };
}
