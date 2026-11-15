// Müşteri durum bildirimi kuyruğu (P19 J3, mimari-e11 §8c.3; AC-261; S-P19-10, S-P19-12, S-P19-T12/T13).
//  - Kuyruğa alma: talebin durum değiştiren AYNI TX'inde (kabul/ret/süre dolumu; `lockSettings` o TX'in ilk ifadesi —
//    T12), seçilmiş VE firmanın açtığı kanal başına bir satır (UQ → INSERT IGNORE). Alıcı şifreli (AAD satıra bağlı).
//    Tavanlar (`NOTIFY_LIMITS`) DB sayımıyla aynı TX'te; aşımda satır `FAILED rate_limited` (gönderilmez) + audit + metrik.
//  - İşçi: 2 sn'de bir PENDING ∧ next_at ≤ now → SENDING (commit) → gönder → SENT / yeniden deneme (0, 10, 30 sn; 3 deneme)
//    / FAILED. Kalıcı nedenler yeniden denenmez. Son durumda `recipient_enc = NULL` (aynı UPDATE). Çökme kurtarma: SENDING
//    ∧ updated_at < now − 60 sn → PENDING (en az bir kez teslim, K-P19-4).
//  - Temizlik: SENT/FAILED ∧ updated_at < now − 7 g, ≤ 1000/parti. Hacim göstergesi 5 dk'da bir (tenant etiketi yok).
//  - Metrik sözleşmesi (J6 remote-watch): `rs_notify_outbox_total{channel,result=sent|failed}` yalnız son durumlar ve
//    `rate_limited` HARİÇ; `rs_notify_rate_limited_total{scope,channel}`; göstergeler boş kuyrukta da 0.
import {
  NOTIFY_LIMITS,
  type NotifyChannel,
  type NotifyKind,
  type NotifyRateScope,
  type PublicSendReason,
} from "@remote/contracts/api/notify";
import { notifyEmailKey } from "@remote/contracts/api/requests";
import { NOTIFY_AUDIT } from "@remote/contracts/audit";
import { maskEmail, maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { aadFor, NOTIFY_RECIPIENT_KEY_VERSION, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import { publicReason } from "../lib/outbound.ts";
import type { MailService } from "../mail/service.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { SmsClient } from "./sms.ts";
import { statusMail, statusMessage } from "./templates.ts";
import type { WhatsappNotifier } from "./whatsapp.ts";

export const OUTBOX_RETRY_DELAYS_MS = [0, 10_000, 30_000] as const;
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_RETRY_DELAYS_MS.length;
export const OUTBOX_POLL_MS = 2_000;
export const OUTBOX_BATCH = 20;
export const OUTBOX_STALE_SENDING_MS = 60_000;
export const OUTBOX_RETENTION_MS = 7 * 86_400_000;
export const OUTBOX_CLEANUP_BATCH = 1000;
const CLEANUP_EVERY_MS = 3_600_000;
const VOLUME_EVERY_MS = 300_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const CTX: AuditContext = { ip: "", userAgent: "notify-outbox", requestId: "" };

/** Kalıcı nedenler: yeniden deneme yok. */
const PERMANENT = new Set(["unconfigured", "unauthorized", "host_not_allowed", "invalid_phone", "rate_limited", "recipient_unreadable"]);

type Reason = PublicSendReason | "unconfigured" | "invalid_phone" | "rate_limited" | "recipient_unreadable";

interface Log {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface OutboxDeps {
  db: Db;
  secrets: SecretBox;
  sms: SmsClient;
  whatsapp: WhatsappNotifier;
  mail: MailService;
  metrics: Metrics;
  log: Log;
  now: () => number;
}

const CHANNEL_FLAGS = [
  ["SMS", "notifySms", "notifySmsEnabled"],
  ["WHATSAPP", "notifyWhatsapp", "notifyWhatsappEnabled"],
  ["EMAIL", "notifyEmail", "notifyEmailEnabled"],
] as const;

/** S-P19-T11/T13: normalize alıcı (telefon E.164, e-posta `notifyEmailKey`) → sabit anahtar sürümüyle HMAC. */
export function recipientHash(secrets: SecretBox, channel: NotifyChannel, recipient: string): string {
  const norm = channel === "EMAIL" ? notifyEmailKey(recipient) : recipient;
  return secrets.macAt(NOTIFY_RECIPIENT_KEY_VERSION, "notify-recipient", norm);
}

const notRateLimited = { OR: [{ lastReason: null }, { lastReason: { not: "rate_limited" } }] };

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

  /**
   * Durum geçişinin TX'inde çağrılır (çağıran `lockSettings`'i ilk ifade olarak almıştır — T12). Talebin seçtiği
   * (bastırma sonrası) VE firmanın açtığı kanallara satır yazar. Kanal yapılandırılmamış olsa da yazılır (işçi FAILED yapar).
   */
  async enqueue(tx: Prisma.TransactionClient, tenantId: string, requestId: string, kind: NotifyKind): Promise<void> {
    const [r, s] = await Promise.all([
      tx.supportRequest.findFirst({
        where: { id: requestId, tenantId },
        select: { notifySms: true, notifyWhatsapp: true, notifyEmail: true, customerPhone: true, customerEmail: true },
      }),
      tx.tenantRequestSettings.findUnique({
        where: { tenantId },
        select: { notifySmsEnabled: true, notifyWhatsappEnabled: true, notifyEmailEnabled: true },
      }),
    ]);
    if (!r || !s) return;
    const now = new Date(this.d.now());
    for (const [channel, pick, enabled] of CHANNEL_FLAGS) {
      if (!r[pick] || !s[enabled]) continue;
      const to = channel === "EMAIL" ? r.customerEmail : r.customerPhone;
      if (!to) continue;
      const hash = recipientHash(this.d.secrets, channel, to);
      const mask = channel === "EMAIL" ? maskEmail(to) : maskPhone(to);
      const scope = await this.overLimit(tx, tenantId, channel, hash, now);
      const id = newId();
      const base = { id, tenantId, requestId, kind, channel, recipientMask: mask, recipientHash: hash, createdAt: now, nextAt: now };
      const data = scope
        ? { ...base, state: "FAILED", recipientEnc: null, attempts: 0, lastReason: "rate_limited" }
        : { ...base, state: "PENDING", recipientEnc: Buffer.from(this.d.secrets.encrypt(to, aadFor.outboxRecipient(tenantId, id))) };
      const { count } = await tx.notificationOutbox.createMany({ data: [data], skipDuplicates: true });
      if (count === 0 || !scope) continue;
      this.d.metrics.inc("rs_notify_rate_limited_total", { scope, channel });
      await writeAudit(tx, CTX, {
        tenantId,
        username: "system",
        action: NOTIFY_AUDIT.CUSTOMER_NOTIFY,
        entity: "support_requests",
        entityId: requestId,
        result: "fail",
        newValue: { kind, channel, recipient: mask, result: "fail", attempts: 0, reason: "rate_limited", scope },
      });
    }
  }

  /**
   * S-P19-12: firma içi alıcı 3/24 sa, sistem geneli alıcı 5/24 sa, firma × kanal saatlik tavan. Firma içi sayımlar
   * `lockSettings` ile kesin; sistem geneli sayım firmalar arası kilitsiz anlık görüntü → YAKLAŞIK tavan (S-P19-K2; N firmada
   * eşzamanlı geçişte en çok 4 + N). Alıcı kilidi bilinçli eklenmedi: RR anlık görüntüsü kilitten önce kurulduğu için kesinlik
   * kilitleyici okuma (gap kilidi → firmalar arası 1213) ya da TX içinde ikinci havuz bağlantısı gerektirir (runbook §26.5 m.6).
   */
  private async overLimit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    channel: NotifyChannel,
    hash: string,
    now: Date,
  ): Promise<NotifyRateScope | null> {
    const day = new Date(now.getTime() - DAY_MS);
    const hour = new Date(now.getTime() - HOUR_MS);
    const [recTenant, recGlobal, perTenant] = await Promise.all([
      tx.notificationOutbox.count({ where: { tenantId, recipientHash: hash, channel, createdAt: { gt: day }, ...notRateLimited } }),
      tx.notificationOutbox.count({ where: { recipientHash: hash, channel, createdAt: { gt: day }, ...notRateLimited } }),
      tx.notificationOutbox.count({ where: { tenantId, channel, createdAt: { gt: hour }, ...notRateLimited } }),
    ]);
    if (recTenant >= NOTIFY_LIMITS.recipientTenantPerDay) return "recipient_tenant";
    if (recGlobal >= NOTIFY_LIMITS.recipientGlobalPerDay) return "recipient_global";
    if (perTenant >= NOTIFY_LIMITS.tenantPerHour[channel]) return "tenant_channel";
    return null;
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
      const kind = row.kind as NotifyKind;
      const channel = row.channel as NotifyChannel;
      let to: string | null = null;
      try {
        to = row.recipientEnc ? this.d.secrets.decrypt(row.recipientEnc, aadFor.outboxRecipient(row.tenantId, id)) : null;
      } catch {
        to = null;
      }
      const reason: Reason | "ok" = to
        ? await this.send(row.tenantId, channel, row.recipientHash, to, kind, row.tenant.name, row.request.requestCode, row.requestId)
        : "recipient_unreadable";
      await this.settle(id, row, reason);
    } catch (err) {
      // Satır SENDING kalır → 60 sn sonra kurtarma ile yeniden denenir.
      this.d.log.error({ err, job: "notify-outbox" }, "bildirim teslimi hatası");
    }
  }

  private async send(
    tenantId: string,
    channel: NotifyChannel,
    hash: string,
    to: string,
    kind: NotifyKind,
    firm: string,
    code: string,
    requestId: string,
  ): Promise<Reason | "ok"> {
    if (channel === "SMS") {
      const o = await this.d.sms.send(tenantId, to, statusMessage(kind, firm, code));
      return o === "ok" || o === "unconfigured" || o === "invalid_phone" ? o : publicReason(o);
    }
    if (channel === "WHATSAPP") {
      const o = await this.d.whatsapp.sendCustomer(tenantId, hash, to, statusMessage(kind, firm, code));
      return o === "ok" || o === "rate_limited" || o === "unconfigured" ? o : publicReason(o);
    }
    const out = await this.d.mail.sendForTenant(
      CTX,
      { tenantId, kind: "request_status", entity: "support_requests", entityId: requestId },
      to,
      statusMail(kind, firm, code),
    );
    if (out.ok) return "ok";
    switch (out.reason) {
      case "not_configured":
        return "unconfigured";
      case "auth":
        return "unauthorized";
      case "port_not_allowed":
      case "insecure_auth":
        return "host_not_allowed";
      case "connect":
        return "unreachable";
      default:
        return "http_error";
    }
  }

  private async settle(
    id: string,
    row: { tenantId: string; requestId: string; kind: string; channel: string; recipientMask: string; attempts: number; createdAt: Date },
    reason: Reason | "ok",
  ): Promise<void> {
    const now = this.d.now();
    const attempts = row.attempts + 1;
    const final = reason === "ok" || PERMANENT.has(reason) || attempts >= OUTBOX_MAX_ATTEMPTS;
    if (!final) {
      await this.d.db.notificationOutbox.updateMany({
        where: { id, state: "SENDING" },
        data: { state: "PENDING", attempts, lastReason: reason, nextAt: new Date(now + (OUTBOX_RETRY_DELAYS_MS[attempts] ?? 0)) },
      });
      return;
    }
    const ok = reason === "ok";
    await this.d.db.$transaction(async (tx) => {
      const r = await tx.notificationOutbox.updateMany({
        where: { id, state: "SENDING" },
        data: ok
          ? { state: "SENT", attempts, recipientEnc: null, sentAt: new Date(now), lastReason: null }
          : { state: "FAILED", attempts, recipientEnc: null, lastReason: reason },
      });
      if (r.count === 0) return;
      const rateLimited = reason === "rate_limited";
      await writeAudit(tx, CTX, {
        tenantId: row.tenantId,
        username: "system",
        action: NOTIFY_AUDIT.CUSTOMER_NOTIFY,
        entity: "support_requests",
        entityId: row.requestId,
        result: ok ? "success" : "fail",
        newValue: {
          kind: row.kind,
          channel: row.channel,
          recipient: row.recipientMask,
          result: ok ? "success" : "fail",
          attempts,
          ...(ok ? {} : { reason }),
          ...(rateLimited ? { scope: "wa_bucket" } : {}),
        },
      });
    });
    if (reason === "rate_limited") this.d.metrics.inc("rs_notify_rate_limited_total", { scope: "wa_bucket", channel: row.channel });
    else this.d.metrics.inc("rs_notify_outbox_total", { channel: row.channel, result: ok ? "sent" : "failed" });
    this.d.metrics.inc("rs_notify_outbox_latency_seconds_sum", { channel: row.channel }, (now - row.createdAt.getTime()) / 1000);
    this.d.metrics.inc("rs_notify_outbox_latency_seconds_count", { channel: row.channel });
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
