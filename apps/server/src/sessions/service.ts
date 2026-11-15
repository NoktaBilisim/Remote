// Destek oturumu yaşam döngüsü — teknisyen tarafı (P2: AC-1..4, 8, 11, 12, 61 kısmi).
// Oluşturma: teknisyen satırı FOR UPDATE → açık oturum + saatlik sayım → INSERT → audit, tek TX.
// active_code çakışmasında (P2002, index adı) tüm TX yeni kodla en çok 5 kez denenir (ADR-0006).
import type { CustomerStatus } from "@remote/contracts/api/customers";
import type { CreateSessionResponse, SessionEndedBy, SessionStatus, SessionView } from "@remote/contracts/api/sessions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, sha256Hex } from "../lib/ids.ts";
import { isActiveCodeConflict, newSessionCode, newSessionToken, newTechVerifyCode } from "./codes.ts";
import { findHistory, type AllTenantsScope, type HistoryScope } from "./history-repo.ts";
import * as repo from "./repo.ts";

const HOUR_MS = 60 * 60 * 1000;
const HOURLY_CREATE_LIMIT = 20; // AC-12
const CODE_ATTEMPTS = 5;

interface CodeGenerators {
  token: () => string;
  code: () => string;
  verify: () => string;
}
const defaultGen: CodeGenerators = { token: newSessionToken, code: newSessionCode, verify: newTechVerifyCode };

const who = (auth: AuthContext, tenantId: string) => ({ tenantId, userId: auth.user.id, username: auth.user.email });

/** USER yalnız kendi oturumları (AC-61, G-22); ADMIN/SUPER_ADMIN etkin tenant'ın tümü. */
function sessionScope(auth: AuthContext, tenantId: string): repo.SessionScope {
  return auth.user.role === "USER" ? { tenantId, technicianId: auth.user.id } : { tenantId };
}

/**
 * Oturum geçmişi kapsamı (mimari-api "Oturum geçmişi (P8)" §2, AC-61, G-22) — liste, `:id`, `:id/history`, PATCH ve
 * export'un TEK kaynağı. USER: etkin tenant + kendi oturumları; ADMIN: etkin tenant; SUPER_ADMIN: seçili firma ya da
 * (firma seçilmemişse) açık `{ kind: "all" }`. Tüm-tenant değerini yalnız bu fonksiyon üretir.
 */
export function historyScope(auth: AuthContext): HistoryScope {
  const { role, id } = auth.user;
  if (role === "SUPER_ADMIN" && !auth.tenantId) return { kind: "all" } as AllTenantsScope;
  if (!auth.tenantId) throw new AppError("FORBIDDEN");
  return role === "USER" ? { kind: "tenant", tenantId: auth.tenantId, technicianId: id } : { kind: "tenant", tenantId: auth.tenantId };
}

/** `viewerId`: isteği yapan kullanıcı. Katılım kodu yalnız oturumun kendi teknisyenine döner (S8-2). */
export function toView(r: repo.SessionRow, viewerId: string): SessionView {
  return {
    id: r.id,
    status: r.status as SessionStatus,
    code: r.status === "PENDING" && r.technician.id === viewerId ? r.activeCode : null,
    techVerifyCode: r.techVerifyCode,
    technician: { id: r.technician.id, name: r.technician.fullName },
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    endedBy: (r.endedBy as SessionEndedBy | null) ?? null,
    endReason: r.endReason,
  };
}

const sessionLink = (publicBaseUrl: string, token: string): string => `${publicBaseUrl.replace(/\/+$/, "")}/session/${token}`;

export async function createSupportSession(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  publicBaseUrl: string,
  gen: CodeGenerators = defaultGen,
  customerId?: string,
): Promise<CreateSessionResponse> {
  // Teknisyen-tenant eşleşmesi servis katmanında (db-notlari P2): oturum yalnız kendi tenant'ında açılır.
  if (auth.user.tenantId !== tenantId) throw new AppError("FORBIDDEN", { message: "Oturum yalnız kendi firmanızda açılabilir." });
  const technicianId = auth.user.id;
  const token = gen.token();
  for (let attempt = 1; ; attempt++) {
    const code = gen.code();
    try {
      return await db.$transaction(async (tx) => {
        await repo.lockTechnician(tx, technicianId);
        const settings = await repo.sessionSettings(tx, tenantId);
        if (!settings) throw new Error("tenant_settings satırı yok");
        const now = new Date();
        if ((await repo.countOpen(tx, technicianId, now)) >= settings.maxOpenSessions) {
          throw new AppError("OPEN_SESSION_LIMIT");
        }
        const recent = await repo.createdSince(tx, technicianId, new Date(now.getTime() - HOUR_MS));
        if (recent.count >= HOURLY_CREATE_LIMIT) {
          const waitMs = (recent.oldest?.getTime() ?? now.getTime()) + HOUR_MS - now.getTime();
          throw new AppError("RATE_LIMITED", { retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) });
        }
        // P8c (AC-180): müşteri aynı tenant'ın AKTİF müşterisi olmalı (pasif/başka tenant/yok → 404, varlık sızmaz).
        const firm = customerId
          ? await tx.customer.findFirst({
              where: { id: customerId, tenantId, status: "ACTIVE" },
              select: { id: true, name: true, status: true },
            })
          : null;
        if (customerId && !firm) throw new AppError("NOT_FOUND", { message: "Müşteri bulunamadı." });
        const id = newId();
        const expiresAt = new Date(now.getTime() + settings.sessionTtlMin * 60_000); // createdAt ile aynı now (CHECK)
        const techVerifyCode = gen.verify();
        await repo.insertSession(tx, {
          id,
          tenantId,
          technicianId,
          tokenHash: sha256Hex(token),
          activeCode: code,
          techVerifyCode,
          status: "PENDING",
          expiresAt,
          createdAt: now,
          customerId: firm?.id ?? null,
        });
        await writeAudit(tx, ctx, {
          ...who(auth, tenantId),
          action: "session.created",
          entity: "support_sessions",
          entityId: id,
          result: "success",
          newValue: { status: "PENDING", expiresAt: expiresAt.toISOString(), ttlMin: settings.sessionTtlMin, customerId: firm?.id ?? null },
        });
        return {
          id,
          link: sessionLink(publicBaseUrl, token),
          code,
          techVerifyCode,
          expiresAt: expiresAt.toISOString(),
          status: "PENDING" as const,
          customerFirm: firm ? { id: firm.id, name: firm.name, status: firm.status as CustomerStatus } : null,
        };
      });
    } catch (err) {
      if (attempt < CODE_ATTEMPTS && isActiveCodeConflict(err)) continue;
      throw err;
    }
  }
}

