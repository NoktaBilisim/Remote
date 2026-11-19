// P27 cihaz listesi / ayrıntı / teknisyen yetkileri / iptal (mimari-p27 §4.2, §4.3 r2, §4.4 süreler; AC-275, 293, 336–339).
// Canlı bağlantı tarafı (çevrimiçi durumu, soket kapatma, oda bitirme) `DeviceLink` arkasındadır: K3'ün DeviceHub'ı bunu
// uygular ve rota eklentisine verir; verilmezse `OFFLINE_LINK` (hiçbir cihaz çevrimiçi değil, kesilecek bağlantı yok).
import type {
  ConnectBlockedReason,
  DeviceDetail,
  DeviceGrantsResponse,
  DeviceListItem,
  DeviceListResponse,
  ListDevicesQuery,
} from "@remote/contracts/api/unattended";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { effectivePermissions, type Role } from "@remote/contracts/permissions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { MailService } from "../mail/service.ts";
import { avatarUrlFor } from "../uploads/urls.ts";
import type { UnattendedGate } from "./gate.ts";
import { selfGrantMail, sendInternalNotice } from "./mail.ts";
import * as repo from "./repo.ts";
import type { DeviceUserState } from "@remote/contracts/unattended-consent";
import { deviceUpdateBadge } from "../update/versions.ts";

/** Canlı cihaz kanalı (K3 DeviceHub). Commit SONRASI çağrılır; hata fırlatmaz. */
export interface DeviceLink {
  onlineIds(): readonly string[];
  isOnline(deviceId: string): boolean;
  replacedAlert(deviceId: string): boolean;
  /** AC-275: soket kapanır + cihazın odası `device_revoked` ile biter. */
  revoked(deviceId: string): void;
  /** AC-293: yetkisi kalkan teknisyenlerin bu cihazdaki odası `permission` ile biter. */
  grantsRemoved(deviceId: string, userIds: readonly string[]): void;
  /** P28u r3 (AC-435, K-P28u-r3-2): soket `rs.cap.direct1` bildirdi mi (verilmezse eski servis sayılır). */
  has?(deviceId: string, feature: "direct1"): boolean;
  /** P28u (AC-429): canlı kullanıcı durumu (hub belleği); yoksa null. */
  userState?(deviceId: string): DeviceUserState | null;
}

export const OFFLINE_LINK: DeviceLink = {
  onlineIds: () => [],
  isOnline: () => false,
  replacedAlert: () => false,
  revoked: () => undefined,
  grantsRemoved: () => undefined,
};

export interface UnattendedDeps {
  db: Db;
  mail: MailService;
  gate: UnattendedGate;
  link: DeviceLink;
  now: () => number;
  log: { error(obj: object, msg: string): void };
  /** P29 (§3.2): rozet için yayındaki servis sürümü ve `MIN_AGENT_VERSION` (verilmezse yayın yok / asgari yok sayılır). */
  updates?: { publishedServiceVersion(): Promise<string | null> };
  minAgentVersion?: string | undefined;
}

interface Facts {
  canConnectPerm: boolean;
  online: boolean;
  /** P28u r3: çevrimiçi soket `direct1` bildirdi (onaysız yolu bilen servis). */
  current: boolean;
  signatureOk: boolean;
  contacts: number;
  smtp: boolean;
}

/** §4.2 / AC-336: düğme pasif nedeni; öncelik no_grant → unsigned → offline → local_disabled → no_contacts → smtp. */
export function blockedReason(r: repo.DeviceRow, f: Facts): ConnectBlockedReason | null {
  if (!f.canConnectPerm || r.grants.length === 0) return "no_grant";
  if (!f.signatureOk) return "unsigned";
  if (!f.online) return "offline";
  if (!f.current) return "outdated";
  if (!r.localEnabled) return "local_disabled";
  if (f.contacts === 0) return "no_contacts";
  if (!f.smtp) return "smtp";
  return null;
}

interface ViewCtx {
  d: UnattendedDeps;
  canConnectPerm: boolean;
  contacts: Map<string, number>;
  smtp: boolean;
  publishedService: string | null;
}

