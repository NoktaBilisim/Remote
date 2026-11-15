// Talep ayarları (settings.edit; AC-131, 142, 151, 152, 259) — PT-K9: panel.ts'den mekanik taşıma. panel.ts aynı adları
// yeniden dışa verir (çağıranların import'u değişmez).
import type {
  SupportRequestSettings,
  UpdateRequestSettingsData,
  WhatsappTestResponse,
  RequestPriority,
} from "@remote/contracts/api/requests";
import { SMTP_REQUIRED_MESSAGE } from "@remote/contracts/api/requests";
import { maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { countRevoked } from "../bindings/service.ts";
import * as brepo from "../bindings/repo.ts";
import { conflictIndex } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newTenantRef } from "../lib/ids.ts";
import { fileLabelOf, requestDownloadUrl, requestFileName } from "./ref.ts";
import * as repo from "./repo.ts";
import type { ChannelAvailability, RequestService } from "./service.ts";

const REF_ATTEMPTS = 5;

export const who = (auth: AuthContext, tenantId: string) => ({ tenantId, userId: auth.user.id, username: auth.user.email });

const isRefConflict = (err: unknown): boolean => conflictIndex(err) !== null;

/**
 * Tembel oluşturma (mimari-e9 §3.1): satır yoksa yeni ref (çakışmada 5 deneme). Eşzamanlı oluşturmada mevcut satır okunur.
 * P8c (ADR-0006 r5): ref önce tek ad alanına (`request_refs`), aynı TX'te ayar satırı.
 */
export async function ensureSettings(svc: RequestService, tenantId: string): Promise<repo.SettingsRow> {
  const { db } = svc.d;
  for (let attempt = 1; ; attempt++) {
    const existing = await repo.settingsByTenant(db, tenantId);
    if (existing) return existing;
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    if (!tenant) throw new AppError("NOT_FOUND");
    try {
      const ref = newTenantRef();
      await db.$transaction(async (tx) => {
        await repo.insertRequestRef(tx, { ref, tenantId, customerId: null, createdAt: new Date(svc.d.clock.now()) });
        await repo.insertSettings(tx, tenantId, ref, fileLabelOf(tenant.name));
      });
    } catch (err) {
      if (attempt < REF_ATTEMPTS && isRefConflict(err)) continue;
      throw err;
    }
  }
}

/** P19 (AC-259): `${PUBLIC_BASE_URL}/r/<ref>` — müşteriye paylaşılan web talep formu adresi. */
export const webFormUrl = (base: string, ref: string): string => `${base.replace(/\/+$/, "")}/r/${ref}`;

function settingsView(svc: RequestService, s: repo.SettingsRow, avail: ChannelAvailability): SupportRequestSettings {
  const smtpConfigured = avail.smtp;
  const n = svc.d.notifier;
  const enabled = { sms: s.notifySmsEnabled, whatsapp: s.notifyWhatsappEnabled, email: s.notifyEmailEnabled };
  const available = svc.channelsOf(s, avail);
  return {
    downloadUrl: requestDownloadUrl(svc.d.env.PUBLIC_BASE_URL, s.requestRef),
    fileName: requestFileName(s.fileLabel, s.requestRef),
    refPrefix: s.requestRef.slice(0, 4),
    refRotatedAt: s.refRotatedAt?.toISOString() ?? null,
    waitMinutes: s.waitMinutes,
    trustedCidrs: repo.jsonStrings(s.trustedCidrs),
    whatsapp: { enabled: s.waEnabled, recipients: repo.jsonStrings(s.waRecipients), serviceConfigured: n.configured, insecure: n.insecure },
    email: { enabled: s.emailEnabled, recipients: repo.jsonStrings(s.emailRecipients), smtpConfigured },
    requireAcceptCode: s.requireAcceptCode,
    defaultPriority: s.defaultPriority as RequestPriority,
    defaultSlaMinutes: s.defaultSlaMinutes,
    webFormEnabled: s.webFormEnabled,
    webFormUrl: webFormUrl(svc.d.env.PUBLIC_BASE_URL, s.requestRef),
    notifySmsEnabled: s.notifySmsEnabled,
    notifyWhatsappEnabled: s.notifyWhatsappEnabled,
    notifyEmailEnabled: s.notifyEmailEnabled,
    channelWarnings: (["sms", "whatsapp", "email"] as const).filter((k) => enabled[k] && !available[k]),
  };
}

