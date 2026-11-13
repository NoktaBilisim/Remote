// Panel tarafı talep işlemleri (AC-146..148, 152, 153, 155, 157; mimari-api "Panel"). Kapsam: tenantScope (Super Admin firma
// seçmeli). Kabul TX'i (mimari-e9 §3.4): teknisyen satırı FOR UPDATE → açık oturum sınırı → koşullu UPDATE → oturum INSERT
// → audit → commit; bellek (ön-kabul, ticket, hub) commit sonrası.
import type {
  AcceptRequestResponse,
  ListRequestsQuery,
  NetworkMatch,
  RequestStatus,
  CancelReason,
  SupportRequestItem,
  SupportRequestListResponse,
  SupportRequestSettings,
  UpdateRequestSettingsData,
  WhatsappTestResponse,
} from "@remote/contracts/api/requests";
import { REQUEST_CONNECT_WINDOW_SEC, REQUEST_HISTORY_DAYS, SMTP_REQUIRED_MESSAGE } from "@remote/contracts/api/requests";
import { maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { AppError } from "../lib/errors.ts";
import type { CustomerStatus } from "@remote/contracts/api/customers";
import { countRevoked } from "../bindings/service.ts";
import * as brepo from "../bindings/repo.ts";
import * as crepo from "../customers/repo.ts";
import { conflictIndex } from "../lib/db.ts";
import { newId, newSecretToken, newTenantRef, sha256Hex } from "../lib/ids.ts";
import { newTechVerifyCode } from "../sessions/codes.ts";
import * as srepo from "../sessions/repo.ts";
import { fileLabelOf, requestDownloadUrl, requestFileName } from "./ref.ts";
import * as repo from "./repo.ts";
import type { RequestService } from "./service.ts";

const DAY_MS = 86_400_000;
const REF_ATTEMPTS = 5;

const who = (auth: AuthContext, tenantId: string) => ({ tenantId, userId: auth.user.id, username: auth.user.email });
const sec = (ms: number): number => Math.max(0, Math.floor(ms / 1000));

/**
 * `generalRotatedAt`: tenant Genel ref'inin son yenilenmesi (staleSource, §15.1). Müşteri ref'inde müşterinin
 * `refRotatedAt`'i; kayıtla açılanda kayıt geçersizse bayat.
 */
export function toItem(r: repo.ItemRow, now: number, generalRotatedAt: Date | null): SupportRequestItem {
  const bindingActive = r.bindingId !== null && r.binding?.revokedAt === null;
  const rotatedAt = r.customer ? r.customer.refRotatedAt : generalRotatedAt;
  const staleSource = r.bindingId !== null ? !bindingActive : rotatedAt !== null && r.createdAt.getTime() < rotatedAt.getTime();
  const end = r.status === "PENDING" ? now : (r.acceptedAt ?? r.closedAt ?? r.createdAt).getTime();
  return {
    id: r.id,
    requestCode: r.requestCode,
    networkMatch: r.networkMatch as NetworkMatch,
    knownDevice: r.knownDevice,
    status: r.status as RequestStatus,
    cancelReason: (r.cancelReason as CancelReason | null) ?? null,
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
    waitSec: sec(end - r.createdAt.getTime()),
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    description: r.description,
    clientVersion: r.clientVersion,
    acceptedBy: r.acceptor ? { id: r.acceptor.id, name: r.acceptor.fullName } : null,
    rejectMessage: r.rejectMessage,
    sessionId: r.session?.id ?? null,
    customerFirm: r.customer ? { id: r.customer.id, name: r.customer.name, status: r.customer.status as CustomerStatus } : null,
    viaBinding: bindingActive,
    bindingRevoked: r.bindingId !== null && !bindingActive,
    staleSource,
  };
}

/** Tenant Genel ref'inin son yenileme anı (staleSource); ayar yoksa null. */
export async function generalRotatedAt(svc: RequestService, tenantId: string): Promise<Date | null> {
  return (await repo.settingsByTenant(svc.d.db, tenantId))?.refRotatedAt ?? null;
}

export async function listRequests(svc: RequestService, tenantId: string, q: ListRequestsQuery): Promise<SupportRequestListResponse> {
  const now = svc.d.clock.now();
  const rotated = await generalRotatedAt(svc, tenantId);
  if (q.tab === "pending") {
    const { rows, total } = await repo.listPending(svc.d.db, tenantId, q.customer);
    return { items: rows.map((r) => toItem(r, now, rotated)), page: 1, pageSize: rows.length, total };
  }
  const since = new Date(now - REQUEST_HISTORY_DAYS * DAY_MS);
  const { rows, total } = await repo.listHistory(svc.d.db, tenantId, since, q.status, { skip: (q.page - 1) * q.pageSize, take: q.pageSize }, q.customer);
  return { items: rows.map((r) => toItem(r, now, rotated)), page: q.page, pageSize: q.pageSize, total };
}

export async function getRequest(svc: RequestService, tenantId: string, id: string): Promise<SupportRequestItem> {
  const r = await repo.findItem(svc.d.db, tenantId, id);
  if (!r) throw new AppError("NOT_FOUND");
  return toItem(r, svc.d.clock.now(), await generalRotatedAt(svc, tenantId));
}

/** count=0 sonrası sınıflandırma (AC-153): yok → 404; kabul edilmiş → REQUEST_TAKEN; diğer kapalı → REQUEST_CLOSED. */
async function lostRace(svc: RequestService, tenantId: string, id: string): Promise<AppError> {
  const r = await repo.findStatusInTenant(svc.d.db, tenantId, id);
  if (!r) return new AppError("NOT_FOUND");
  if (r.status === "ACCEPTED" || r.status === "CONNECT_FAILED" || (r.status === "CANCELLED" && r.acceptedBy)) return new AppError("REQUEST_TAKEN");
  return new AppError("REQUEST_CLOSED");
}

async function acceptLimit(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string): Promise<void> {
  await svc.limit(ctx, tenantId, "accept", "req.accept", "user", auth.user.id);
}

/** POST /support-requests/:id/accept (AC-153, 154). */
export async function acceptRequest(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<AcceptRequestResponse> {
  // Oturum yalnız teknisyenin kendi tenant'ında açılır (P2 kuralı; Super Admin seçili firmada görüntüler, kabul edemez).
  if (auth.user.tenantId !== tenantId) throw new AppError("FORBIDDEN", { message: "Talep yalnız kendi firmanızda kabul edilebilir." });
  await acceptLimit(svc, ctx, auth, tenantId);
  const { db } = svc.d;
  const res = await db.$transaction(async (tx) => {
    await srepo.lockTechnician(tx, auth.user.id);
    const settings = await srepo.sessionSettings(tx, tenantId);
    if (!settings) throw new Error("tenant_settings satırı yok");
    const now = new Date(svc.d.clock.now());
    if ((await srepo.countOpen(tx, auth.user.id, now)) >= settings.maxOpenSessions) throw new AppError("OPEN_SESSION_LIMIT");
    // B-P8c-1: müşterili talepte müşteri, talep satırından ÖNCE paylaşımlı kilitlenir (pasife alma ile aynı sıra:
    // customers → support_requests; kilitlenme yok). Pasifse kabul edilmez; talep commit sonrası CUSTOMER_PASSIVE iptal.
    const head = await repo.findStatusInTenant(tx, tenantId, id);
    if (head?.status === "PENDING" && head.customerId && (await crepo.shareStatus(tx, tenantId, head.customerId)) !== "ACTIVE") return "customer_passive" as const;
    if ((await repo.acceptPending(tx, tenantId, id, auth.user.id, now)) === 0) return null;
    const r = await repo.findById(tx, id);
    if (!r) throw new Error("request_missing_after_accept");
    const sessionId = newId();
    const techVerifyCode = newTechVerifyCode();
    await srepo.insertSession(tx, {
      id: sessionId,
      tenantId,
      technicianId: auth.user.id,
      tokenHash: sha256Hex(newSecretToken()), // hiç döndürülmez (§3.3)
      activeCode: null,
      techVerifyCode,
      status: "PENDING",
      createdAt: now,
      expiresAt: new Date(now.getTime() + REQUEST_CONNECT_WINDOW_SEC * 1000),
      requestId: id,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerId: r.customerId, // P8c AC-177: talebin müşterisi oturuma kopyalanır (aynı tenant — bileşik FK)
    });
    const waitSec = sec(now.getTime() - r.createdAt.getTime());
    await writeAudit(tx, ctx, { ...who(auth, tenantId), action: "request.accepted", entity: "support_requests", entityId: id, result: "success", oldValue: { status: "PENDING" }, newValue: { status: "ACCEPTED", sessionId, waitSec } });
    return { r, sessionId, techVerifyCode, now };
  });
  if (res === "customer_passive") {
    await svc.cancelSystem(id, "CUSTOMER_PASSIVE");
    throw new AppError("REQUEST_CLOSED");
  }
  if (!res) throw await lostRace(svc, tenantId, id);

  // commit sonrası (§3.4): ön-kabullü misafir + ticket → bekleyen istemciye; panellere kaldırma; 60 sn penceresi.
  const { r, sessionId, techVerifyCode, now } = res;
  const ticket = svc.d.rooms.preAdmitGuest(
    { id: sessionId, tenantId, technicianId: auth.user.id, technician: { fullName: auth.user.fullName }, expiresAt: new Date(now.getTime() + REQUEST_CONNECT_WINDOW_SEC * 1000) },
    {
      requestId: id,
      name: r.customerName ?? "Müşteri",
      ...(r.customerEmail ? { email: r.customerEmail } : {}),
      clientVersion: r.clientVersion,
      consent: { textId: r.consentTextId, version: r.consentText.version, sha256: r.consentSha256, at: now, ip: "", userAgent: "" },
    },
  );
  svc.d.hub.clearDisconnect(id);
  svc.d.hub.sendToRequest(id, { t: "request.accepted", wsTicket: ticket.wsTicket, technicianName: auth.user.fullName.slice(0, 100), techVerifyCode, ticketExpiresAt: new Date(ticket.expiresAt).toISOString() });
  svc.d.hub.publish(tenantId, { t: "request.removed", id, status: "ACCEPTED" });
  svc.d.hub.queueChanged(tenantId);
  await svc.publishCount(tenantId);
  svc.startConnectTimer(id);
  return { sessionId, consoleUrl: `/sessions/${sessionId}/console` };
}

/** POST /support-requests/:id/reject (AC-157). */
export async function rejectRequest(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string, message: string): Promise<void> {
  // AC-148 / sapma 2: Super Admin (firma seçmiş olsa da) ret yapamaz — acceptRequest ile aynı kural.
  if (auth.user.tenantId !== tenantId) throw new AppError("FORBIDDEN", { message: "Talep yalnız kendi firmanızda reddedilebilir." });
  await acceptLimit(svc, ctx, auth, tenantId);
  const ok = await svc.d.db.$transaction(async (tx) => {
    const now = new Date(svc.d.clock.now());
    if ((await repo.rejectPending(tx, tenantId, id, auth.user.id, message, now)) === 0) return false;
    await writeAudit(tx, ctx, { ...who(auth, tenantId), action: "request.rejected", entity: "support_requests", entityId: id, result: "success", oldValue: { status: "PENDING" }, newValue: { status: "REJECTED", message } });
    return true;
  });
  if (!ok) throw await lostRace(svc, tenantId, id);
  svc.d.hub.closeRequest(id, { t: "request.closed", status: "REJECTED", message });
  svc.d.hub.publish(tenantId, { t: "request.removed", id, status: "REJECTED" });
  svc.d.hub.queueChanged(tenantId);
  await svc.publishCount(tenantId);
}

// ------------------------------------------------------------------ ayarlar (settings.edit)

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

function settingsView(svc: RequestService, s: repo.SettingsRow, smtpConfigured: boolean): SupportRequestSettings {
  const n = svc.d.notifier;
  return {
    downloadUrl: requestDownloadUrl(svc.d.env.PUBLIC_BASE_URL, s.requestRef),
    fileName: requestFileName(s.fileLabel, s.requestRef),
    refPrefix: s.requestRef.slice(0, 4),
    refRotatedAt: s.refRotatedAt?.toISOString() ?? null,
    waitMinutes: s.waitMinutes,
    trustedCidrs: repo.jsonStrings(s.trustedCidrs),
    whatsapp: { enabled: s.waEnabled, recipients: repo.jsonStrings(s.waRecipients), serviceConfigured: n.configured, insecure: n.insecure },
    email: { enabled: s.emailEnabled, recipients: repo.jsonStrings(s.emailRecipients), smtpConfigured },
  };
}

export async function getSettings(svc: RequestService, tenantId: string): Promise<SupportRequestSettings> {
  const row = await ensureSettings(svc, tenantId);
  return settingsView(svc, row, (await svc.d.mail.configFor(tenantId)) !== null);
}

const auditShape = (s: { waitMinutes: number; trustedCidrs: string[]; waEnabled: boolean; waRecipients: string[]; emailEnabled: boolean; emailRecipients: string[] }) => ({
  waitMinutes: s.waitMinutes,
  trustedCidrs: s.trustedCidrs,
  waEnabled: s.waEnabled,
  waRecipients: s.waRecipients.map(maskPhone),
  emailEnabled: s.emailEnabled,
  emailRecipients: s.emailRecipients,
});

/** PUT /settings/support-requests (AC-142, 151, 152): SMTP ayarlı değilse e-posta kanalı açılamaz. Audit eski→yeni (alıcılar maskeli). */
export async function updateSettings(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string, input: UpdateRequestSettingsData): Promise<SupportRequestSettings> {
  if (input.email.enabled && (await svc.d.mail.configFor(tenantId)) === null) throw new AppError("VALIDATION", { fields: { "email.enabled": SMTP_REQUIRED_MESSAGE } });
  await ensureSettings(svc, tenantId);
  await svc.d.db.$transaction(async (tx) => {
    const before = await repo.settingsByTenant(tx, tenantId);
    if (!before) throw new Error("settings_missing");
    await repo.updateSettings(tx, tenantId, {
      waitMinutes: input.waitMinutes,
      trustedCidrs: input.trustedCidrs,
      waEnabled: input.whatsapp.enabled,
      waRecipients: input.whatsapp.recipients,
      emailEnabled: input.email.enabled,
      emailRecipients: input.email.recipients,
    });
    const old = { waitMinutes: before.waitMinutes, trustedCidrs: repo.jsonStrings(before.trustedCidrs), waEnabled: before.waEnabled, waRecipients: repo.jsonStrings(before.waRecipients), emailEnabled: before.emailEnabled, emailRecipients: repo.jsonStrings(before.emailRecipients) };
    const next = { waitMinutes: input.waitMinutes, trustedCidrs: input.trustedCidrs, waEnabled: input.whatsapp.enabled, waRecipients: input.whatsapp.recipients, emailEnabled: input.email.enabled, emailRecipients: input.email.recipients };
    await writeAudit(tx, ctx, { ...who(auth, tenantId), action: "settings.support_requests.updated", entity: "tenant_request_settings", entityId: tenantId, result: "success", oldValue: auditShape(old), newValue: auditShape(next) });
  });
  return getSettings(svc, tenantId);
}

/**
 * POST /settings/support-requests/rotate-ref (AC-131): eski ref anında geçersiz; bekleyen talepler etkilenmez.
 * P8c (AC-185, mimari-e10 §3.4): aynı TX'te yeni ref ad alanına yazılır ve Genel kayıtlar `GENERAL_ROTATED` olur.
 */
export async function rotateRef(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string): Promise<SupportRequestSettings> {
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
        await writeAudit(tx, ctx, { ...who(auth, tenantId), action: "settings.support_requests.ref_rotated", entity: "tenant_request_settings", entityId: tenantId, result: "success", oldValue: { refPrefix: before.requestRef.slice(0, 4) }, newValue: { refPrefix: ref.slice(0, 4), revokedBindings: revoked } });
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
export async function whatsappTest(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string, phone: string): Promise<WhatsappTestResponse> {
  await svc.limit(ctx, tenantId, "waTest", "req.wa_test", "tenant", tenantId);
  const n = svc.d.notifier;
  if (!n.configured) throw new AppError("UPSTREAM", { message: "Servis yapılandırılmamış." });
  if (n.insecure) throw new AppError("UPSTREAM", { message: "Servis güvenli yapılandırılmamış." });
  const out = await n.test(phone);
  await writeAudit(svc.d.db, ctx, { ...who(auth, tenantId), action: "settings.whatsapp.test", entity: "tenant_request_settings", entityId: tenantId, result: out.ok ? "success" : "fail", newValue: { recipient: maskPhone(phone), result: out.ok ? "success" : "fail" } });
  svc.d.metrics.inc("rs_request_notify_total", { channel: "whatsapp_test", result: out.ok ? "ok" : "failed" });
  return { ok: out.ok, message: out.message }; // AC-152: adres/neden tenant yanıtına girmez
}