function toItem(v: ViewCtx, r: repo.DeviceRow): DeviceListItem {
  const signatureOk = v.d.gate.allows({ signed: r.signed, sha256: r.binarySha256 });
  const online = v.d.link.isOnline(r.id);
  const current = v.d.link.has?.(r.id, "direct1") ?? false;
  const facts = {
    canConnectPerm: v.canConnectPerm,
    online,
    current,
    signatureOk,
    contacts: v.contacts.get(r.customerId) ?? 0,
    smtp: v.smtp,
  };
  const reason = blockedReason(r, facts);
  const upd = deviceUpdateBadge(r, { minVersion: v.d.minAgentVersion, publishedService: v.publishedService, now: v.d.now() });
  return {
    id: r.id,
    name: r.name,
    customerId: r.customerId,
    customerName: r.customer.name,
    online,
    localEnabled: r.localEnabled,
    signatureOk,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    lastSessionAt: r.sessions[0]?.createdAt.toISOString() ?? null,
    grantCount: r._count.grants,
    canConnect: reason === null,
    connectBlockedReason: reason,
    verified: r.verifiedAt !== null,
    notifyFailed: r.notifyFailedAt !== null,
    replacedAlert: v.d.link.replacedAlert(r.id),
    // D-P28u-6: yalnız çağıranın grant'ı olan cihazda (manage sahibi grant'sız cihazı görür ama durumunu görmez).
    userState: r.grants.length > 0 ? (v.d.link.userState?.(r.id) ?? null) : null,
    // P29 (§4.8, AC-490): sürüm sütunu + rozet.
    agentVersion: r.agentVersion,
    updateBadge: upd.badge,
    updateReason: upd.reason,
    updateVersion: r.updateVersion,
  };
}

async function viewCtx(d: UnattendedDeps, auth: AuthContext, tenantId: string, rows: repo.DeviceRow[]): Promise<ViewCtx> {
  const [contacts, smtp, publishedService] = await Promise.all([
    repo.contactCounts(
      d.db,
      tenantId,
      rows.map((r) => r.customerId),
    ),
    d.mail.configFor(tenantId).then((c) => c !== null),
    d.updates ? d.updates.publishedServiceVersion() : Promise.resolve(null),
  ]);
  return { d, canConnectPerm: auth.permissions.has("unattended.connect"), contacts, smtp, publishedService };
}

