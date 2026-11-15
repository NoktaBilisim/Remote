// P27a commit sonrası bildirimler (mimari-p27a K-P27a-10; AC-335a, AC-335b): akışı bekletmez, hata yanıtı bozmaz
// (`void … .catch` + log). E-postada bağlantı/belirteç yok (templates.ts).
import type { AuditContext } from "../audit/service.ts";
import { trustedDeviceCreatedMail, trustedDeviceReuseMail } from "../mail/templates.ts";
import type { MailService } from "../mail/service.ts";
import type { IssuedTrustedDevice, TrustedDeviceOwner } from "./trusted-device.ts";

export interface TrustedDeviceNotifyDeps {
  mail: MailService;
  log: { error(o: object, m: string): void };
  /** Yeniden kullanımda iptal edilen oturumların canlı odaları + panel soketleri (logout-all kalıbı). */
  endLive(userId: string): Promise<void>;
}

const mailMeta = (u: TrustedDeviceOwner, kind: string) => ({
  tenantId: u.tenantId,
  userId: u.id,
  username: u.email,
  kind,
  entity: "users",
  entityId: u.id,
});

/** AC-335a: "Yeni cihaz hatırlandı" (SMTP yoksa `mail.sent{not_configured}` audit'i). */
export function notifyTrustedDeviceCreated(
  d: TrustedDeviceNotifyDeps,
  ctx: AuditContext,
  user: TrustedDeviceOwner,
  dev: IssuedTrustedDevice,
): void {
  const content = trustedDeviceCreatedMail({ uaSummary: dev.uaSummary, ip: dev.ip, at: new Date() });
  void d.mail
    .sendForTenant(ctx, mailMeta(user, "trusted_device_created"), user.email, content)
    .catch((err: unknown) => d.log.error({ err, event: "trusted_device_notify_failed" }, "yeni cihaz bildirimi gönderilemedi"));
}

/** AC-335b: yeniden kullanım e-postası + iptal edilen oturumların canlı etkisi. */
export function afterTrustedDeviceReuse(d: TrustedDeviceNotifyDeps, ctx: AuditContext, user: TrustedDeviceOwner): void {
  void d.mail
    .sendForTenant(ctx, mailMeta(user, "trusted_device_reuse"), user.email, trustedDeviceReuseMail({ at: new Date() }))
    .catch((err: unknown) => d.log.error({ err, event: "trusted_device_notify_failed" }, "yeniden kullanım bildirimi gönderilemedi"));
  void d
    .endLive(user.id)
    .catch((err: unknown) => d.log.error({ err, alarm: "user_live_effect" }, "yeniden kullanım iptali canlı oturuma yansıtılamadı"));
}
