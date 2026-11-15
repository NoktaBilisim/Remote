// P27 imza kapısı (mimari-p27 §4.5; AC-297, 342). Env `UNATTENDED_MODE`: `off` her şey kapalı; `unsigned` (yalnız staging —
// env.ts zorlar) beyandan bağımsız açık; `signed` beyan `signed=true` ∧ SHA-256 listede. Cihaz beyanına dayanır → kimlik
// doğrulama DEĞİL, kullanılabilirlik kapısıdır (beyan sahtelenebilir; güvenlik AC-273, 293..296'ya dayanır).
import type { UnattendedMode, UnattendedStatus } from "@remote/contracts/api/unattended";
import type { Env } from "../env.ts";

export interface DeviceDeclaration {
  signed: boolean;
  sha256: string;
}

export interface UnattendedGate {
  readonly mode: UnattendedMode;
  status(): UnattendedStatus;
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
      return d.signed && list.has(d.sha256.toLowerCase());
    },
  };
}