/** GET /unattended/devices (AC-275, 293): `manage` yoksa yalnız grant'lı cihazlar; keyset (ad, id). */
export async function listDevices(
  d: UnattendedDeps,
  auth: AuthContext,
  tenantId: string,
  q: ListDevicesQuery,
): Promise<DeviceListResponse> {
  const after = q.cursor ? await repo.cursorOf(d.db, tenantId, q.cursor) : undefined;
  if (after === null) throw new AppError("VALIDATION", { fields: { cursor: "Geçersiz sayfa imleci" } });
  const online = q.state === "all" ? undefined : { ids: [...d.link.onlineIds()], want: q.state === "online" };
  const rows = await repo.listDevices(d.db, {
    tenantId,
    userId: auth.user.id,
    manage: auth.permissions.has("unattended.manage"),
    q: q.q,
    customerId: q.customerId,
    online,
    after,
    version: q.version,
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  const v = await viewCtx(d, auth, tenantId, page);
  return { items: page.map((r) => toItem(v, r)), nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null };
}

/** GET /unattended/devices/:id: `manage` ya da grant'lı; değilse 404 (varlık sızmaz). */
export async function getDevice(d: UnattendedDeps, auth: AuthContext, tenantId: string, id: string): Promise<DeviceDetail> {
  const r = await repo.getDevice(d.db, tenantId, auth.user.id, id);
  const manage = auth.permissions.has("unattended.manage");
  if (!r || (!manage && r.grants.length === 0)) throw new AppError("NOT_FOUND");
  const item = toItem(await viewCtx(d, auth, tenantId, [r]), r);
  return {
    ...item,
    osVersion: r.osVersion,
    agentVersion: r.agentVersion,
    signed: r.signed,
    lastIp: manage ? r.lastIp : null,
    registeredIp: manage ? r.registeredIp : null,
    registeredAt: manage ? r.createdAt.toISOString() : null,
    grants: manage ? await grantList(d.db, tenantId, id) : null,
  };
}

async function grantList(db: Db, tenantId: string, deviceId: string): Promise<DeviceGrantsResponse["grants"]> {
  const rows = await repo.grantViews(db, tenantId, deviceId);
  return rows.map((g) => ({ userId: g.userId, name: g.user.fullName, avatarUrl: avatarUrlFor(g.user.avatarPath) }));
}

const actorOf = (auth: AuthContext) => ({ userId: auth.user.id, username: auth.user.email });

/** POST /unattended/devices/:id/revoke (AC-275): cihaz kilidi → iptal + grant'lar silinir + audit; commit sonrası hub. */
export async function revokeDevice(d: UnattendedDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<void> {
  await d.db.$transaction(async (tx) => {
    const dev = await repo.lockDevice(tx, tenantId, id);
    if (!dev) throw new AppError("NOT_FOUND");
    if (dev.revoked_at) throw new AppError("CONFLICT", { message: "Cihaz zaten iptal edilmiş." });
    await tx.unattendedDevice.update({
      where: { id },
      data: { revokedAt: new Date(d.now()), revokedBy: auth.user.id, revokeReason: "ADMIN", lastIp: null },
    });
    const grants = await tx.unattendedDeviceGrant.deleteMany({ where: { tenantId, deviceId: id } });
    await writeAudit(tx, ctx, {
      tenantId,
      ...actorOf(auth),
      action: UNATTENDED_AUDIT.DEVICE_REVOKED,
      entity: "unattended_devices",
      entityId: id,
      result: "success",
      newValue: { reason: "ADMIN", removedGrants: grants.count },
    });
  });
  d.link.revoked(id);
}

/** Eklenecek kullanıcılar: aynı firma, ACTIVE, ADMIN|USER, etkin `unattended.connect`; uymayan → 400 `fields.userIds`. */
async function assertGrantable(tx: Parameters<Parameters<Db["$transaction"]>[0]>[0], tenantId: string, ids: string[]): Promise<void> {
  const users = await repo.candidateUsers(tx, tenantId, ids);
  const ok = new Set(
    users
      .filter((u) => u.status === "ACTIVE" && (u.role === "ADMIN" || u.role === "USER"))
      .filter((u) => effectivePermissions(u.role as Role, u.permissions).includes("unattended.connect"))
      .map((u) => u.id),
  );
  if (ids.some((i) => !ok.has(i)))
    throw new AppError("VALIDATION", { fields: { userIds: "Kullanıcı bu firmada etkin değil ya da gözetimsiz bağlanma yetkisi yok." } });
}

type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

/** Ekleme: step-up (tüketmez) → aday denetimi → INSERT; ilk grant `verified_at` yazar (O-P27-5). */
async function addGrants(
  tx: Tx,
  d: UnattendedDeps,
  auth: AuthContext,
  g: { tenantId: string; id: string; verified: boolean; added: string[] },
  assertStepUp: () => Promise<void>,
): Promise<void> {
  await assertStepUp();
  await assertGrantable(tx, g.tenantId, g.added);
  await tx.unattendedDeviceGrant.createMany({
    data: g.added.map((userId) => ({ id: newId(), tenantId: g.tenantId, deviceId: g.id, userId, createdBy: auth.user.id })),
  });
  if (!g.verified) await tx.unattendedDevice.update({ where: { id: g.id }, data: { verifiedAt: new Date(d.now()) } });
}

export interface GrantChange {
  added: string[];
  removed: string[];
  deviceName: string;
}

/**
 * PUT /unattended/devices/:id/grants (AC-293, 337, 339): tam küme. Ekleme varsa `assertStepUp` (tüketmez). İlk grant
 * `verified_at` yazar (O-P27-5). Kendine ekleme audit `selfGrant:true` + diğer `manage` sahiplerine e-posta (D-P27-4).
 */
export async function putGrants(
  d: UnattendedDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  userIds: string[],
  assertStepUp: () => Promise<void>,
): Promise<DeviceGrantsResponse> {
  const change = await d.db.$transaction(async (tx): Promise<GrantChange> => {
    const dev = await repo.lockDevice(tx, tenantId, id);
    if (!dev || dev.revoked_at) throw new AppError("NOT_FOUND");
    const cur = await repo.grantUserIds(tx, tenantId, id);
    const added = userIds.filter((u) => !cur.includes(u));
    const removed = cur.filter((u) => !userIds.includes(u));
    if (added.length === 0 && removed.length === 0) return { added, removed, deviceName: dev.name };
    if (added.length > 0) await addGrants(tx, d, auth, { tenantId, id, verified: dev.verified_at !== null, added }, assertStepUp);
    if (removed.length > 0) await tx.unattendedDeviceGrant.deleteMany({ where: { tenantId, deviceId: id, userId: { in: removed } } });
    const selfGrant = added.includes(auth.user.id);
    await writeAudit(tx, ctx, {
      tenantId,
      ...actorOf(auth),
      action: UNATTENDED_AUDIT.GRANT_CHANGED,
      entity: "unattended_devices",
      entityId: id,
      result: "success",
      oldValue: { userIds: cur },
      newValue: { userIds: [...userIds].sort(), added, removed, ...(selfGrant ? { selfGrant: true } : {}) },
    });
    return { added, removed, deviceName: dev.name };
  });
  if (change.removed.length > 0) d.link.grantsRemoved(id, change.removed);
  if (change.added.includes(auth.user.id)) notifySelfGrant(d, ctx, auth, tenantId, id, change.deviceName);
  return { grants: await grantList(d.db, tenantId, id) };
}

function notifySelfGrant(d: UnattendedDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string, device: string): void {
  void sendInternalNotice({
    db: d.db,
    mail: d.mail,
    ctx,
    tenantId,
    actor: actorOf(auth),
    perms: ["unattended.manage"],
    kind: "unattended_self_grant",
    entity: "unattended_devices",
    entityId: id,
    content: selfGrantMail({ user: auth.user.fullName, device, at: new Date(d.now()) }),
  }).catch((err: unknown) => d.log.error({ err, event: "unattended_self_grant_notify_failed" }, "kendine yetki bildirimi gönderilemedi"));
}
