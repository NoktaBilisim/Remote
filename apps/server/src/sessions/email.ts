// POST /sessions/:id/email (P10; AC-10, G-23). Oturum bağlantısını müşteriye tenant SMTP'siyle gönderir.
//  - Yalnız oturumun kendi teknisyeni, PENDING ve süresi dolmamış oturum (aksi 404 / 409).
//  - Bağlantı istemciden gelir (düz token DB'de yok): `${PUBLIC_BASE_URL}/session/<token>` ve SHA-256(token) bu oturumun
//    token_hash'i olmalı → başka adres gönderilemez (oltalama aracı olmaz).
//  - 20/sa/teknisyen: TX + `users FOR UPDATE` + audit `session.email` sayımı (P2 kalıbı; yeniden başlatmaya dayanıklı).
//    Sayım satırı gönderimden ÖNCE yazılır (rezervasyon); sonuç ayrıca `mail.sent` audit'inde.
import { SMTP_REQUIRED_MESSAGE } from "@remote/contracts/api/requests";
import { SESSION_EMAIL_PER_HOUR, sessionTokenSchema } from "@remote/contracts/api/sessions";
import { SMTP_SEND_FAILED_MESSAGE } from "@remote/contracts/api/tenants";
import { MAIL_AUDIT } from "@remote/contracts/audit";
import { maskEmail } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { AppError } from "../lib/errors.ts";
import { safeEqual, sha256Hex } from "../lib/ids.ts";
import type { MailService } from "../mail/service.ts";
import { sessionLinkMail } from "../mail/templates.ts";
import { lockTechnician } from "./repo.ts";

const HOUR_MS = 3_600_000;

function tokenFromLink(publicBaseUrl: string, link: string): string | null {
  const prefix = `${publicBaseUrl.replace(/\/+$/, "")}/session/`;
  if (!link.startsWith(prefix)) return null;
  const t = sessionTokenSchema.safeParse(link.slice(prefix.length));
  return t.success ? t.data : null;
}

export async function emailSessionLink(mail: MailService, publicBaseUrl: string, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string, input: { to: string; link: string }): Promise<void> {
  const db = mail.d.db;
  const s = await db.supportSession.findFirst({ where: { id, tenantId, technicianId: auth.user.id }, select: { status: true, expiresAt: true, tokenHash: true, activeCode: true, tenant: { select: { name: true } } } });
  if (!s) throw new AppError("NOT_FOUND");
  const now = new Date();
  if (s.status !== "PENDING" || s.expiresAt <= now || !s.activeCode) throw new AppError("CONFLICT", { message: "Yalnız bekleyen oturumun bağlantısı gönderilebilir." });
  const token = tokenFromLink(publicBaseUrl, input.link);
  if (!token || !safeEqual(sha256Hex(token), s.tokenHash)) throw new AppError("VALIDATION", { fields: { link: "Bağlantı bu oturuma ait değil." } });
  const cfg = await mail.configFor(tenantId);
  if (!cfg) throw new AppError("UPSTREAM", { message: SMTP_REQUIRED_MESSAGE });
  const content = sessionLinkMail({ publicBaseUrl, firm: s.tenant.name, technician: auth.user.fullName, link: input.link, code: s.activeCode, expiresAt: s.expiresAt });
  const who = { tenantId, userId: auth.user.id, username: auth.user.email };

  await db.$transaction(async (tx) => {
    await lockTechnician(tx, auth.user.id);
    const since = new Date(now.getTime() - HOUR_MS);
    const rows = await tx.auditLog.findMany({ where: { tenantId, userId: auth.user.id, action: MAIL_AUDIT.SESSION_EMAIL, createdAt: { gte: since } }, select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: SESSION_EMAIL_PER_HOUR });
    if (rows.length >= SESSION_EMAIL_PER_HOUR) {
      const oldest = rows[0]?.createdAt.getTime() ?? now.getTime();
      throw new AppError("RATE_LIMITED", { retryAfterSec: Math.max(1, Math.ceil((oldest + HOUR_MS - now.getTime()) / 1000)) });
    }
    await writeAudit(tx, ctx, { ...who, action: MAIL_AUDIT.SESSION_EMAIL, entity: "support_sessions", entityId: id, result: "success", newValue: { recipient: maskEmail(input.to), subject: content.subject } });
  });
  const out = await mail.sendForTenant(ctx, { ...who, kind: "session_link", entity: "support_sessions", entityId: id }, input.to, content, cfg, { interactive: true });
  if (!out.ok) throw new AppError("UPSTREAM", { message: SMTP_SEND_FAILED_MESSAGE }); // B-P10-1: tek genel mesaj
}
