// support_sessions erişimi. Tenant kapsamı her teknisyen sorgusunda zorunlu (AC-69); USER kapsamı
// (technicianId) burada uygulanır (AC-61, G-22). PENDING'den çıkan her UPDATE aynı ifadede
// activeCode=null + endedAt yazar (CHECK, db-notlari P2) ve status='PENDING' koşuluyla yarışa güvenlidir.
import type { SessionStatus } from "@remote/contracts/api/sessions";
import { DEFAULT_MAX_FILE_MB } from "@remote/contracts/dc";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

export interface SessionScope {
  tenantId: string;
  /** Doluysa yalnız bu teknisyenin oturumları (USER rolü). */
  technicianId?: string;
}

const viewSelect = {
  id: true,
  status: true,
  activeCode: true,
  techVerifyCode: true,
  createdAt: true,
  expiresAt: true,
  endedAt: true,
  endedBy: true,
  endReason: true,
  technician: { select: { id: true, fullName: true } },
} as const;

export type SessionRow = Prisma.SupportSessionGetPayload<{ select: typeof viewSelect }>;

const scopeWhere = (s: SessionScope): Prisma.SupportSessionWhereInput => ({
  tenantId: s.tenantId,
  ...(s.technicianId ? { technicianId: s.technicianId } : {}),
});

/** Açık oturum sayımı + oluşturma yarışını teknisyen satırında serileştirir (AC-11). */
export async function lockTechnician(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

export function sessionSettings(db: DbOrTx, tenantId: string) {
  return db.tenantSettings.findUnique({ where: { tenantId }, select: { sessionTtlMin: true, maxOpenSessions: true } });
}

/** Açık = ACTIVE ya da süresi dolmamış PENDING; iş henüz süpürmediyse dolmuş PENDING sayılmaz (AC-11, QA-P2-3). */
export function countOpen(db: DbOrTx, technicianId: string, now: Date): Promise<number> {
  return db.supportSession.count({
    where: { technicianId, OR: [{ status: "ACTIVE" }, { status: "PENDING", expiresAt: { gt: now } }] },
  });
}

/** Son pencerede oluşturulanlar: sayı + en eskisi (Retry-After hesabı, AC-12). */
export async function createdSince(db: DbOrTx, technicianId: string, since: Date) {
  const where = { technicianId, createdAt: { gt: since } };
  const [count, oldest] = await Promise.all([
    db.supportSession.count({ where }),
    db.supportSession.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return { count, oldest: oldest?.createdAt ?? null };
}

export async function insertSession(db: DbOrTx, data: Prisma.SupportSessionUncheckedCreateInput): Promise<void> {
  await db.supportSession.create({ data, select: { id: true } });
}

export function findInScope(db: DbOrTx, scope: SessionScope, id: string): Promise<SessionRow | null> {
  return db.supportSession.findFirst({ where: { ...scopeWhere(scope), id }, select: viewSelect });
}

export async function listInScope(
  db: DbOrTx,
  scope: SessionScope,
  filter: { status?: SessionStatus; technicianId?: string },
  page: { skip: number; take: number },
): Promise<{ rows: SessionRow[]; total: number }> {
  const where: Prisma.SupportSessionWhereInput = {
    ...(filter.technicianId ? { technicianId: filter.technicianId } : {}),
    ...scopeWhere(scope), // kapsam filtreyi ezer
    ...(filter.status ? { status: filter.status } : {}),
  };
  const [rows, total] = await Promise.all([
    db.supportSession.findMany({ where, select: viewSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...page }),
    db.supportSession.count({ where }),
  ]);
  return { rows, total };
}

/** PENDING ve süresi dolmamışsa iptal; count 0 → çağıran 404/409 ayırır. */
export async function cancelPending(db: DbOrTx, scope: SessionScope, id: string, now: Date): Promise<number> {
  const r = await db.supportSession.updateMany({
    where: { ...scopeWhere(scope), id, status: "PENDING", expiresAt: { gt: now } },
    data: { status: "CANCELLED", activeCode: null, endedAt: now, endedBy: "TECH", endReason: "cancelled" },
  });
  return r.count;
}

/** Tek oturumu süresi dolmuşsa EXPIRED yapar (iş ve resolve yolu, AC-5). */
export async function expireOne(db: DbOrTx, id: string, now: Date): Promise<number> {
  const r = await db.supportSession.updateMany({
    where: { id, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", activeCode: null, endedAt: now, endedBy: "SYSTEM", endReason: "expired" },
  });
  return r.count;
}

export function findExpiredPending(db: DbOrTx, now: Date, take: number) {
  return db.supportSession.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, tenantId: true },
    orderBy: { expiresAt: "asc" },
    take,
  });
}

const publicSelect = {
  id: true,
  tenantId: true,
  status: true,
  expiresAt: true,
  techVerifyCode: true,
  tenant: { select: { name: true } },
  technician: { select: { fullName: true } },
} as const;

export type PublicSessionRow = Prisma.SupportSessionGetPayload<{ select: typeof publicSelect }>;

export function findByTokenHash(db: DbOrTx, tokenHash: string): Promise<PublicSessionRow | null> {
  return db.supportSession.findUnique({ where: { tokenHash }, select: publicSelect });
}

export function findByActiveCode(db: DbOrTx, activeCode: string): Promise<PublicSessionRow | null> {
  return db.supportSession.findUnique({ where: { activeCode }, select: publicSelect });
}

export function findStatus(db: DbOrTx, id: string) {
  return db.supportSession.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true, expiresAt: true } });
}

