// P28u izinsiz (`silent`) bağlantı dalı (mimari-p28u §5.1 adım 2a/2b, §9.2; AC-437, 441; "dokunan böler" — connect.ts'ten ayrı).
// 2a `unattended.silent` (403) → 2b firma politikası (409 SILENT_DISABLED); yetkili karar TX'te yeniden (connect-tx.ts). Commit
// sonrası dört göz e-postası (beklenmez). Gerekçe yalnız audit `unattended.connect.silentReason` + DB + e-posta gövdesinde;
// pino'ya yazılmaz.
import type { AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { AppError } from "../lib/errors.ts";
import type { ConnectDeps } from "./connect.ts";
import { Refusal, type Opened } from "./connect-tx.ts";
import { sendSilentNotice, silentConnectMail } from "./mail.ts";
import { silentPolicyEnabled } from "./policy.ts";

/** Adım 2a/2b (kova ve cihaz denetiminden önce). */
export async function silentPrecheck(d: ConnectDeps, auth: AuthContext, tenantId: string): Promise<void> {
  if (!auth.permissions.has("unattended.silent")) throw new Refusal("forbidden", new AppError("FORBIDDEN"));
  if (!(await silentPolicyEnabled(d.db, tenantId))) throw new Refusal("silent_disabled", new AppError("SILENT_DISABLED"));
}

/** §9.2: commit sonrası dört göz e-postası (en iyi çaba, 3 deneme; bağlantıyı durdurmaz). */
export function notifySilentConnect(d: ConnectDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, o: Opened): void {
  if (o.request.consent !== "silent") return;
  const content = silentConnectMail({
    user: auth.user.fullName,
    device: o.deviceName,
    customer: o.customerName,
    at: new Date(d.now()),
    reason: o.request.reason,
  });
  void sendSilentNotice(d, {
    ctx,
    tenantId,
    actor: { userId: auth.user.id, email: auth.user.email },
    event: "connect",
    entity: "support_sessions",
    entityId: o.sessionId,
    content,
  });
}
