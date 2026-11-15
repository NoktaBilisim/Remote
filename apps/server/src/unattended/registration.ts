// P27 kayıt kodları ve cihaz kaydı (mimari-p27 §3.3, §4.2, §7.1 r2; AC-273, 297, 336, 337, 339).
// Kod: 16 karakter Crockford base32 (80 bit), DB'de yalnız HMAC (`unattended-code`); düz kod yalnız üretim yanıtında.
// Kayıt TX'i (O-P27-2): kod FOR UPDATE (kullanılmamış ∧ süresi dolmamış) → cihaz INSERT → koşullu kod tüketimi (count=1)
// → müşteri adreslerine `UN_DEVICE_REGISTERED` outbox → audit. Commit sonrası `manage` sahiplerine iç e-posta (O-P27-5).
import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  REGISTRATION_CODE_ALPHABET,
  REGISTRATION_CODE_LENGTH,
  REGISTRATION_CODE_TTL_HOURS,
  formatRegistrationCode,
  type CreatedRegistrationCode,
  type RegisterDeviceData,
  type RegisterDeviceResponse,
  type RegistrationCodeListResponse,
} from "@remote/contracts/api/unattended";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { checkPublicClient } from "../auth/guards.ts";
import type { AuthContext } from "../auth/session.ts";
import type { SecretBox } from "../lib/crypto.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import { customerExists, enqueueEventMails } from "./contacts.ts";
import { deviceRegisteredMail, sendInternalNotice } from "./mail.ts";
import type { UnattendedDeps } from "./service.ts";

export const UNATTENDED_DOWNLOAD_PATH = "/api/v1/unattended/download";
const CODE_MAC_VERSION = 1;

export interface RegistrationDeps extends UnattendedDeps {
  secrets: SecretBox;
  metrics: Metrics;
}

/** 80 bit rastgele → 16 × 5 bit Crockford base32. */
export function newRegistrationCode(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = REGISTRATION_CODE_LENGTH - 1; i >= 0; i--) out += REGISTRATION_CODE_ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return out;
}

/** Sabit anahtar sürümlü HMAC (rotasyonda bekleyen kodlar geçerli kalsın — recipient_hash kalıbı). */
export const codeHash = (secrets: SecretBox, code: string): string => secrets.macAt(CODE_MAC_VERSION, "unattended-code", code);

export async function listCodes(d: RegistrationDeps, tenantId: string): Promise<RegistrationCodeListResponse> {
  const rows = await d.db.unattendedRegistrationCode.findMany({
    where: { tenantId, usedAt: null, expiresAt: { gt: new Date(d.now()) } },
    select: {
      id: true,
      customerId: true,
      expiresAt: true,
      customer: { select: { name: true } },
      creator: { select: { id: true, fullName: true } },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerName: r.customer.name,
      createdBy: r.creator ? { id: r.creator.id, name: r.creator.fullName } : null,
      expiresAt: r.expiresAt.toISOString(),
    })),
  };
}

/** POST /unattended/registration-codes (step-up routes'ta): 404 müşteri → 409 mod → 409 adres → 409 SMTP (AC-336). */
export async function createCode(
  d: RegistrationDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  customerId: string,
): Promise<CreatedRegistrationCode> {
  if (!(await customerExists(d.db, tenantId, customerId))) throw new AppError("NOT_FOUND");
  if (!d.gate.status().available) throw new AppError("UNATTENDED_DISABLED");
  if ((await d.db.customerNotifyContact.count({ where: { tenantId, customerId } })) === 0) throw new AppError("NOTIFY_CONTACT_REQUIRED");
  if (!(await d.mail.configFor(tenantId))) throw new AppError("NOTIFY_CHANNEL_UNAVAILABLE");
  const code = newRegistrationCode();
  const now = new Date(d.now());
  const expiresAt = new Date(now.getTime() + REGISTRATION_CODE_TTL_HOURS * 3_600_000);
  const id = newId();
  await d.db.$transaction(async (tx) => {
    await tx.unattendedRegistrationCode.create({
      data: { id, tenantId, customerId, codeHash: codeHash(d.secrets, code), createdBy: auth.user.id, expiresAt, createdAt: now },
    });
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: UNATTENDED_AUDIT.CODE_CREATED,
      entity: "unattended_registration_codes",
      entityId: id,
      result: "success",
      newValue: { customerId, expiresAt: expiresAt.toISOString() },
    });
  });
  return { id, code: formatRegistrationCode(code), expiresAt: expiresAt.toISOString(), downloadUrl: UNATTENDED_DOWNLOAD_PATH };
}

