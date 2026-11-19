// P28c uygunluk zinciri — TEK kaynak `eligibleToJoin(subject, room, via, phase)` (mimari-p28c r2 §4.3; Y-PC-3, O-PC-1/2).
// Davet, kabul, İzle, aday listesi, `/ws/tech` üye dalı ve 60 sn yeniden doğrulama yalnız bunu çağırır. İlk düşen adım kodu
// belirler. Girdi düz veri (istek değil): davetli ve revalidate'te istek yoktur. Adım 8 (step-up) rota katmanında
// (`requireStepUp`); adım 9 senkron son denetim `joinSyncCheck` — çağıran onu bellek değişikliğiyle AYNI senkron adımda çağırır.
import type { ErrorCode } from "@remote/contracts/errors";
import { effectivePermissions, type PermissionKey, type Role } from "@remote/contracts/permissions";
import type { MemberVia } from "@remote/contracts/ws-multi";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { guestMulti, roomFull } from "../signaling/members.ts";
import type { Rooms } from "../signaling/rooms.ts";
import type { Room } from "../signaling/types.ts";
import { deviceAccess, type DeviceVerdict } from "../unattended/device-access.ts";
import type { UnattendedGate } from "../unattended/gate.ts";

type DbOrTx = Db | Prisma.TransactionClient;

export type JoinPhase = "request" | "ws" | "revalidate";
/** `request` evresinin alt amacı: davet oluşturma (davetli için), aday listesi, kabul, İzle. */
export type JoinPurpose = "invite" | "candidates" | "accept" | "supervise";

export interface JoinSubject {
  userId: string;
  role: Role;
  /** Kullanıcının kendi firması (Super Admin'de null). */
  homeTenantId: string | null;
  /** Etkin (seçili) firma — Super Admin İzle'de `tenantScope`. */
  actingTenantId: string | null;
  active: boolean;
  permissions: ReadonlySet<PermissionKey>;
  /** Kimlik oturumu (ws: 8'). */
  authSessionId?: string;
}

export interface JoinFail {
  code: ErrorCode;
  failReason: string;
  fields?: Record<string, string>;
}

export interface JoinDeps {
  /** D-PC-K4: devir TX'i içinden de çağrılır. */
  db: DbOrTx;
  rooms: Rooms;
  /** Yalnız imza kapısı kararı kullanılır (devirde kapı yoksa hep-ret verilir, D-PC-K4). */
  gate: Pick<UnattendedGate, "allows">;
  /** Aday listesi gibi toplu çağrılarda önbellekli cihaz kararı (verilmezse tek sorgu). */
  device?: (userId: string) => Promise<DeviceVerdict>;
}

export interface JoinOpts {
  purpose?: JoinPurpose;
  /** Kabulde: davet bu kullanıcıya ait (adım 3) ve koltuk tutulu (adım 7 atlanır). */
  inviteId?: string;
}

export const subjectOfAuth = (a: AuthContext): JoinSubject => ({
  userId: a.user.id,
  role: a.user.role,
  homeTenantId: a.user.tenantId,
  actingTenantId: a.tenantId,
  active: true, // resolveSession yalnız oturum açabilen (canSignIn) kullanıcıya bağlam üretir
  permissions: a.permissions,
  authSessionId: a.sessionId,
});

/** Kullanıcı → özne seçimi (tek sorgu; aday listesi aynı seçimi toplu kullanır, D-PC-K2). */
export const SUBJECT_SELECT = {
  id: true,
  role: true,
  status: true,
  deletedAt: true,
  tenantId: true,
  fullName: true,
  email: true,
  tenant: { select: { status: true } },
  permissions: { select: { permKey: true, granted: true } },
} as const;

type SubjectRow = Prisma.UserGetPayload<{ select: typeof SUBJECT_SELECT }>;
export type StoredSubject = JoinSubject & { fullName: string; email: string };

export const toSubject = (u: SubjectRow): StoredSubject => ({
  userId: u.id,
  role: u.role as Role,
  homeTenantId: u.tenantId,
  actingTenantId: u.tenantId,
  active: u.status === "ACTIVE" && u.deletedAt === null && (u.tenant === null || u.tenant.status === "ACTIVE"),
  permissions: new Set(effectivePermissions(u.role as Role, u.permissions)),
  fullName: u.fullName,
  email: u.email,
});

/** Davetli (istek yok): DB'den rol + toggle'lar + durum. Yoksa null. */
export async function subjectById(db: DbOrTx, userId: string): Promise<StoredSubject | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: SUBJECT_SELECT });
  return u ? toSubject(u) : null;
}

const fail = (code: ErrorCode, failReason: string, fields?: Record<string, string>): JoinFail => ({
  code,
  failReason,
  ...(fields ? { fields } : {}),
});

/** Adım 1: oda canlı ve ACTIVE (admit edilmiş misafir var). */
const roomActive = (rooms: Rooms, room: Room | undefined): room is Room =>
  room !== undefined && rooms.live(room) && room.admitted !== undefined;