export async function getSettings(svc: RequestService, tenantId: string): Promise<SupportRequestSettings> {
  const row = await ensureSettings(svc, tenantId);
  return settingsView(svc, row, await svc.channelAvailability(tenantId));
}

const auditShape = (s: {
  waitMinutes: number;
  trustedCidrs: string[];
  waEnabled: boolean;
  waRecipients: string[];
  emailEnabled: boolean;
  emailRecipients: string[];
  requireAcceptCode: boolean;
  defaultPriority: string;
  defaultSlaMinutes: number | null;
  webFormEnabled: boolean;
  notifySmsEnabled: boolean;
  notifyWhatsappEnabled: boolean;
  notifyEmailEnabled: boolean;
}) => ({
  waitMinutes: s.waitMinutes,
  trustedCidrs: s.trustedCidrs,
  waEnabled: s.waEnabled,
  waRecipients: s.waRecipients.map(maskPhone),
  emailEnabled: s.emailEnabled,
  emailRecipients: s.emailRecipients,
  requireAcceptCode: s.requireAcceptCode,
  defaultPriority: s.defaultPriority,
  defaultSlaMinutes: s.defaultSlaMinutes,
  webFormEnabled: s.webFormEnabled,
  notifySmsEnabled: s.notifySmsEnabled,
  notifyWhatsappEnabled: s.notifyWhatsappEnabled,
  notifyEmailEnabled: s.notifyEmailEnabled,
});

/** Kayıtlı satırın audit karşılaştırma şekli (JSON dizileri string[]'e). */
const storedShape = (before: repo.SettingsRow) => ({
  waitMinutes: before.waitMinutes,
  trustedCidrs: repo.jsonStrings(before.trustedCidrs),
  waEnabled: before.waEnabled,
  waRecipients: repo.jsonStrings(before.waRecipients),
  emailEnabled: before.emailEnabled,
  emailRecipients: repo.jsonStrings(before.emailRecipients),
  requireAcceptCode: before.requireAcceptCode,
  defaultPriority: before.defaultPriority,
  defaultSlaMinutes: before.defaultSlaMinutes,
  webFormEnabled: before.webFormEnabled,
  notifySmsEnabled: before.notifySmsEnabled,
  notifyWhatsappEnabled: before.notifyWhatsappEnabled,
  notifyEmailEnabled: before.notifyEmailEnabled,
});

/** Yeni ayar değerleri: verilmeyen isteğe bağlı alanlar kayıtlı değerde kalır. */
function nextSettings(input: UpdateRequestSettingsData, before: repo.SettingsRow) {
  // PT-K9: UPDATE verisi ile audit `newValue` kaynağı aynı nesne (önceden iki kopya; alan sırası UPDATE'teki gibi).
  return {
    webFormEnabled: input.webFormEnabled ?? before.webFormEnabled,
    notifySmsEnabled: input.notifySmsEnabled ?? before.notifySmsEnabled,
    notifyWhatsappEnabled: input.notifyWhatsappEnabled ?? before.notifyWhatsappEnabled,
    notifyEmailEnabled: input.notifyEmailEnabled ?? before.notifyEmailEnabled,
    waitMinutes: input.waitMinutes,
    trustedCidrs: input.trustedCidrs,
    waEnabled: input.whatsapp.enabled,
    waRecipients: input.whatsapp.recipients,
    emailEnabled: input.email.enabled,
    emailRecipients: input.email.recipients,
    requireAcceptCode: input.requireAcceptCode ?? before.requireAcceptCode,
    defaultPriority: input.defaultPriority ?? before.defaultPriority,
    defaultSlaMinutes: input.defaultSlaMinutes === undefined ? before.defaultSlaMinutes : input.defaultSlaMinutes,
  };
}