/** DELETE /unattended/registration-codes/:id — yalnız bekleyen (kullanılmamış) kod; yoksa 404. */
export async function cancelCode(d: RegistrationDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<void> {
  await d.db.$transaction(async (tx) => {
    const row = await tx.unattendedRegistrationCode.findFirst({ where: { id, tenantId, usedAt: null }, select: { customerId: true } });
    if (!row) throw new AppError("NOT_FOUND");
    await tx.unattendedRegistrationCode.delete({ where: { id } });
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: UNATTENDED_AUDIT.CODE_CANCELLED,
      entity: "unattended_registration_codes",
      entityId: id,
      result: "success",
      newValue: { customerId: row.customerId },
    });
  });
}

interface Registered {
  deviceId: string;
  tenantId: string;
  tenantName: string;
  customerName: string;
}

type Tx = Parameters<Parameters<RegistrationDeps["db"]["$transaction"]>[0]>[0];

function insertDevice(
  tx: Tx,
  k: { id: string; tenantId: string; customerId: string; registeredBy: string | null },
  input: RegisterDeviceData,
  ip: string,
  now: Date,
) {
  return tx.unattendedDevice.create({
    data: {
      ...k,
      name: input.name,
      publicKey: Buffer.from(input.publicKey, "base64url"),
      osVersion: input.osVersion,
      agentVersion: input.version,
      binarySha256: input.sha256,
      signed: input.signed,
      registeredIp: ip.slice(0, 45),
      createdAt: now,
    },
    select: { tenant: { select: { name: true } }, customer: { select: { name: true } } },
  });
}

/** Kayıt TX'i; kod geçersizse null (çağıran hız kovalarını sayar). Kapı reddi → 409 UNATTENDED_DISABLED. */
export async function registerTx(d: RegistrationDeps, ctx: AuditContext, input: RegisterDeviceData): Promise<Registered | null> {
  const now = new Date(d.now());
  const hash = codeHash(d.secrets, input.code);
  return d.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; tenant_id: string; customer_id: string; created_by: string | null }[]>`SELECT id,
      tenant_id, customer_id, created_by FROM unattended_registration_codes
      WHERE code_hash = ${hash} AND used_at IS NULL AND expires_at > ${now} FOR UPDATE`;
    const c = rows[0];
    if (!c) return null;
    if (!d.gate.allows({ signed: input.signed, sha256: input.sha256 })) throw new AppError("UNATTENDED_DISABLED");
    const deviceId = newId();
    const dev = await insertDevice(
      tx,
      { id: deviceId, tenantId: c.tenant_id, customerId: c.customer_id, registeredBy: c.created_by },
      input,
      ctx.ip,
      now,
    );
    const used = await tx.unattendedRegistrationCode.updateMany({
      where: { id: c.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, deviceId },
    });
    if (used.count !== 1) throw new AppError("REGISTRATION_CODE_INVALID");
    const contacts = await tx.customerNotifyContact.findMany({
      where: { tenantId: c.tenant_id, customerId: c.customer_id },
      select: { email: true },
    });
    const eventId = newId();
    const emails = contacts.map((x) => x.email);
    await enqueueEventMails(tx, d.secrets, { tenantId: c.tenant_id, eventId, kind: "UN_DEVICE_REGISTERED", emails, now });
    await writeAudit(tx, ctx, {
      tenantId: c.tenant_id,
      username: "device",
      action: UNATTENDED_AUDIT.DEVICE_REGISTERED,
      entity: "unattended_devices",
      entityId: deviceId,
      result: "success",
      newValue: { customerId: c.customer_id, name: input.name, version: input.version, signed: input.signed, ip: ctx.ip, eventId },
    });
    return { deviceId, tenantId: c.tenant_id, tenantName: dev.tenant.name, customerName: dev.customer.name };
  });
}

