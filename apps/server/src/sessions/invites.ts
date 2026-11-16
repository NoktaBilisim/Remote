// P28c davet + İzle servisi (mimari-p28c r2 §4.1–§4.3; AC-364, 365, 368, 372; D-PC-3, D-PC-7, O-PC-1). Davet tablosu bellekte
// (oda başına), 2 dk zamanlayıcı, tek kullanımlık kabul. Uygunluk koşulları yalnız `eligibleToJoin`'dan (§4.3 tek kaynak).
import { randomBytes } from "node:crypto";
import {
  INVITE_CANDIDATES_MAX,
  type ActiveSessionItem,
  type ActiveSessionsResponse,
  type CreateInviteResponse,
  type IncomingInvitesResponse,
  type OutgoingInvitesResponse,
  type InviteCandidatesResponse,
  type JoinSessionAsMemberResponse,
} from "@remote/contracts/api/multi";
import { INVITE_TTL_MS, MAX_TECHS } from "@remote/contracts/ws-multi";
import type { MultiAuditAction } from "@remote/contracts/audit";
import { STEP_UP_MAX_AGE_SEC } from "@remote/contracts/api/auth";
import type { AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { reserveMember } from "../signaling/member-life.ts";
import { guestMulti, seatsUsed } from "../signaling/members.ts";
import { roomCmdLimited } from "../signaling/member-cmds.ts";
import { auditMulti, countInvite, failAuditAllowed, MULTI_AUDIT, MULTI_SYSTEM_CTX, SYSTEM_ACTOR } from "../signaling/multi-audit.ts";
import type { Rooms } from "../signaling/rooms.ts";
import type { Room } from "../signaling/types.ts";
import { deviceVerdict, type DeviceVerdict } from "../unattended/device-access.ts";
import { silentPolicyEnabled } from "../unattended/policy.ts";
import { avatarUrlFor } from "../uploads/urls.ts";
import type { UnattendedGate } from "../unattended/gate.ts";
import {
  eligibleToJoin,
  joinSyncCheck,
  subjectById,
  subjectOfAuth,
  SUBJECT_SELECT,
  toSubject,
  unattendedStep,
  type JoinFail,
  type JoinSubject,
} from "./eligibility.ts";

export interface MultiDeps {
  db: Db;
  rooms: Rooms;
  gate: UnattendedGate;
}

const consoleUrl = (id: string): string => `/sessions/${id}/console`;
const iso = (ms: number): string => new Date(ms).toISOString();
const newInviteId = (): string => randomBytes(16).toString("base64url");
const actorOf = (a: AuthContext) => ({ userId: a.user.id, username: a.user.email });

function toError(f: JoinFail): AppError {
  return new AppError(f.code, f.fields ? { fields: f.fields } : {});
}

/** Ret: `fail` audit'i (kullanıcı, oturum, neden) başına dakikada 1 (D-PC-3), sonra hata. */
async function refuse(
  d: MultiDeps,
  ctx: AuditContext,
  auth: AuthContext,
  room: Pick<Room, "tenantId" | "sessionId">,
  action: MultiAuditAction,
  f: JoinFail,
  extra: Record<string, string> = {},
): Promise<never> {
  if (failAuditAllowed(d.rooms, auth.user.id, room.sessionId, f.failReason))
    await auditMulti(d.rooms, room, ctx, actorOf(auth), action, { ...extra, failReason: f.failReason }, "fail");
  throw toError(f);
}

/** Adım 8: gözetimsiz odada kabul/İzle step-up ister (AC-364 "gözetimsizde davetliye step-up"; 5 dk). */
function requireUnattendedStepUp(auth: AuthContext, room: Room, now: number): void {
  if (!room.unattended) return;
  if (!auth.totpEnabled) throw new AppError("MFA_SETUP_REQUIRED");
  const at = auth.stepUpAt?.getTime();
  if (at === undefined || now - at > STEP_UP_MAX_AGE_SEC * 1000) throw new AppError("MFA_STEP_UP_REQUIRED");
}

/** Sahibin odası: başka tenant / yok → 404; sahip değil → 403. */
function ownedRoom(d: MultiDeps, auth: AuthContext, tenantId: string, sessionId: string): Room {
  const room = d.rooms.get(sessionId);
  if (!room || room.tenantId !== tenantId || !d.rooms.live(room)) throw new AppError("NOT_FOUND");
  if (room.technicianId !== auth.user.id) throw new AppError("FORBIDDEN");
  return room;
}

/** Oda düzeyi kapılar (1, 4, 6a) — aday listesinde tek tek kullanıcıdan önce. */
function roomGate(d: MultiDeps, room: Room): void {
  if (!room.admitted || !d.rooms.live(room)) throw new AppError("CONFLICT");
  if (!guestMulti(room)) throw new AppError("CLIENT_UNSUPPORTED");
  const cm = room.unattended?.consentMode;
  if (room.unattended && cm !== "silent" && cm !== "no_user") throw new AppError("JOIN_NOT_ALLOWED");
}

/** GET /sessions/:id/invite-candidates: §4.3 `request` 1–7'yi geçen aynı firma kullanıcıları (≤ 200, ada göre). */
export async function inviteCandidates(
  d: MultiDeps,
  auth: AuthContext,
  tenantId: string,
  sessionId: string,
): Promise<InviteCandidatesResponse> {
  const room = ownedRoom(d, auth, tenantId, sessionId);
  roomGate(d, room);
  const users = await d.db.user.findMany({
    where: { tenantId: room.tenantId, status: "ACTIVE", deletedAt: null, id: { not: auth.user.id } },
    orderBy: { fullName: "asc" },
    take: INVITE_CANDIDATES_MAX,
    select: { ...SUBJECT_SELECT, avatarPath: true },
  });
  const ids = users.map((u) => u.id);
  // D-PC-K2: kullanıcılar (rol + toggle'lar aynı sorguda), cihaz grant'ları ve silent politikası toplu / bir kez (N+1 yok).
  const device = await deviceResolver(d, room, ids);
  let policy: Promise<boolean> | undefined;
  const deps = { ...d, ...(device ? { device } : {}), silentPolicy: () => (policy ??= silentPolicyEnabled(d.db, room.tenantId)) };
  const items: InviteCandidatesResponse["items"] = [];
  for (const u of users) {
    const s = toSubject(u);
    if (await eligibleToJoin(deps, s, room, "invite", "request", { purpose: "candidates" })) continue;
    items.push({ userId: s.userId, fullName: s.fullName, avatarUrl: avatarUrlFor(u.avatarPath) });
  }
  return { items };
}

/** Gözetimsiz odada toplu cihaz kararı (tek cihaz sorgusu + tek grant sorgusu). */
async function deviceResolver(
  d: MultiDeps,
  room: Room,
  userIds: string[],
): Promise<((userId: string) => Promise<DeviceVerdict>) | undefined> {
  const u = room.unattended;
  if (!u) return undefined;
  const dev = await d.db.unattendedDevice.findFirst({
    where: { id: u.deviceId, tenantId: room.tenantId },
    select: { revokedAt: true, localEnabled: true, signed: true, binarySha256: true },
  });
  const grants = await d.db.unattendedDeviceGrant.findMany({
    where: { tenantId: room.tenantId, deviceId: u.deviceId, userId: { in: userIds } },
    select: { userId: true },
  });
  const has = new Set(grants.map((g) => g.userId));
  return async (userId) => deviceVerdict(dev ? { ...dev, grants: has.has(userId) ? [1] : [] } : null, d.gate);
}

/** POST /sessions/:id/invites (AC-364, 365): sahip + `sessions.invite`; davetli için §4.3 `request` 1–7; oda 10/dk. */
export async function createInvite(
  d: MultiDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  sessionId: string,
  userId: string,
): Promise<CreateInviteResponse> {
  const room = ownedRoom(d, auth, tenantId, sessionId);
  if (roomCmdLimited(d.rooms, room)) throw new AppError("RATE_LIMITED", { retryAfterSec: 60 });
  const s = await subjectById(d.db, userId);
  const extra = { inviteeUserId: userId };
  if (!s) return refuse(d, ctx, auth, room, MULTI_AUDIT.INVITE, { code: "FORBIDDEN", failReason: "tenant" }, extra);
  const f = await eligibleToJoin(d, s, room, "invite", "request", { purpose: "invite" });
  if (f) return refuse(d, ctx, auth, room, MULTI_AUDIT.INVITE, f, extra);
  // Adım 9: senkron son denetim + bellek değişikliği aynı adımda.
  const sync = joinSyncCheck(d.rooms, room, userId, "request", { purpose: "invite" });
  if (sync) return refuse(d, ctx, auth, room, MULTI_AUDIT.INVITE, sync, extra);
  const id = newInviteId();
  const expiresAt = d.rooms.clock.now() + INVITE_TTL_MS;
  const timer = d.rooms.clock.setTimeout(() => expireInvite(d, room, id), INVITE_TTL_MS);
  room.multi.invites.set(id, { id, userId, fullName: s.fullName, byUserId: auth.user.id, expiresAt, timer });
  countInvite(d.rooms, "sent");
  await auditMulti(d.rooms, room, ctx, actorOf(auth), MULTI_AUDIT.INVITE, { inviteeUserId: userId, inviteeName: s.fullName });
  return { inviteId: id, expiresAt: iso(expiresAt) };
}

/** 2 dk doldu (§4.2): davet düşer, koltuk boşalır, audit system `timeout`. */
function expireInvite(d: MultiDeps, room: Room, id: string): void {
  const inv = room.multi.invites.get(id);
  if (!inv || !d.rooms.live(room)) return;
  room.multi.invites.delete(id);
  countInvite(d.rooms, "expired");
  void auditMulti(d.rooms, room, MULTI_SYSTEM_CTX, SYSTEM_ACTOR, MULTI_AUDIT.INVITE_EXPIRE, {
    inviteeUserId: inv.userId,
    reason: "timeout",
  });
}

/** DELETE /sessions/:id/invites/:inviteId (D-PC-7): sahip geri çeker; audit `invite_expire{revoked}` (aktör sahip). */
export async function revokeInvite(
  d: MultiDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  sessionId: string,
  inviteId: string,
): Promise<void> {
  const room = ownedRoom(d, auth, tenantId, sessionId);
  const inv = room.multi.invites.get(inviteId);
  if (!inv) throw new AppError("NOT_FOUND");
  room.multi.invites.delete(inviteId);
  d.rooms.clock.clearTimeout(inv.timer);
  countInvite(d.rooms, "expired");
  await auditMulti(d.rooms, room, ctx, actorOf(auth), MULTI_AUDIT.INVITE_EXPIRE, { inviteeUserId: inv.userId, reason: "revoked" });
}

/** K1c GET /sessions/:id/invites: sahibin bekleyen giden davetleri (DELETE ile aynı kapı; koltukla sınırlı, bitişe göre). */
export function outgoingInvites(d: MultiDeps, auth: AuthContext, tenantId: string, sessionId: string): OutgoingInvitesResponse {
  const room = ownedRoom(d, auth, tenantId, sessionId);
  const items = [...room.multi.invites.values()]
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map((inv) => ({ inviteId: inv.id, userId: inv.userId, inviteeName: inv.fullName, expiresAt: iso(inv.expiresAt) }));
  return { items };
}

function findInvite(d: MultiDeps, inviteId: string): { room: Room; inv: NonNullable<ReturnType<Room["multi"]["invites"]["get"]>> } | null {
  for (const room of d.rooms.values()) {
    const inv = room.multi.invites.get(inviteId);
    if (inv && d.rooms.live(room)) return { room, inv };
  }
  return null;
}

/** GET /sessions/invites: yalnız kendine gelen, bellekten. */
export function incomingInvites(d: MultiDeps, auth: AuthContext): IncomingInvitesResponse {
  const items: IncomingInvitesResponse["items"] = [];
  for (const room of d.rooms.values()) {
    if (!d.rooms.live(room)) continue;
    for (const inv of room.multi.invites.values()) {
      if (inv.userId !== auth.user.id) continue;
      items.push({
        inviteId: inv.id,
        sessionId: room.sessionId,
        fromName: room.technicianName,
        customerName: room.admitted?.name ?? "",
        unattended: room.unattended !== undefined,
        silent: room.unattended?.consentMode === "silent",
        expiresAt: iso(inv.expiresAt),
      });
    }
  }
  return { items };
}

/**
 * POST /sessions/invites/:inviteId/accept: davet bu kullanıcıya ait (aksi 410, kimlik sızmaz); §4.3 `request` 1–9; davet →
 * üye rezervasyonu (participant, 60 sn, `authSessionId`).
 */
export async function acceptInvite(
  d: MultiDeps,
  ctx: AuditContext,
  auth: AuthContext,
  inviteId: string,
  reason: string | undefined,
): Promise<JoinSessionAsMemberResponse> {
  const found = findInvite(d, inviteId);
  if (!found || found.inv.userId !== auth.user.id) throw new AppError("INVITE_GONE");
  const { room } = found;
  const o = { purpose: "accept" as const, inviteId, reason };
  const f = await eligibleToJoin(d, subjectOfAuth(auth), room, "invite", "request", o);
  if (f) return refuse(d, ctx, auth, room, MULTI_AUDIT.INVITE_ACCEPT, f, { inviteId });
  requireUnattendedStepUp(auth, room, d.rooms.clock.now());
  const sync = joinSyncCheck(d.rooms, room, auth.user.id, "request", o);
  if (sync) return refuse(d, ctx, auth, room, MULTI_AUDIT.INVITE_ACCEPT, sync, { inviteId });
  const inv = room.multi.invites.get(inviteId);
  if (!inv) throw new AppError("INVITE_GONE");
  room.multi.invites.delete(inviteId); // tek kullanımlık; koltuk üyeye geçer
  d.rooms.clock.clearTimeout(inv.timer);
  reserveMember(d.rooms, room, {
    userId: auth.user.id,
    username: auth.user.email,
    fullName: auth.user.fullName,
    role: "participant",
    via: "invite",
    authSessionId: auth.sessionId,
    reason,
  });
  countInvite(d.rooms, "accepted");
  await auditMulti(d.rooms, room, ctx, actorOf(auth), MULTI_AUDIT.INVITE_ACCEPT, { inviteId });
  return { sessionId: room.sessionId, consoleUrl: consoleUrl(room.sessionId) };
}

/** POST /sessions/invites/:inviteId/reject. */
export async function rejectInvite(d: MultiDeps, ctx: AuditContext, auth: AuthContext, inviteId: string): Promise<void> {
  const found = findInvite(d, inviteId);
  if (!found || found.inv.userId !== auth.user.id) throw new AppError("INVITE_GONE");
  found.room.multi.invites.delete(inviteId);
  d.rooms.clock.clearTimeout(found.inv.timer);
  countInvite(d.rooms, "rejected");
  await auditMulti(d.rooms, found.room, ctx, actorOf(auth), MULTI_AUDIT.INVITE_REJECT, { inviteId });
}

/**
 * GET /sessions/active (AC-368): tenant'ın canlı ACTIVE odaları. Gözetimsiz oda yalnız çağıran §4.3 adım 5–6b'yi geçiyorsa
 * listelenir (O-PC-1, O-PC-K1); geçemediği oda hiç görünmez.
 */
export async function activeSessions(d: MultiDeps, auth: AuthContext, tenantId: string): Promise<ActiveSessionsResponse> {
  const s = subjectOfAuth(auth);
  const items: ActiveSessionItem[] = [];
  for (const room of [...d.rooms.values()]) {
    if (room.tenantId !== tenantId || !room.admitted || !d.rooms.live(room)) continue;
    if (room.unattended && !(await unattendedVisible(d, s, room))) continue;
    const u = room.unattended;
    items.push({
      id: room.sessionId,
      technicianName: room.technicianName,
      customerName: room.admitted.name,
      mode: u ? "UNATTENDED" : room.admitted.kind,
      startedAt: iso(room.multi.startedAt ?? d.rooms.clock.now()),
      techCount: 1 + [...room.multi.members.values()].filter((m) => m.joinedAudited).length,
      full: seatsUsed(room) >= MAX_TECHS,
      supported: guestMulti(room),
      unattended: u !== undefined,
      silent: u?.consentMode === "silent",
      ...(u?.consentMode ? { consentMode: u.consentMode } : {}),
    });
  }
  return { items };
}

/**
 * O-PC-K1: gözetimsiz oda yalnız §4.3 adım 5–6b'yi (`unattendedStep`, `request`) geçen izleyiciye görünür — asked oda hiç,
 * silent oda yalnız `unattended.silent` ∧ açık politika ∧ cihaz grant'ı olana. Koltuk/multi1 listede bayrakla gösterilir.
 */
async function unattendedVisible(d: MultiDeps, s: JoinSubject, room: Room): Promise<boolean> {
  if (!room.unattended || !s.permissions.has("sessions.supervise")) return false;
  return (await unattendedStep(d, s, room, "request")) === null;
}

/** POST /sessions/:id/supervise (AC-368): §4.3 `request` 1–9; üye rezervasyonu (observer, 60 sn). Audit WS bağlanınca. */
export async function supervise(
  d: MultiDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  sessionId: string,
  reason: string | undefined,
): Promise<JoinSessionAsMemberResponse> {
  const room = d.rooms.get(sessionId);
  const ref = { tenantId, sessionId };
  if (!room || room.tenantId !== tenantId) {
    const exists = await d.db.supportSession.findFirst({ where: { id: sessionId, tenantId }, select: { id: true } });
    throw new AppError(exists ? "CONFLICT" : "NOT_FOUND");
  }
  const o = { purpose: "supervise" as const, reason };
  const f = await eligibleToJoin(d, subjectOfAuth(auth), room, "supervise", "request", o);
  if (f) return refuse(d, ctx, auth, ref, MULTI_AUDIT.SUPERVISE_JOIN, f);
  requireUnattendedStepUp(auth, room, d.rooms.clock.now());
  const sync = joinSyncCheck(d.rooms, room, auth.user.id, "request", o);
  if (sync) return refuse(d, ctx, auth, ref, MULTI_AUDIT.SUPERVISE_JOIN, sync);
  reserveMember(d.rooms, room, {
    userId: auth.user.id,
    username: auth.user.email,
    fullName: auth.user.fullName,
    role: "observer",
    via: "supervise",
    authSessionId: auth.sessionId,
    reason,
  });
  return { sessionId, consoleUrl: consoleUrl(sessionId) };
}
