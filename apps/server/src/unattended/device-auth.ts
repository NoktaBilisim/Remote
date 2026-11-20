// P27 `/ws/device` kimlik doğrulaması (mimari-p27 §4.4, K-P27-6; AC-273, 297, 339): `device.auth` imzası Ed25519 ile
// `deviceAuthMessage(nonce, deviceId, PUBLIC_BASE_URL origin)` üzerinden doğrulanır. Sıra: cihaz var → imza → iptal (revoked{}
// + 4401) → firma etkin (4401) → imza kapısı (4403). Başarıda beyan alanları + last_seen_at/last_ip yazılır; IP değiştiyse audit
// `ipChanged` (D-P27-3), yerel anahtar değiştiyse `unattended.local_state`. Başarısızlık audit'i cihaz başına dakikada ≤ 1.
// P32 (AC-527a, S-P32-4): kapı reddi audit'i ve `warn` logu `sha256Prefix` (beyan SHA'sının ilk 12 hanesi) taşır; log aynı
// dakikalık kısıtın içinde (audit yazılmadıysa log da yazılmaz).
import { createPublicKey, verify } from "node:crypto";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { deviceAuthMessage, WS_DEVICE_CLOSE, type DeviceAuth } from "@remote/contracts/ws-device";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { compareVersions } from "../lib/version.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { UnattendedGate } from "./gate.ts";

const FAIL_AUDIT_MS = 60_000;

export interface AuthDeps {
  db: Db;
  gate: UnattendedGate;
  metrics: Metrics;
  origin: string;
  now: () => number;
  /** deviceId → son başarısızlık audit anı. */
  failAuditAt: Map<string, number>;
  /** Kapı reddi uyarısı (app.log.warn); token/imza/kod yazılmaz. */
  warn: (obj: object, msg: string) => void;
}

/** P32 (AC-527a): ret kaydında SHA'nın yalnız ilk 12 hanesi. */
export const SHA256_PREFIX_LEN = 12;

export type AuthOutcome =
  { ok: true; tenantId: string; tenantName: string; customerName: string } | { ok: false; code: number; reason: string; revoked?: boolean };

const deviceSelect = {
  id: true,
  tenantId: true,
  publicKey: true,
  revokedAt: true,
  lastIp: true,
  localEnabled: true,
  updateVersion: true,
  tenant: { select: { name: true, status: true, deletedAt: true } },
  customer: { select: { name: true } },
} as const;

/** Ed25519 açık anahtarı (32 bayt ham) ile imza doğrulaması; biçim hatası → false. */
export function verifyDeviceSig(publicKey: Uint8Array, message: string, sigB64url: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(sigB64url, "base64url"));
  } catch {
    return false;
  }
}

/** Cihaz başına dakikada ≤ 1 başarısızlık audit'i; yazıldıysa true (çağıranın logu da aynı kısıta bağlı). */
async function auditFail(
  d: AuthDeps,
  ctx: AuditContext,
  tenantId: string,
  deviceId: string,
  reason: string,
  extra: Record<string, string> = {},
): Promise<boolean> {
  const now = d.now();
  const last = d.failAuditAt.get(deviceId);
  if (last !== undefined && now - last < FAIL_AUDIT_MS) return false;
  d.failAuditAt.set(deviceId, now);
  await writeAudit(d.db, ctx, {
    tenantId,
    username: "device",
    action: UNATTENDED_AUDIT.DEVICE_AUTH,
    entity: "unattended_devices",
    entityId: deviceId,
    result: "fail",
    newValue: { reason, ...extra },
  });
  return true;
}

function fail(d: AuthDeps, reason: string, code: number = WS_DEVICE_CLOSE.AUTH_FAILED, revoked = false): AuthOutcome {
  d.metrics.inc("rs_unattended_device_auth_total", { result: reason });
  return { ok: false, code, reason, ...(revoked ? { revoked: true } : {}) };
}

