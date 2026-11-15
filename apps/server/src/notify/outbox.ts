// Müşteri bildirimi kuyruğu (P19 J3, mimari-e11 §8c.3; AC-261; S-P19-10, S-P19-12, S-P19-T12/T13; P27-K4 mimari-p27 §7.1).
//  - Kuyruğa alma: talep türleri `outbox-enqueue.ts` (tavanlı); P27 türleri `unattended/notify.ts`, `unattended/contacts.ts`
//    (tavansız, K-P27-8). Satır tam olarak bir çapa taşır: request_id | session_id | event_id (CHECK).
//  - İşçi: 2 sn'de bir PENDING ∧ next_at ≤ now → SENDING (commit) → içerik (`outbox-content.ts`) → gönder → SENT / yeniden
//    deneme (0, 10, 30 sn; 3 deneme) / FAILED. Kalıcı nedenler yeniden denenmez. Son durumda `recipient_enc = NULL` (aynı
//    UPDATE). Çökme kurtarma: SENDING ∧ updated_at < now − 60 sn → PENDING (en az bir kez teslim, K-P19-4).
//  - P27 (Y-P27-1, AC-336): `UNATTENDED_STARTED` FAILED → aynı TX'te cihazın `notify_failed_at = now` + audit
//    `unattended.notify.failed`; SENT → bu satırdan ÖNCEKİ başarısızlığın rozeti kalkar (`notify_failed_at < created_at`).
//  - Temizlik: SENT/FAILED ∧ updated_at < now − 7 g, ≤ 1000/parti. Hacim göstergesi 5 dk'da bir (tenant etiketi yok).
//  - Metrik sözleşmesi (J6 remote-watch): `rs_notify_outbox_total{channel,result=sent|failed}` yalnız son durumlar ve
//    `rate_limited` HARİÇ; `rs_notify_rate_limited_total{scope,channel}`; göstergeler boş kuyrukta da 0.
import { NOTIFY_LIMITS, type NotifyChannel, type NotifyKind, type PublicSendReason } from "@remote/contracts/api/notify";
import { NOTIFY_AUDIT } from "@remote/contracts/audit";
import { writeAudit } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { publicReason } from "../lib/outbound.ts";
import type { MailService } from "../mail/service.ts";
import type { Metrics } from "../ops/metrics.ts";
import { enqueueRequest, OUTBOX_CTX as CTX } from "./outbox-enqueue.ts";
import { outboxContent, type OutboxContent } from "./outbox-content.ts";
import { deviceBadge, finalMetrics, type SettleRow } from "./outbox-settle.ts";
import type { SmsClient } from "./sms.ts";
import type { WhatsappNotifier } from "./whatsapp.ts";

export { recipientHash } from "./outbox-enqueue.ts";

const OUTBOX_RETRY_DELAYS_MS = [0, 10_000, 30_000] as const;
const OUTBOX_MAX_ATTEMPTS = OUTBOX_RETRY_DELAYS_MS.length;
export const OUTBOX_POLL_MS = 2_000;
const OUTBOX_BATCH = 20;
const OUTBOX_STALE_SENDING_MS = 60_000;
const OUTBOX_RETENTION_MS = 7 * 86_400_000;
const OUTBOX_CLEANUP_BATCH = 1000;
const CLEANUP_EVERY_MS = 3_600_000;
const VOLUME_EVERY_MS = 300_000;
const HOUR_MS = 3_600_000;

/** Kalıcı nedenler: yeniden deneme yok. */
const PERMANENT = new Set([
  "unconfigured",
  "unauthorized",
  "host_not_allowed",
  "invalid_phone",
  "rate_limited",
  "recipient_unreadable",
  "content_unavailable",
]);

type Reason = PublicSendReason | "unconfigured" | "invalid_phone" | "rate_limited" | "recipient_unreadable" | "content_unavailable";

interface Log {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

interface OutboxDeps {
  db: Db;
  secrets: SecretBox;
  sms: SmsClient;
  whatsapp: WhatsappNotifier;
  mail: MailService;
  metrics: Metrics;
  log: Log;
  now: () => number;
}

/** Audit çapası: içerik bulunamadıysa satırın kendisi. */
type Anchor = Pick<OutboxContent, "entity" | "entityId" | "deviceId">;

const MAIL_REASON: Record<string, Reason> = {
  not_configured: "unconfigured",
  auth: "unauthorized",
  port_not_allowed: "host_not_allowed",
  connect: "unreachable",
};

export class NotifyOutbox {
  readonly d: OutboxDeps;
  private oldestPendingSec = 0;
  private volume: Record<NotifyChannel, number> = { SMS: 0, WHATSAPP: 0, EMAIL: 0 };
  private lastCleanup = 0;
  private lastVolume = 0;
  private running = false;

