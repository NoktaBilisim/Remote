// support_sessions erişimi. Tenant kapsamı her teknisyen sorgusunda zorunlu (AC-69); USER kapsamı
// (technicianId) burada uygulanır (AC-61, G-22). PENDING'den çıkan her UPDATE aynı ifadede
// activeCode=null + endedAt yazar (CHECK, db-notlari P2) ve status='PENDING' koşuluyla yarışa güvenlidir.
import { DEFAULT_MAX_FILE_MB } from "@remote/contracts/dc";
import type { FileMode } from "@remote/contracts/ws-fsrv";
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

/**
 * Oturum ekleme (tek nokta; üç çağıran: kod/bağlantı, talep kabulü, gözetimsiz). P28b (AC-355, K-P28b-3): `file_mode` aynı
 * TX'te tenant ayarından BİR KEZ yazılır; açılış yolundan bağımsız, sonra değişmez (UPDATE grant'ı yok). Çağıranın değeri yok sayılır.
 */
export async function insertSession(db: DbOrTx, data: Prisma.SupportSessionUncheckedCreateInput): Promise<void> {
  const s = await db.tenantSettings.findUnique({ where: { tenantId: data.tenantId }, select: { fileServerMode: true } });
  await db.supportSession.create({ data: { ...data, fileMode: s?.fileServerMode ? "SERVER" : "P2P" }, select: { id: true } });
}

/** P28b (AC-355): admit anında odanın dosya modu — oturum satırındaki sabit değer (tenant ayarı DEĞİL). */
export async function sessionFileMode(db: DbOrTx, id: string): Promise<FileMode> {
  const r = await db.supportSession.findUnique({ where: { id }, select: { fileMode: true } });
  return r?.fileMode === "SERVER" ? "SERVER" : "P2P";
}

export function findInScope(db: DbOrTx, scope: SessionScope, id: string): Promise<SessionRow | null> {
  return db.supportSession.findFirst({ where: { ...scopeWhere(scope), id }, select: viewSelect });
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
    where: { id, status: "PENDING", expiresAt: { lte: now }, requestId: null },
    data: { status: "EXPIRED", activeCode: null, endedAt: now, endedBy: "SYSTEM", endReason: "expired" },
  });
  return r.count;
}

export function findExpiredPending(db: DbOrTx, now: Date, take: number) {
  return db.supportSession.findMany({
    where: { status: "PENDING", expiresAt: { lte: now }, requestId: null }, // P8b: talep oturumu → talep süpürücüsü (connect_timeout)
    select: { id: true, tenantId: true },
    orderBy: { expiresAt: "asc" },
    take,
  });
}

const publicSelect = {
  id: true,
  tenantId: true,
  requestId: true,
  status: true,
  expiresAt: true,
  techVerifyCode: true,
  tenant: { select: { name: true, logoPath: true } },
  technician: { select: { fullName: true, avatarPath: true } }, // P15 (AC-236): imzalı avatar URL'si
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

/** Agent indirme ucu (P6): dosya adı için yalnız PENDING iken dolu olan kısa kod. */
export function findForDownload(db: DbOrTx, id: string) {
  return db.supportSession.findUnique({
    where: { id },
    select: { id: true, tenantId: true, status: true, expiresAt: true, activeCode: true },
  });
}

// --- P3: admit tüketimi ve ACTIVE oturum bitişi (mimari-protokol §3.2, db-notlari P3) ---

/**
 * Tüketim — tek atomik koşullu UPDATE (P3 giriş şartı 2). WHERE `expiresAt > now` ile SET `consumedAt = now`
 * aynı değer (consumed_before_expiry_chk). count 0 → iptal/süre dolumu/başka admit kazandı.
 */
export async function consumeForAdmit(
  db: DbOrTx,
  id: string,
  now: Date,
  mode: "BROWSER" | "AGENT" | "UNATTENDED",
  customer: { name: string | null; email: string | null },
  /** P8b: misafir ağ anahtarları (ikisi birlikte; §13.1, G-E9-15) ve talep oturumunda `AND request_id = :rid` (§5.2). */
  extra: { guestIpKey?: string; guestNetKey?: string; requestId?: string } = {},
): Promise<number> {
  const keys = extra.guestIpKey && extra.guestNetKey ? { guestIpKey: extra.guestIpKey, guestNetKey: extra.guestNetKey } : {};
  const r = await db.supportSession.updateMany({
    where: { id, status: "PENDING", expiresAt: { gt: now }, consumedAt: null, requestId: extra.requestId ?? null },
    // P8: müşteri adı/e-postası aynı atomik UPDATE'te (customer_consumed_chk: yalnız consumed_at ile birlikte).
    data: {
      status: "ACTIVE",
      consumedAt: now,
      activeCode: null,
      mode,
      customerName: customer.name,
      customerEmail: customer.email,
      ...keys,
    },
  });
  return r.count;
}

export async function endActive(
  db: DbOrTx,
  id: string,
  now: Date,
  endedBy: "TECH" | "CUSTOMER" | "SYSTEM",
  endReason: string,
): Promise<number> {
  const r = await db.supportSession.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "ENDED", endedAt: now, endedBy, endReason },
  });
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
