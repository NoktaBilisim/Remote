// Outbox satırının içeriği (P19 J3 + P27-K4; mimari-p27 §7.1). Satır tam olarak bir çapa taşır (CHECK): `request_id` →
// talep durum metni; `session_id` → `UNATTENDED_STARTED` (cihaz, teknisyen, başlangıç); `event_id` → `UN_*` güvenlik olayı
// (içerik outbox'ta tutulmaz; aynı TX'te yazılan audit satırından — `new_value.eventId` — okunur). Bulunamazsa null
// (işçi kalıcı `content_unavailable` ile FAILED yapar).
import type { NotifyKind } from "@remote/contracts/api/notify";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import type { Db } from "../lib/db.ts";
import type { MailContent } from "../mail/templates.ts";
import { contactsChangedMail, deviceRegisteredCustomerMail, startedMail, startedMessage, statusMail, statusMessage } from "./templates.ts";

/** Olay audit'i aranırken outbox `created_at`'ından geriye pay (uygulama/DB saat farkı). */
const EVENT_LOOKBACK_MS = 86_400_000;

export interface OutboxRowRef {
  tenantId: string;
  requestId: string | null;
  sessionId: string | null;
  eventId: string | null;
  kind: string;
  createdAt: Date;
  firm: string;
  requestCode: string | null;
}

export interface OutboxContent {
  /** SMS/WhatsApp metni (yalnız talep ve oturum satırları). */
  text: string | null;
  mail: MailContent;
  /** `mail.sent` / `request.customer_notify` audit çapası. */
  entity: string;
  entityId: string;
  mailKind: string;
  /** UNATTENDED_STARTED: rozet (`notify_failed_at`) için cihaz. */
  deviceId: string | null;
}

async function sessionContent(db: Db, r: OutboxRowRef, sessionId: string): Promise<OutboxContent | null> {
  const s = await db.supportSession.findFirst({
    where: { id: sessionId, tenantId: r.tenantId },
    select: {
      deviceId: true,
      consumedAt: true,
      createdAt: true,
      customerName: true,
      technician: { select: { fullName: true } },
    },
  });
  if (!s) return null;
  const dev = s.deviceId
    ? await db.unattendedDevice.findFirst({ where: { id: s.deviceId, tenantId: r.tenantId }, select: { name: true } })
    : null;
  const info = {
    firm: r.firm,
    device: dev?.name ?? s.customerName ?? "",
    technician: s.technician.fullName,
    at: s.consumedAt ?? s.createdAt,
  };
  return {
    text: startedMessage(info),
    mail: startedMail(info),
    entity: "support_sessions",
    entityId: sessionId,
    mailKind: "unattended_started",
    deviceId: s.deviceId,
  };
}

type Masked = { email?: unknown }[];
const emailsOf = (v: unknown): string[] => {
  const list = (v as { contacts?: Masked } | null)?.contacts;
  return Array.isArray(list) ? list.map((c) => String(c.email ?? "")).filter(Boolean) : [];
};

async function eventContent(db: Db, r: OutboxRowRef, eventId: string): Promise<OutboxContent | null> {
  const contacts = r.kind === "UN_CONTACTS_CHANGED";
  const a = await db.auditLog.findFirst({
    where: {
      tenantId: r.tenantId,
      action: contacts ? UNATTENDED_AUDIT.CONTACTS_CHANGED : UNATTENDED_AUDIT.DEVICE_REGISTERED,
      result: "success",
      createdAt: { gte: new Date(r.createdAt.getTime() - EVENT_LOOKBACK_MS) },
      newValue: { path: "$.eventId", equals: eventId },
    },
    select: { entity: true, entityId: true, userId: true, oldValue: true, newValue: true, createdAt: true },
  });
  if (!a?.entityId) return null;
  const base = { text: null, entity: a.entity, entityId: a.entityId, deviceId: null };
  if (contacts) {
    const user = a.userId ? await db.user.findUnique({ where: { id: a.userId }, select: { fullName: true } }) : null;
    const [oldE, newE] = [emailsOf(a.oldValue), emailsOf(a.newValue)];
    const added = newE.filter((e) => !oldE.includes(e));
    const removed = oldE.filter((e) => !newE.includes(e));
    const content = contactsChangedMail({ firm: r.firm, user: user?.fullName ?? "", added, removed, at: a.createdAt });
    return { ...base, mail: content, mailKind: "unattended_contacts_changed" };
  }
  const v = (a.newValue ?? {}) as { name?: unknown; ip?: unknown };
  const content = deviceRegisteredCustomerMail({ firm: r.firm, device: String(v.name ?? ""), ip: String(v.ip ?? ""), at: a.createdAt });
  return { ...base, mail: content, mailKind: "unattended_device_registered" };
}

export async function outboxContent(db: Db, r: OutboxRowRef): Promise<OutboxContent | null> {
  if (r.requestId && r.requestCode !== null) {
    const kind = r.kind as NotifyKind;
    return {
      text: statusMessage(kind, r.firm, r.requestCode),
      mail: statusMail(kind, r.firm, r.requestCode),
      entity: "support_requests",
      entityId: r.requestId,
      mailKind: "request_status",
      deviceId: null,
    };
  }
  if (r.sessionId) return sessionContent(db, r, r.sessionId);
  if (r.eventId) return eventContent(db, r, r.eventId);
  return null;
}