/** Commit sonrası: firmadaki `manage` sahiplerine yeni cihaz e-postası (en iyi çaba). */
export function notifyRegistered(d: RegistrationDeps, ctx: AuditContext, r: Registered, input: RegisterDeviceData): void {
  void sendInternalNotice({
    db: d.db,
    mail: d.mail,
    ctx,
    tenantId: r.tenantId,
    actor: { userId: null, username: "device" },
    perms: ["unattended.manage"],
    kind: "unattended_device_registered",
    entity: "unattended_devices",
    entityId: r.deviceId,
    content: deviceRegisteredMail({ device: input.name, customer: r.customerName, ip: ctx.ip, at: new Date(d.now()) }),
  }).catch((err: unknown) => d.log.error({ err, event: "unattended_register_notify_failed" }, "yeni cihaz bildirimi gönderilemedi"));
}

export const toRegisterResponse = (r: Registered): RegisterDeviceResponse => ({
  deviceId: r.deviceId,
  tenantName: r.tenantName,
  customerName: r.customerName,
});

// ------------------------------------------------------------------------------------------- POST /register (cihaz)

/** IP 10/sa; IP başına 5 yanlış kodda 15 dk kilit; sistem geneli yalnız BAŞARISIZ denemeler 100/sa (D-P27-1, K-P27-21). */
export interface RegisterLimits {
  perIp: FixedWindowCounter;
  badCode: FixedWindowCounter;
  globalFail: FixedWindowCounter;
}

const GLOBAL = "global";

function limited(d: RegistrationDeps, result: string, retryAfterSec: number): AppError {
  d.metrics.inc("rs_unattended_register_total", { result });
  return new AppError("RATE_LIMITED", { retryAfterSec: retryAfterSec || 60 });
}

async function failAudit(d: RegistrationDeps, ctx: AuditContext, reason: string): Promise<void> {
  await writeAudit(d.db, ctx, {
    username: "device",
    action: UNATTENDED_AUDIT.DEVICE_REGISTERED,
    entity: "unattended_devices",
    result: "fail",
    newValue: { reason, ip: ctx.ip },
  });
}

/** Geçersiz kod yolu: sayaçlar → (tavan aşıldıysa) 429, değilse tek gövde 404 (yok/kullanılmış/süresi dolmuş ayrımı yok). */
async function invalidCode(d: RegistrationDeps, limits: RegisterLimits, ctx: AuditContext): Promise<AppError> {
  limits.badCode.hit(ctx.ip);
  const capped = limits.globalFail.blockedFor(GLOBAL) > 0 || limits.globalFail.hit(GLOBAL);
  await failAudit(d, ctx, capped ? "cap" : "invalid_code");
  if (capped) return limited(d, "cap", limits.globalFail.blockedFor(GLOBAL));
  d.metrics.inc("rs_unattended_register_total", { result: "invalid_code" });
  return new AppError("REGISTRATION_CODE_INVALID");
}

const isUniqueViolation = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === "P2002";

export async function registerDevice(
  d: RegistrationDeps,
  limits: RegisterLimits,
  req: FastifyRequest,
  parse: () => RegisterDeviceData,
): Promise<RegisterDeviceResponse> {
  checkPublicClient(req, "AGENT");
  const ctx = auditContext(req);
  const locked = limits.badCode.blockedFor(ctx.ip);
  if (locked > 0) throw limited(d, "rate", locked);
  if (limits.perIp.hit(ctx.ip)) throw limited(d, "rate", limits.perIp.blockedFor(ctx.ip));
  const input = parse();
  if (!d.gate.status().available) {
    d.metrics.inc("rs_unattended_register_total", { result: "disabled" });
    throw new AppError("UNATTENDED_DISABLED");
  }
  let out: Registered | null;
  try {
    out = await registerTx(d, ctx, input);
  } catch (err) {
    if (err instanceof AppError && err.code === "UNATTENDED_DISABLED")
      d.metrics.inc("rs_unattended_register_total", { result: "disabled" });
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", { message: "Bu cihaz anahtarı zaten kayıtlı." });
    throw err;
  }
  if (!out) throw await invalidCode(d, limits, ctx);
  d.metrics.inc("rs_unattended_register_total", { result: "ok" });
  notifyRegistered(d, ctx, out, input);
  return toRegisterResponse(out);
}