  constructor(d: OutboxDeps) {
    this.d = d;
    d.metrics.gauge(
      "rs_notify_outbox_oldest_pending_seconds",
      "En eski bekleyen müşteri bildirimi yaşı (sn; boş kuyrukta 0)",
      () => this.oldestPendingSec,
    );
    d.metrics.gauge(
      "rs_notify_tenant_max_hourly",
      "Son 1 saatte en yüksek firma × kanal bildirim sayısı (kanal; tenant etiketi yok)",
      () => ({
        ...this.volume,
      }),
    );
  }

  /** Talep durum geçişinin TX'inde (çağıran `lockSettings`'i ilk ifade olarak almıştır — T12); `outbox-enqueue.ts`. */
  async enqueue(tx: Prisma.TransactionClient, tenantId: string, requestId: string, kind: NotifyKind): Promise<void> {
    await enqueueRequest(this.d, tx, { tenantId, requestId, kind });
  }

  /** Tek işçi turu (zamanlayıcı 2 sn; testler doğrudan çağırır). Turlar üst üste binmez. Dönen: işlenen satır. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = this.d.now();
      await this.recover(now);
      const claimed = await this.claim(now);
      await Promise.all(claimed.map((id) => this.deliver(id)));
      if (now - this.lastCleanup >= CLEANUP_EVERY_MS) {
        this.lastCleanup = now;
        await this.cleanup(now);
      }
      if (now - this.lastVolume >= VOLUME_EVERY_MS) {
        this.lastVolume = now;
        await this.refreshVolume(now);
      }
      await this.refreshOldest(this.d.now());
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  /** Çökme kurtarma (açılışta ve her turda). */
  async recover(now: number): Promise<number> {
    const r = await this.d.db.notificationOutbox.updateMany({
      where: { state: "SENDING", updatedAt: { lt: new Date(now - OUTBOX_STALE_SENDING_MS) } },
      data: { state: "PENDING", nextAt: new Date(now) },
    });
    return r.count;
  }

