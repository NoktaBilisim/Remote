// P27 imza kapısı (mimari-p27 §4.5; AC-297, 342). Env `UNATTENDED_MODE`: `off` her şey kapalı; `unsigned` (yalnız staging —
// env.ts zorlar) beyandan bağımsız açık; `signed` beyan `signed=true` ∧ SHA-256 listede. Cihaz beyanına dayanır → kimlik
// doğrulama DEĞİL, kullanılabilirlik kapısıdır (beyan sahtelenebilir; güvenlik AC-273, 293..296'ya dayanır).
// P32 (mimari-p32 §4.2, ADR-0042; AC-525): `unsigned-accepted` (production|staging) imza beyanından bağımsız, SHA listede.
import type { UnattendedMode, UnattendedStatus } from "@remote/contracts/api/unattended";
import { listFingerprint, normalizeShaList, type Env } from "../env.ts";
import type { MailService } from "../mail/service.ts";

/** Yalnız mod kapısının kısmı; `notifyChannel` firma SMTP'sine bağlıdır (`unattendedStatus`). */
export type GateStatus = Omit<UnattendedStatus, "notifyChannel">;

export interface DeviceDeclaration {
  signed: boolean;
  sha256: string;
}

export interface UnattendedGate {
  readonly mode: UnattendedMode;
  status(): GateStatus;
  /** Bu beyanla kayıt/auth/bağlantı açık mı (mod + imza + liste). */
  allows(d: DeviceDeclaration): boolean;
}

export function createGate(env: Pick<Env, "UNATTENDED_MODE" | "unattendedSignedSha256">): UnattendedGate {
  const mode = env.UNATTENDED_MODE;
  const list = env.unattendedSignedSha256;
  return {
    mode,
    status: () => ({ mode, available: mode !== "off" }),
    allows: (d) => {
      if (mode === "off") return false;
      if (mode === "unsigned") return true;
      if (mode === "unsigned-accepted") return list.has(d.sha256.toLowerCase());
      return d.signed && list.has(d.sha256.toLowerCase());
    },
  };
}

/** P32 (AC-527a): açılış alarm satırının alanları; SHA'lar yazılmaz, yalnız sayı + parmak izi (`listFingerprint`). */
export interface RiskAcceptedAlarm {
  alarm: "unattended_unsigned_risk_accepted";
  allowedCount: number;
  listFingerprint: string;
}

/** `unsigned-accepted` modda açılışta bir kez `warn` yazılacak nesne; diğer modlarda null (server.ts çağırır). */
export function riskAcceptedAlarm(env: Pick<Env, "UNATTENDED_MODE" | "UNATTENDED_SIGNED_SHA256">): RiskAcceptedAlarm | null {
  if (env.UNATTENDED_MODE !== "unsigned-accepted") return null;
  return {
    alarm: "unattended_unsigned_risk_accepted",
    allowedCount: normalizeShaList(env.UNATTENDED_SIGNED_SHA256).length,
    listFingerprint: listFingerprint(env.UNATTENDED_SIGNED_SHA256),
  };
}

/** GET /unattended/status: kapı + firmanın kendi SMTP kaydı (kayıt kodu/bağlantıdaki `configFor` denetimiyle aynı). */
export async function unattendedStatus(
  gate: UnattendedGate,
  mail: Pick<MailService, "configFor">,
  tenantId: string | null,
): Promise<UnattendedStatus> {
  const notifyChannel = tenantId !== null && (await mail.configFor(tenantId)) !== null;
  return { ...gate.status(), notifyChannel };
}