// --- P3: admit tüketimi ve ACTIVE oturum bitişi (mimari-protokol §3.2, db-notlari P3) ---

/**
 * Tüketim — tek atomik koşullu UPDATE (P3 giriş şartı 2). WHERE `expiresAt > now` ile SET `consumedAt = now`
 * aynı değer (consumed_before_expiry_chk). count 0 → iptal/süre dolumu/başka admit kazandı.
 */
export async function consumeForAdmit(db: DbOrTx, id: string, now: Date, mode: "BROWSER" | "AGENT"): Promise<number> {
  const r = await db.supportSession.updateMany({
    where: { id, status: "PENDING", expiresAt: { gt: now }, consumedAt: null },
    data: { status: "ACTIVE", consumedAt: now, activeCode: null, mode },
  });
  return r.count;
}

export async function endActive(db: DbOrTx, id: string, now: Date, endedBy: "TECH" | "CUSTOMER" | "SYSTEM", endReason: string): Promise<number> {
  const r = await db.supportSession.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now, endedBy, endReason } });
  return r.count;
}

/** Zorla sonlandırma (A5, AC-114): tenant kapsamlı; ADMIN ⇔ terminated_by (terminated_by_chk). */
export async function terminateActive(db: DbOrTx, tenantId: string, id: string, now: Date, actorId: string): Promise<number> {
  const r = await db.supportSession.updateMany({
    where: { id, tenantId, status: "ACTIVE" },
    data: { status: "ENDED", endedAt: now, endedBy: "ADMIN", endReason: "admin", terminatedBy: actorId },
  });
  return r.count;
}

/** Açılışta yarım kalan ACTIVE oturumlar (oda bellekte, süreç yeniden başladı — §3.5, ADR-0005). */
export async function endAllActive(db: DbOrTx, now: Date): Promise<number> {
  const r = await db.supportSession.updateMany({
    where: { status: "ACTIVE" },
    data: { status: "ENDED", endedAt: now, endedBy: "SYSTEM", endReason: "server" },
  });
  return r.count;
}

const signalSelect = {
  id: true,
  tenantId: true,
  technicianId: true,
  status: true,
  expiresAt: true,
  technician: { select: { fullName: true } },
} as const;

export type SignalSessionRow = Prisma.SupportSessionGetPayload<{ select: typeof signalSelect }>;

export function findForSignal(db: DbOrTx, id: string): Promise<SignalSessionRow | null> {
  return db.supportSession.findUnique({ where: { id }, select: signalSelect });
}

/** ACTIVE oda sınırları: max süre (AC-13) + dosya üst sınırı (AC-53, P5). */
export async function activeLimits(db: DbOrTx, tenantId: string): Promise<{ maxActiveHours: number; maxFileMb: number }> {
  const s = await db.tenantSettings.findUnique({ where: { tenantId }, select: { maxActiveHours: true, maxFileMb: true } });
  return { maxActiveHours: s?.maxActiveHours ?? 4, maxFileMb: s?.maxFileMb ?? DEFAULT_MAX_FILE_MB };
}