/** Adım 2: oturumun tenant'ının etkin kullanıcısı (Super Admin yalnız İzle'de ve seçili firmada). */
function tenantOk(s: JoinSubject, room: Room, via: MemberVia): boolean {
  if (!s.active) return false;
  if (s.role === "SUPER_ADMIN") return via === "supervise" && s.actingTenantId === room.tenantId;
  return s.homeTenantId === room.tenantId;
}

/**
 * Adım 1–7 (+ ws 3', 8'). Geçerse null. Adım 8 (step-up) rota katmanında; adım 9 `joinSyncCheck`.
 */
export async function eligibleToJoin(
  d: JoinDeps,
  s: JoinSubject,
  room: Room | undefined,
  via: MemberVia,
  phase: JoinPhase,
  o: JoinOpts = {},
): Promise<JoinFail | null> {
  if (phase !== "revalidate" && !roomActive(d.rooms, room)) return fail("CONFLICT", "room_inactive");
  if (!room) return fail("CONFLICT", "room_inactive");
  if (!tenantOk(s, room, via)) return fail(via === "supervise" && phase === "request" ? "NOT_FOUND" : "FORBIDDEN", "tenant");
  const seat = seatStep(room, s, phase, o);
  if (seat) return seat;
  if (phase !== "revalidate" && !guestMulti(room)) return fail("CLIENT_UNSUPPORTED", "client_unsupported");
  if (!s.permissions.has(via === "supervise" ? "sessions.supervise" : "sessions.view")) return fail("FORBIDDEN", "permission");
  const un = await unattendedStep(d, s, room, phase);
  if (un) return un;
  if (phase === "request" && o.purpose !== "accept" && roomFull(room)) return fail("SESSION_FULL", "full");
  if (phase === "ws") {
    const m = room.multi.members.get(s.userId);
    if (!m || m.authSessionId !== s.authSessionId) return fail("FORBIDDEN", "auth_session");
  }
  return null;
}

/**
 * Adım 6 / 6a (gözetimsiz oda): `unattended.connect` + cihaz erişimi; kipi `no_user` olmayan odaya (admit öncesi — kip henüz
 * yazılmamış — ya da eski `asked`) katılım kapalı, revalidate hariç (K-P28u-r3-9, S-P28u-r3-4). Koltuk/kapasite/multi1'den bağımsız — `GET /sessions/active` görünürlüğü
 * de bunu kullanır (O-PC-K1, tek kaynak).
 */
export async function unattendedStep(d: JoinDeps, s: JoinSubject, room: Room, phase: JoinPhase): Promise<JoinFail | null> {
  const u = room.unattended;
  if (!u) return null;
  if (!s.permissions.has("unattended.connect")) return fail("FORBIDDEN", "permission");
  const v = d.device ? await d.device(s.userId) : await deviceAccess(d.db, d.gate, room.tenantId, s.userId, u.deviceId);
  if (v !== "ok") return fail("FORBIDDEN", "device");
  const cm = u.consentMode;
  if (phase !== "revalidate" && cm !== "no_user") return fail("JOIN_NOT_ALLOWED", "join_not_allowed");
  return null;
}

/** Adım 3 / 3' (+ her evrede `removed`). */
function seatStep(room: Room, s: JoinSubject, phase: JoinPhase, o: JoinOpts): JoinFail | null {
  if (room.multi.removed.has(s.userId)) return fail("FORBIDDEN", "removed");
  if (phase === "ws") return room.multi.members.has(s.userId) ? null : fail("FORBIDDEN", "not_member");
  if (phase === "revalidate") return null;
  if (s.userId === room.technicianId || room.multi.members.has(s.userId)) return fail("CONFLICT", "already_in");
  for (const inv of room.multi.invites.values()) {
    if (inv.userId !== s.userId) continue;
    if (o.purpose === "accept" && inv.id === o.inviteId) continue;
    return fail("CONFLICT", "already_invited");
  }
  if (o.purpose === "accept" && !room.multi.invites.has(o.inviteId ?? "")) return fail("INVITE_GONE", "invite_gone");
  return null;
}

/**
 * Adım 9 (O-PC-2): tüm `await`'lerden sonra, bellek değişikliğiyle AYNI senkron adımda 1, 3 (ws: 3') ve 7 yeniden. Kabulde
 * davet burada haritadan alınır (tek kullanımlık) — çağıran dönen daveti kullanır.
 */
export function joinSyncCheck(
  rooms: Rooms,
  room: Room | undefined,
  userId: string,
  phase: "request" | "ws",
  o: JoinOpts = {},
): JoinFail | null {
  if (!roomActive(rooms, room)) return fail("CONFLICT", "room_inactive");
  const s = { userId } as JoinSubject;
  const seat = seatStep(room, s, phase, o);
  if (seat) return seat;
  if (phase === "request" && o.purpose !== "accept" && roomFull(room)) return fail("SESSION_FULL", "full");
  return null;
}
