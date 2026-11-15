// P27 `POST /unattended/register` cihaz ucu (mimari-p27 §4.2; AC-273, 297, 339; D-P27-1, D-P27-K3): AGENT istemci kuralı,
// ipKey (IPv4 adres / IPv6 /64) kovaları, kayıt TX'i (registration.ts) ve tek gövde 404. Kayıt kodu/imza loga yazılmaz.
import type { FastifyRequest } from "fastify";
import type { RegisterDeviceData, RegisterDeviceResponse } from "@remote/contracts/api/unattended";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { checkPublicClient } from "../auth/guards.ts";
import { AppError } from "../lib/errors.ts";
import { ipKey } from "../lib/ip.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { notifyRegistered, registerTx, toRegisterResponse, type Registered, type RegistrationDeps } from "./registration.ts";

/** ipKey (IPv4 adres, IPv6 /64) 10/sa; ipKey başına 5 yanlış kodda 15 dk kilit; sistem geneli yalnız BAŞARISIZ denemeler 100/sa (D-P27-1, K-P27-21). */
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
  limits.badCode.hit(ipKey(ctx.ip));
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
  const key = ipKey(ctx.ip); // D-P27-K3: IPv6 /64 tek kova
  const locked = limits.badCode.blockedFor(key);
  if (locked > 0) throw limited(d, "rate", locked);
  if (limits.perIp.hit(key)) throw limited(d, "rate", limits.perIp.blockedFor(key));
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
