// P27 `UNATTENDED_STARTED` outbox satırları (mimari-p27 §7.1; AC-296, K-P27-8). admit-device TX'inde yazılır: müşterinin her
// bildirim adresine EMAIL; firmada SMS / WhatsApp açıksa telefonu olan adreslere SMS / WHATSAPP. P19 alıcı/firma tavanlarına
// TABİ DEĞİL (sınır bağlantı ucunun kullanıcı başına 20/sa kovası). Teslim K4 işçisinde; alıcı şifreli + maske + HMAC.
import type { NotifyChannel } from "@remote/contracts/api/notify";
import { maskEmail, maskPhone } from "../audit/mask.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import { newId } from "../lib/ids.ts";
import { recipientHash } from "../notify/outbox.ts";

interface Target {
  channel: NotifyChannel;
  to: string;
}

async function targetsOf(tx: Prisma.TransactionClient, tenantId: string, customerId: string): Promise<Target[]> {
  const [contacts, s] = await Promise.all([
    tx.customerNotifyContact.findMany({ where: { tenantId, customerId }, select: { email: true, phone: true }, orderBy: { email: "asc" } }),
    tx.tenantRequestSettings.findUnique({ where: { tenantId }, select: { notifySmsEnabled: true, notifyWhatsappEnabled: true } }),
  ]);
  const out: Target[] = contacts.map((c) => ({ channel: "EMAIL", to: c.email }));
  for (const c of contacts) {
    if (!c.phone) continue;
    if (s?.notifySmsEnabled) out.push({ channel: "SMS", to: c.phone });
    if (s?.notifyWhatsappEnabled) out.push({ channel: "WHATSAPP", to: c.phone });
  }
  return out;
}

/** Oturum başlangıcı bildirimi (aynı TX); yazılan satır sayısı (UQ tekrarları atlanır). */
export async function enqueueStarted(
  tx: Prisma.TransactionClient,
  secrets: SecretBox,
  o: { tenantId: string; sessionId: string; customerId: string; now: Date },
): Promise<number> {
  const seen = new Set<string>();
  const data = [];
  for (const t of await targetsOf(tx, o.tenantId, o.customerId)) {
    const hash = recipientHash(secrets, t.channel, t.to);
    if (seen.has(`${t.channel}:${hash}`)) continue;
    seen.add(`${t.channel}:${hash}`);
    const id = newId();
    data.push({
      id,
      tenantId: o.tenantId,
      sessionId: o.sessionId,
      kind: "UNATTENDED_STARTED",
      channel: t.channel,
      recipientMask: t.channel === "EMAIL" ? maskEmail(t.to) : maskPhone(t.to),
      recipientHash: hash,
      recipientEnc: Buffer.from(secrets.encrypt(t.to, aadFor.outboxRecipient(o.tenantId, id))),
      state: "PENDING",
      createdAt: o.now,
      nextAt: o.now,
    });
  }
  if (data.length === 0) return 0;
  return (await tx.notificationOutbox.createMany({ data, skipDuplicates: true })).count;
}