/** PUT /settings/support-requests (AC-142, 151, 152): SMTP ayarlı değilse e-posta kanalı açılamaz. Audit eski→yeni (alıcılar maskeli). */
export async function updateSettings(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: UpdateRequestSettingsData,
): Promise<SupportRequestSettings> {
  if (input.email.enabled && (await svc.d.mail.configFor(tenantId)) === null)
    throw new AppError("VALIDATION", { fields: { "email.enabled": SMTP_REQUIRED_MESSAGE } });
  await ensureSettings(svc, tenantId);
  await svc.d.db.$transaction(async (tx) => {
    const before = await repo.settingsByTenant(tx, tenantId);
    if (!before) throw new Error("settings_missing");
    const next = nextSettings(input, before);
    await repo.updateSettings(tx, tenantId, next);
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: "settings.support_requests.updated",
      entity: "tenant_request_settings",
      entityId: tenantId,
      result: "success",
      oldValue: auditShape(storedShape(before)),
      newValue: auditShape(next),
    });
  });
  return getSettings(svc, tenantId);
}

/**
 * POST /settings/support-requests/rotate-ref (AC-131): eski ref anında geçersiz; bekleyen talepler etkilenmez.
 * P8c (AC-185, mimari-e10 §3.4): aynı TX'te yeni ref ad alanına yazılır ve Genel kayıtlar `GENERAL_ROTATED` olur.
 */
export async function rotateRef(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
): Promise<SupportRequestSettings> {
  await ensureSettings(svc, tenantId);
  let revoked = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      await svc.d.db.$transaction(async (tx) => {
        const before = await repo.settingsByTenant(tx, tenantId);
        if (!before) throw new Error("settings_missing");
        const ref = newTenantRef();
        const now = new Date(svc.d.clock.now());
        await repo.insertRequestRef(tx, { ref, tenantId, customerId: null, createdAt: now });
        await repo.updateSettings(tx, tenantId, { requestRef: ref, fileLabel: fileLabelOf(before.tenant.name), refRotatedAt: now });
        revoked = await brepo.revokeForOwner(tx, tenantId, null, "GENERAL_ROTATED", now);
        await writeAudit(tx, ctx, {
          ...who(auth, tenantId),
          action: "settings.support_requests.ref_rotated",
          entity: "tenant_request_settings",
          entityId: tenantId,
          result: "success",
          oldValue: { refPrefix: before.requestRef.slice(0, 4) },
          newValue: { refPrefix: ref.slice(0, 4), revokedBindings: revoked },
        });
      });
      countRevoked(svc, "GENERAL_ROTATED", revoked);
      break;
    } catch (err) {
      if (attempt < REF_ATTEMPTS && isRefConflict(err)) continue;
      throw err;
    }
  }
  return getSettings(svc, tenantId);
}

/** POST /settings/support-requests/whatsapp/test (AC-152): tenant 5/dk; yapılandırılmamış/güvensiz → 502 UPSTREAM. */
export async function whatsappTest(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  phone: string,
): Promise<WhatsappTestResponse> {
  await svc.limit(ctx, tenantId, "waTest", "req.wa_test", "tenant", tenantId);
  const n = svc.d.notifier;
  if (!n.configured) throw new AppError("UPSTREAM", { message: "Servis yapılandırılmamış." });
  if (n.insecure) throw new AppError("UPSTREAM", { message: "Servis güvenli yapılandırılmamış." });
  const out = await n.test(phone);
  await writeAudit(svc.d.db, ctx, {
    ...who(auth, tenantId),
    action: "settings.whatsapp.test",
    entity: "tenant_request_settings",
    entityId: tenantId,
    result: out.ok ? "success" : "fail",
    newValue: { recipient: maskPhone(phone), result: out.ok ? "success" : "fail" },
  });
  svc.d.metrics.inc("rs_request_notify_total", { channel: "whatsapp_test", result: out.ok ? "ok" : "failed" });
  return { ok: out.ok, message: out.message }; // AC-152: adres/neden tenant yanıtına girmez
}