  private async claim(now: number): Promise<string[]> {
    return this.d.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM notification_outbox
        WHERE state = 'PENDING' AND next_at <= ${new Date(now)} ORDER BY next_at LIMIT ${OUTBOX_BATCH} FOR UPDATE SKIP LOCKED`;
      const ids = rows.map((x) => x.id);
      if (ids.length > 0)
        await tx.notificationOutbox.updateMany({ where: { id: { in: ids }, state: "PENDING" }, data: { state: "SENDING" } });
      return ids;
    });
  }

  private async deliver(id: string): Promise<void> {
    try {
      const row = await this.d.db.notificationOutbox.findUnique({
        where: { id },
        select: {
          tenantId: true,
          requestId: true,
          sessionId: true,
          eventId: true,
          kind: true,
          channel: true,
          recipientEnc: true,
          recipientMask: true,
          recipientHash: true,
          attempts: true,
          createdAt: true,
          state: true,
          request: { select: { requestCode: true } },
          tenant: { select: { name: true } },
        },
      });
      if (!row || row.state !== "SENDING") return;
      const ref = { ...row, firm: row.tenant.name, requestCode: row.request?.requestCode ?? null };
      const content = await outboxContent(this.d.db, ref);
      const to = this.recipient(id, row.tenantId, row.recipientEnc);
      const channel = row.channel as NotifyChannel;
      const reason: Reason | "ok" = !content
        ? "content_unavailable"
        : to
          ? await this.send(row.tenantId, channel, row.recipientHash, to, content)
          : "recipient_unreadable";
      const anchor: Anchor = content ?? { entity: "notification_outbox", entityId: id, deviceId: null };
      await this.settle({ id, ...row }, anchor, reason);
    } catch (err) {
      // Satır SENDING kalır → 60 sn sonra kurtarma ile yeniden denenir.
      this.d.log.error({ err, job: "notify-outbox" }, "bildirim teslimi hatası");
    }
  }

  private recipient(id: string, tenantId: string, enc: Uint8Array | null): string | null {
    try {
      return enc ? this.d.secrets.decrypt(enc, aadFor.outboxRecipient(tenantId, id)) : null;
    } catch {
      return null;
    }
  }

  private async send(tenantId: string, channel: NotifyChannel, hash: string, to: string, c: OutboxContent): Promise<Reason | "ok"> {
    if (channel !== "EMAIL" && c.text === null) return "content_unavailable";
    if (channel === "SMS") {
      const o = await this.d.sms.send(tenantId, to, c.text ?? "");
      return o === "ok" || o === "unconfigured" || o === "invalid_phone" ? o : publicReason(o);
    }
    if (channel === "WHATSAPP") {
      const o = await this.d.whatsapp.sendCustomer(tenantId, hash, to, c.text ?? "");
      return o === "ok" || o === "rate_limited" || o === "unconfigured" ? o : publicReason(o);
    }
    const out = await this.d.mail.sendForTenant(CTX, { tenantId, kind: c.mailKind, entity: c.entity, entityId: c.entityId }, to, c.mail);
    return out.ok ? "ok" : (MAIL_REASON[out.reason] ?? "http_error");
  }

  private async settle(row: SettleRow, anchor: Anchor, reason: Reason | "ok"): Promise<void> {
    const now = this.d.now();
    const attempts = row.attempts + 1;
    const final = reason === "ok" || PERMANENT.has(reason) || attempts >= OUTBOX_MAX_ATTEMPTS;
    if (!final) {
      await this.d.db.notificationOutbox.updateMany({
        where: { id: row.id, state: "SENDING" },
        data: { state: "PENDING", attempts, lastReason: reason, nextAt: new Date(now + (OUTBOX_RETRY_DELAYS_MS[attempts] ?? 0)) },
      });
      return;
    }
    const ok = reason === "ok";
    await this.d.db.$transaction(async (tx) => {
      const r = await tx.notificationOutbox.updateMany({
        where: { id: row.id, state: "SENDING" },
        data: ok
          ? { state: "SENT", attempts, recipientEnc: null, sentAt: new Date(now), lastReason: null }
          : { state: "FAILED", attempts, recipientEnc: null, lastReason: reason },
      });
      if (r.count === 0) return;
      await writeAudit(tx, CTX, {
        tenantId: row.tenantId,
        username: "system",
        action: NOTIFY_AUDIT.CUSTOMER_NOTIFY,
        entity: anchor.entity,
        entityId: anchor.entityId,
        result: ok ? "success" : "fail",
        newValue: {
          kind: row.kind,
          channel: row.channel,
          recipient: row.recipientMask,
          result: ok ? "success" : "fail",
          attempts,
          ...(ok ? {} : { reason }),
          ...(reason === "rate_limited" ? { scope: "wa_bucket" } : {}),
        },
      });
      if (row.kind === "UNATTENDED_STARTED" && anchor.deviceId) await deviceBadge(tx, row, anchor.deviceId, ok ? null : reason, now);
    });
    finalMetrics(this.d.metrics, row, reason, now);
  }

  /** 7 gün temizlik (SENT/FAILED). Dönen: silinen satır. */
  async cleanup(now: number): Promise<number> {
    const before = new Date(now - OUTBOX_RETENTION_MS);
    let total = 0;
    for (;;) {
      const n = await this.d.db.$executeRaw`DELETE FROM notification_outbox
        WHERE state IN ('SENT', 'FAILED') AND updated_at < ${before} ORDER BY updated_at LIMIT ${OUTBOX_CLEANUP_BATCH}`;
      total += n;
      if (n < OUTBOX_CLEANUP_BATCH) break;
    }
    if (total > 0) this.d.metrics.inc("rs_notify_outbox_cleaned_total", {}, total);
    return total;
  }

  /** S-P19-T1 m.5: kanal başına en yüksek firma saatlik sayısı; tavanın %80'i aşılınca warn (alıcı yok). */
  async refreshVolume(now: number): Promise<void> {
    const rows = await this.d.db.$queryRaw<{ tenant_id: string; channel: string; n: bigint | number }[]>`SELECT tenant_id, channel,
      COUNT(*) AS n FROM notification_outbox WHERE created_at > ${new Date(now - HOUR_MS)} GROUP BY tenant_id, channel`;
    const next: Record<NotifyChannel, number> = { SMS: 0, WHATSAPP: 0, EMAIL: 0 };
    for (const r of rows) {
      const ch = r.channel as NotifyChannel;
      if (!(ch in next)) continue;
      const n = Number(r.n);
      next[ch] = Math.max(next[ch], n);
      if (n >= NOTIFY_LIMITS.tenantPerHour[ch] * 0.8)
        this.d.log.warn(
          { event: "notify.tenant_volume", tenantId: r.tenant_id, channel: ch, count: n },
          "firma bildirim hacmi tavana yakın",
        );
    }
    this.volume = next;
  }

  async refreshOldest(now: number): Promise<void> {
    const r = await this.d.db.notificationOutbox.aggregate({
      where: { state: { in: ["PENDING", "SENDING"] } },
      _min: { createdAt: true },
    });
    const oldest = r._min.createdAt;
    this.oldestPendingSec = oldest ? Math.max(0, Math.floor((now - oldest.getTime()) / 1000)) : 0;
  }
}