export async function authenticateDevice(d: AuthDeps, ctx: AuditContext, nonce: string, m: DeviceAuth): Promise<AuthOutcome> {
  const dev = await d.db.unattendedDevice.findUnique({ where: { id: m.deviceId }, select: deviceSelect });
  if (!dev) return fail(d, "unknown");
  const reject = async (reason: string, code?: number, revoked?: boolean): Promise<AuthOutcome> => {
    await auditFail(d, ctx, dev.tenantId, dev.id, reason);
    return fail(d, reason, code, revoked);
  };
  if (!verifyDeviceSig(dev.publicKey, deviceAuthMessage(nonce, m.deviceId, d.origin), m.sig)) return reject("bad_sig");
  if (dev.revokedAt) return reject("revoked", WS_DEVICE_CLOSE.AUTH_FAILED, true);
  if (dev.tenant.status !== "ACTIVE" || dev.tenant.deletedAt) return reject("tenant_passive");
  if (!d.gate.allows({ signed: m.signed, sha256: m.sha256 })) {
    const sha256Prefix = m.sha256.slice(0, SHA256_PREFIX_LEN);
    if (await auditFail(d, ctx, dev.tenantId, dev.id, "gate", { sha256Prefix }))
      d.warn({ deviceId: dev.id, tenantId: dev.tenantId, sha256Prefix }, "gözetimsiz cihaz kapı reddi (izinli listede değil)");
    return fail(d, "gate", WS_DEVICE_CLOSE.GATE);
  }
  if (!(await recordAuth(d, ctx, dev, m))) return reject("revoked", WS_DEVICE_CLOSE.AUTH_FAILED, true);
  d.metrics.inc("rs_unattended_device_auth_total", { result: "ok" });
  return { ok: true, tenantId: dev.tenantId, tenantName: dev.tenant.name, customerName: dev.customer.name };
}

/** Beyan alanları + son görülme; D-P27-K1: yalnız iptal edilmemiş satıra yazılır (okuma ile yazma arasında iptal → false). */
async function recordAuth(d: AuthDeps, ctx: AuditContext, dev: Dev, m: DeviceAuth): Promise<boolean> {
  return d.db.$transaction(async (tx) => {
    const r = await tx.unattendedDevice.updateMany({
      where: { id: dev.id, revokedAt: null },
      data: {
        agentVersion: m.version,
        binarySha256: m.sha256,
        signed: m.signed,
        localEnabled: m.localEnabled,
        osVersion: m.osVersion,
        lastSeenAt: new Date(d.now()),
        lastIp: ctx.ip.slice(0, 45),
        // P29 (§3.2): bildirilen sürüm hedefe ulaştıysa güncelleme durumu temizlenir (dört alan aynı UPDATE'te; CHECK birlikte NULL).
        ...(dev.updateVersion !== null && compareVersions(m.version, dev.updateVersion) >= 0
          ? { updateState: null, updateVersion: null, updateReason: null, updateAt: null }
          : {}),
      },
    });
    if (r.count !== 1) return false;
    await successAudits(tx, ctx, dev, m);
    return true;
  });
}

export type LiveState = "ok" | "revoked" | "tenant_passive";

/**
 * D-P27-K1: hub'a eklendikten SONRA cihaz/firma durumu yeniden okunur. İptal ve firma pasifi commit'ten sonra hub'ı kapatır;
 * bu okuma iptali görmüyorsa iptalin hub çağrısı eklemeden sonra gelir — iki yoldan biri soketi mutlaka kapatır.
 */
export async function deviceLiveState(db: Db, deviceId: string): Promise<LiveState> {
  const dev = await db.unattendedDevice.findUnique({
    where: { id: deviceId },
    select: { revokedAt: true, tenant: { select: { status: true, deletedAt: true } } },
  });
  if (!dev || dev.revokedAt) return "revoked";
  return dev.tenant.status !== "ACTIVE" || dev.tenant.deletedAt ? "tenant_passive" : "ok";
}

type Dev = { id: string; tenantId: string; lastIp: string | null; localEnabled: boolean; updateVersion: string | null };

/** D-P27-3: yalnız IP değiştiyse success audit'i; yerel anahtar beyanı değiştiyse `local_state`. */
async function successAudits(tx: Parameters<typeof writeAudit>[0], ctx: AuditContext, dev: Dev, m: DeviceAuth): Promise<void> {
  const base = { tenantId: dev.tenantId, username: "device", entity: "unattended_devices", entityId: dev.id, result: "success" as const };
  if (dev.lastIp !== null && dev.lastIp !== ctx.ip)
    await writeAudit(tx, ctx, { ...base, action: UNATTENDED_AUDIT.DEVICE_AUTH, newValue: { ipChanged: true, previousIp: dev.lastIp } });
  if (dev.localEnabled !== m.localEnabled)
    await writeAudit(tx, ctx, {
      ...base,
      action: UNATTENDED_AUDIT.LOCAL_STATE,
      oldValue: { enabled: dev.localEnabled },
      newValue: { enabled: m.localEnabled, via: "auth" },
    });
}