/** GET /sessions/:id (konsol özeti, P2 şekli) — kapsam `historyScope` (§2); kapsam dışı/yok → 404. */
export async function getSession(db: Db, auth: AuthContext, id: string): Promise<SessionView> {
  const row = await findHistory(db, historyScope(auth), id);
  if (!row) throw new AppError("NOT_FOUND");
  return toView(row, auth.user.id);
}

/** İptal (AC-8): tek koşullu UPDATE → link ve kod aynı anda geçersiz. Başka tenant/sahiplik → 404, PENDING değil → 409. */
export async function cancelSession(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  rooms?: RoomNotifier,
): Promise<void> {
  const scope = sessionScope(auth, tenantId);
  await db.$transaction(async (tx) => {
    const now = new Date();
    const count = await repo.cancelPending(tx, scope, id, now);
    if (count === 0) {
      const exists = await repo.findInScope(tx, scope, id);
      throw new AppError(exists ? "CONFLICT" : "NOT_FOUND", exists ? { message: "Yalnız bekleyen oturum iptal edilebilir." } : {});
    }
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: "session.cancelled",
      entity: "support_sessions",
      entityId: id,
      result: "success",
      oldValue: { status: "PENDING" },
      newValue: { status: "CANCELLED" },
    });
  });
  rooms?.closeSession(id, "cancelled"); // lobi/ticket misafirlerine session.ended{cancelled} (A4)
}

/** PENDING + süresi dolmuş tek oturumu EXPIRED/SYSTEM yapar ve audit yazar; başka süreç önce davrandıysa false. */
export async function expireSession(db: Db, ctx: AuditContext, s: { id: string; tenantId: string }, now: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    if ((await repo.expireOne(tx, s.id, now)) === 0) return false;
    await writeAudit(tx, ctx, {
      tenantId: s.tenantId,
      username: "system",
      action: "session.expired",
      entity: "support_sessions",
      entityId: s.id,
      result: "success",
      oldValue: { status: "PENDING" },
      newValue: { status: "EXPIRED" },
    });
    return true;
  });
}

/**
 * Expiry işi gövdesi (jobs/scheduler.ts): bir turda en çok `batch` oturum. Dönen: EXPIRED yapılan sayı.
 * Commit sonrası oda (teknisyen + lobi) `session.ended{timeout}` ile kapatılır ve bellekten silinir (S-P3-4).
 */
export async function expireDue(db: Db, ctx: AuditContext, now: Date, rooms?: RoomNotifier, batch = 500): Promise<number> {
  let done = 0;
  for (const s of await repo.findExpiredPending(db, now, batch)) {
    if (!(await expireSession(db, ctx, s, now))) continue;
    done++;
    rooms?.closeSession(s.id, "timeout");
  }
  return done;
}

/** Oda bildirimi (signaling/rooms.ts); servis yalnız bu dar arayüzü bilir. */
export interface RoomNotifier {
  closeSession(sessionId: string, reason: "cancelled" | "admin" | "timeout"): void;
}

/**
 * Zorla sonlandırma (A5, AC-114, G-04): tek koşullu UPDATE + audit aynı TX; commit sonrası iki tarafa
 * `session.ended{admin}`. Başka tenant → 404, ACTIVE değil → 409.
 */
export async function terminateSession(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  reason: string | undefined,
  rooms?: RoomNotifier,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const now = new Date();
    if ((await repo.terminateActive(tx, tenantId, id, now, auth.user.id)) === 0) {
      const exists = await repo.findInScope(tx, { tenantId }, id);
      throw new AppError(exists ? "CONFLICT" : "NOT_FOUND", exists ? { message: "Yalnız etkin oturum sonlandırılabilir." } : {});
    }
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: "session.terminated",
      entity: "support_sessions",
      entityId: id,
      result: "success",
      oldValue: { status: "ACTIVE" },
      newValue: { status: "ENDED", endedBy: "ADMIN", ...(reason ? { reason } : {}) },
    });
  });
  rooms?.closeSession(id, "admin");
}

/** Açılış: bellekteki odası kaybolan ACTIVE oturumlar ENDED{server} (mimari §3.5). Dönen: sayı. */
export async function endOrphanedActive(db: Db, now: Date): Promise<number> {
  return repo.endAllActive(db, now);
}
