// POST /api/v1/settings/smtp/test (P10; AC-80, 122, G-12). settings.edit, etkin tenant; 5/dk/tenant (6. → 429).
// Kayıtlı SMTP ayarıyla test maili; netguard (özel/loopback hedef → 400 HOST_NOT_ALLOWED); hata → 502 tek genel mesaj
// (B-P10-1: sınıf yalnız log/audit'te; etkileşimli gönderim → başarısızlık yanıtı sabit süre tabanında).
import { SMTP_REQUIRED_MESSAGE } from "@remote/contracts/api/requests";
import { SMTP_SEND_FAILED_MESSAGE, smtpTestInputSchema, type SmtpTestResponse } from "@remote/contracts/api/tenants";
import { MAIL_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance } from "fastify";
import { maskEmail } from "../audit/mask.ts";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import type { AuthContext } from "../auth/session.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import type { MailService, SmtpFailure } from "../mail/service.ts";
import type { MailContent } from "../mail/templates.ts";
import { smtpTestMail } from "../mail/templates.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";

/** SMTP + e-posta kanal testi ortak gövdesi: limit → ayar → gönderim → audit. Dönen: başarı ya da hata nedeni. */
export async function sendTenantTest(o: {
  mail: MailService;
  limit: FixedWindowCounter;
  ctx: AuditContext;
  auth: AuthContext;
  tenantId: string;
  to: string;
  action: string;
  entity: string;
  content: (firm: string) => MailContent;
}): Promise<{ ok: true } | { ok: false; reason: SmtpFailure }> {
  const wait = o.limit.blockedFor(o.tenantId);
  if (wait > 0 || o.limit.hit(o.tenantId)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  const cfg = await o.mail.configFor(o.tenantId);
  if (!cfg) throw new AppError("UPSTREAM", { message: SMTP_REQUIRED_MESSAGE });
  await o.mail.d.netguard.resolve(cfg.host); // AC-122: yasak hedef → 400 HOST_NOT_ALLOWED (gönderimden önce)
  const tenant = await o.mail.d.db.tenant.findUniqueOrThrow({ where: { id: o.tenantId }, select: { name: true } });
  const who = { tenantId: o.tenantId, userId: o.auth.user.id, username: o.auth.user.email };
  const out = await o.mail.sendForTenant(
    o.ctx,
    { ...who, kind: o.action, entity: o.entity, entityId: o.tenantId },
    o.to,
    o.content(tenant.name),
    cfg,
    { interactive: true },
  );
  await writeAudit(o.mail.d.db, o.ctx, {
    ...who,
    action: o.action,
    entity: o.entity,
    entityId: o.tenantId,
    result: out.ok ? "success" : "fail",
    newValue: { recipient: maskEmail(o.to), result: out.ok ? "success" : "fail", ...(out.ok ? {} : { reason: out.reason }) },
  });
  if (out.ok) return { ok: true };
  return { ok: false, reason: out.reason === "not_configured" ? "connect" : out.reason };
}

export async function smtpSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });

  app.post("/test", { preHandler: requirePerm("settings.edit") }, async (req): Promise<SmtpTestResponse> => {
    const { tenantId } = tenantScope(req);
    const { to } = parseInput(smtpTestInputSchema, req.body);
    const out = await sendTenantTest({
      mail: app.mail,
      limit: app.smtpTestLimit,
      ctx: auditContext(req),
      auth: authOf(req),
      tenantId,
      to,
      action: MAIL_AUDIT.SMTP_TEST,
      entity: "tenant_settings",
      content: (firm) => smtpTestMail({ firm }),
    });
    if (!out.ok) throw new AppError("UPSTREAM", { message: SMTP_SEND_FAILED_MESSAGE });
    return { ok: true, message: "Test e-postası gönderildi." };
  });
}
