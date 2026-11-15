// P27 müşteri bildirim adresleri (mimari-p27 §3.4, §4.2, §7.1 r2; AC-296, 337) ve müşteriye giden güvenlik olaylarının
// outbox satırları (`event_id` çapası, K-P27-14). PUT tam küme: müşteri satırı FOR UPDATE (sınır + eşzamanlı PUT sırası) →
// fark yoksa yazma/audit/outbox yok → DELETE + INSERT + audit (maskeli eski → yeni, stepUp) + eski ∪ yeni e-postalara
// `UN_CONTACTS_CHANGED`. Olay satırları tavanlara tabi değildir (K-P27-8); içerik işçide (K4) audit'teki `eventId` ile bulunur.
import type { NotifyContact, NotifyContactsResponse, PutNotifyContactsData } from "@remote/contracts/api/unattended";
import { notifyEmailKey } from "@remote/contracts/api/requests";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { maskEmail, maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { recipientHash } from "../notify/outbox.ts";

type Tx = Prisma.TransactionClient;
export type UnEventKind = "UN_CONTACTS_CHANGED" | "UN_DEVICE_REGISTERED";

/** Bir güvenlik olayının e-posta satırları (aynı `eventId`; alıcı normalize HMAC'le tekil — UQ'ya da güvenir). */
export async function enqueueEventMails(
  tx: Tx,
  secrets: SecretBox,
  o: { tenantId: string; eventId: string; kind: UnEventKind; emails: readonly string[]; now: Date },
): Promise<number> {
  const seen = new Set<string>();
  const data = [];
  for (const to of o.emails) {
    const hash = recipientHash(secrets, "EMAIL", to);
    if (seen.has(hash)) continue;
    seen.add(hash);
    const id = newId();
    data.push({
      id,
      tenantId: o.tenantId,
      eventId: o.eventId,
      kind: o.kind,
      channel: "EMAIL",
      recipientMask: maskEmail(to),
      recipientHash: hash,
      recipientEnc: Buffer.from(secrets.encrypt(to, aadFor.outboxRecipient(o.tenantId, id))),
      state: "PENDING",
      createdAt: o.now,
      nextAt: o.now,
    });
  }
  if (data.length === 0) return 0;
  return (await tx.notificationOutbox.createMany({ data, skipDuplicates: true })).count;
}

/** Müşteri bu firmada var mı (pasif dahil; anonimleşmiş → yok). TX'te satır kilidi alınır. */
async function lockCustomer(tx: Tx, tenantId: string, customerId: string): Promise<{ name: string } | null> {
  const rows = await tx.$queryRaw<{ name: string }[]>`SELECT name FROM customers
    WHERE id = ${customerId} AND tenant_id = ${tenantId} AND anonymized_at IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function customerExists(db: Db, tenantId: string, customerId: string): Promise<boolean> {
  return (await db.customer.count({ where: { id: customerId, tenantId, anonymizedAt: null } })) === 1;
}

const view = (rows: { email: string; phone: string | null }[]): NotifyContact[] => rows.map((r) => ({ email: r.email, phone: r.phone }));
const ORDER = [{ createdAt: "asc" as const }, { id: "asc" as const }];

export async function getContacts(db: Db, tenantId: string, customerId: string): Promise<NotifyContactsResponse> {
  if (!(await customerExists(db, tenantId, customerId))) throw new AppError("NOT_FOUND");
  const rows = await db.customerNotifyContact.findMany({ where: { tenantId, customerId }, orderBy: ORDER });
  return { items: view(rows) };
}

const sig = (c: NotifyContact): string => `${notifyEmailKey(c.email)}|${c.email}|${c.phone ?? ""}`;
const masked = (items: NotifyContact[]) => items.map((c) => ({ email: maskEmail(c.email), phone: c.phone ? maskPhone(c.phone) : null }));

export interface ContactsDeps {
  db: Db;
  secrets: SecretBox;
  now: () => number;
}

/** PUT contacts (step-up guard'ı routes'ta; tüketmez). */
export async function putContacts(
  d: ContactsDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  customerId: string,
  input: PutNotifyContactsData,
): Promise<NotifyContactsResponse> {
  const next: NotifyContact[] = input.items.map((c) => ({ email: c.email, phone: c.phone }));
  return d.db.$transaction(async (tx) => {
    if (!(await lockCustomer(tx, tenantId, customerId))) throw new AppError("NOT_FOUND");
    const old = view(await tx.customerNotifyContact.findMany({ where: { tenantId, customerId }, orderBy: ORDER }));
    if (old.map(sig).sort().join("\n") === next.map(sig).sort().join("\n")) return { items: old };
    const now = new Date(d.now());
    await tx.customerNotifyContact.deleteMany({ where: { tenantId, customerId } });
    if (next.length > 0)
      await tx.customerNotifyContact.createMany({
        data: next.map((c, i) => ({
          id: newId(),
          tenantId,
          customerId,
          email: c.email,
          phone: c.phone,
          createdAt: new Date(now.getTime() + i),
        })),
      });
    const eventId = newId();
    const emails = [...old, ...next].map((c) => c.email);
    await enqueueEventMails(tx, d.secrets, { tenantId, eventId, kind: "UN_CONTACTS_CHANGED", emails, now });
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: UNATTENDED_AUDIT.CONTACTS_CHANGED,
      entity: "customers",
      entityId: customerId,
      result: "success",
      oldValue: { contacts: masked(old) },
      newValue: { contacts: masked(next), stepUp: true, eventId },
    });
    return { items: next };
  });
}
