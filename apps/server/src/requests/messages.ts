// P18 H3 — kabul öncesi talep mesajları (mimari-e11 §8b.4–8b.7, §8b.13 S-P18-T1..T4/T8/T9/T10; AC-255; ADR-0025 m.1–m.3).
// Kurallar:
//  - Saklama önce, iletim sonra (ADR-0025 m.1): kova → (yinelenen clientMsgId → aynı kayıt) → tavan → şifrele → koşullu
//    INSERT … SELECT `status = 'PENDING'` + audit (tek TX) → commit → yankı/iletim. INSERT başarısızsa iletim yok.
//  - Gövde alan şifreli (`aadFor.sessionMessage`, satıra bağlı); audit'e/loga gövde ASLA yazılmaz (yalnız `chars`).
//  - Müşteri tarafı yalnız `rs.cap.chat1` soketine (`hub.sendChat`); panele gövdesiz `request.activity` (≤ 1/sn/talep).
//  - Hız: talep+gönderici başına 1/sn; müşteri mesajı firma kovası 300/dk (+ `queue.alert`); gönderici başına 200 tavanı.
// Tek instance (ADR-0005): kovalar bellek içi.
import {
  CUSTOMER_MESSAGES_PER_TENANT_MIN,
  MESSAGE_HISTORY_WS,
  MESSAGE_PAGE_MAX,
  MESSAGE_RATE_PER_REQUEST_MS,
  MESSAGE_UNREADABLE_LABEL,
  MESSAGES_PER_SENDER_MAX,
  type MessageSender,
  type RequestMessageItem,
  type RequestMessageListResponse,
  type SendRequestMessageResponse,
} from "@remote/contracts/api/requests";
import { UNSAFE_NAME_CHARS } from "@remote/contracts/api/sessions";
import { REQUEST_COMMS_AUDIT } from "@remote/contracts/audit";
import type { RequestChatMessage } from "@remote/contracts/ws-request";
import { CUSTOMER_USERNAME, writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import type { RequestConn } from "./hub.ts";
import type { RequestService } from "./service.ts";

type DbOrTx = Db | Prisma.TransactionClient;
const MIN = 60_000;
const TABLE = "session_messages";
export const RATE_MESSAGE = "Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyin.";
export const CAP_MESSAGE = `Bu talepte en çok ${MESSAGES_PER_SENDER_MAX} mesaj gönderilebilir.`;

type RejectReason = "rate" | "cap" | "closed" | "unsupported" | "tenant_rate";

// ------------------------------------------------------------------ repo

interface MessageInsert {
  id: string;
  tenantId: string;
  requestId: string;
  sender: MessageSender;
  senderUserId: string | null;
  clientMsgId: string;
  bodyEnc: Uint8Array;
  bodyChars: number;
  createdAt: Date;
}

/** Koşullu INSERT (talep PENDING ise 1, değilse 0) — `SELECT … FOR UPDATE` yok (§8b.4). */
async function insertIfPending(tx: DbOrTx, m: MessageInsert): Promise<number> {
  return tx.$executeRaw`INSERT INTO session_messages
      (id, tenant_id, request_id, session_id, sender, sender_user_id, client_msg_id, body_enc, body_chars, created_at)
    SELECT ${m.id}, ${m.tenantId}, ${m.requestId}, NULL, ${m.sender}, ${m.senderUserId}, ${m.clientMsgId}, ${Buffer.from(m.bodyEnc)},
      ${m.bodyChars}, ${m.createdAt}
    FROM support_requests WHERE id = ${m.requestId} AND tenant_id = ${m.tenantId} AND status = 'PENDING'`;
}

/** Gönderici tavanı sayımı (UQ(request_id, sender, client_msg_id) öneki — S-P18-T4). */
async function countBySender(db: DbOrTx, tenantId: string, requestId: string, sender: MessageSender): Promise<number> {
  return db.sessionMessage.count({ where: { requestId, tenantId, sender } });
}

/** Yeniden gönderim: aynı (talep, gönderici, clientMsgId) varsa aynı kayıt döner (çift kayıt yok). */
function findByClientMsgId(db: DbOrTx, tenantId: string, requestId: string, sender: MessageSender, clientMsgId: string) {
  return db.sessionMessage.findFirst({ where: { requestId, tenantId, sender, clientMsgId }, select: rowSelect });
}

const rowSelect = {
  id: true,
  tenantId: true,
  requestId: true,
  sender: true,
  clientMsgId: true,
  bodyEnc: true,
  createdAt: true,
  senderUser: { select: { fullName: true } },
} as const;
type Row = Prisma.SessionMessageGetPayload<{ select: typeof rowSelect }>;

/** Artan sıra (created_at, id); `after` verilirse o mesajdan sonrakiler. */
async function listRows(db: DbOrTx, tenantId: string, requestId: string, take: number, after?: string): Promise<Row[]> {
  let where: Prisma.SessionMessageWhereInput = { requestId, tenantId };
  if (after) {
    const a = await db.sessionMessage.findFirst({ where: { id: after, requestId, tenantId }, select: { createdAt: true } });
    if (a) where = { ...where, OR: [{ createdAt: { gt: a.createdAt } }, { createdAt: a.createdAt, id: { gt: after } }] };
  }
  return db.sessionMessage.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take, select: rowSelect });
}

/** Son `take` mesaj, artan sıra (WS bağlantı sonrası geçmiş). */
async function lastRows(db: DbOrTx, tenantId: string, requestId: string, take: number): Promise<Row[]> {
  const rows = await db.sessionMessage.findMany({
    where: { requestId, tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: rowSelect,
  });
  return rows.reverse();
}

// ------------------------------------------------------------------ yardımcılar

/** Müşteriye giden teknisyen adı: görünmez/kontrol karakteri ayıklanır, ≤ 100 kod noktası. */
export function displayName(fullName: string | null | undefined): string {
  const clean = [...(fullName ?? "")]
    .filter((ch) => !UNSAFE_NAME_CHARS.test(ch))
    .join("")
    .trim();
  return [...clean].slice(0, 100).join("") || "Teknisyen";
}

const chars = (v: string): number => [...v].length;

// ------------------------------------------------------------------ servis

export class RequestMessages {
  private readonly svc: RequestService;
  private readonly secrets: SecretBox;
  /** `${requestId}|${sender}` → son kabul edilen gönderim anı (AC-255: 1/sn). */
  private readonly lastSent = new Map<string, number>();
  /** K-P18-12: firma başına müşteri mesajı 300/dk (aşımda 1 dk kilit). */
  readonly tenantCustomer: FixedWindowCounter;
  /** `request.message_rejected` audit'i (talep, neden) başına dakikada 1. */
  private readonly rejectAudit: FixedWindowCounter;
  /** Firma kovası `queue.alert` pencere başına bir kez. */
  private readonly alertedUntil = new Map<string, number>();
  /** Test enjeksiyon noktası (saklama-önce testi): koşullu INSERT. */
  insertRow: (tx: DbOrTx, m: MessageInsert) => Promise<number> = insertIfPending;

  constructor(svc: RequestService, secrets: SecretBox) {
    this.svc = svc;
    this.secrets = secrets;
    const now = () => svc.d.clock.now();
    this.tenantCustomer = new FixedWindowCounter(CUSTOMER_MESSAGES_PER_TENANT_MIN + 1, MIN, MIN, { now });
    this.rejectAudit = new FixedWindowCounter(2, MIN, MIN, { now });
  }

  close(): void {
    this.tenantCustomer.close();
    this.rejectAudit.close();
  }

  private get now(): number {
    return this.svc.d.clock.now();
  }

  /** Talep+gönderici 1/sn; geçerse anı kaydeder. */
  private takeRequestSlot(requestId: string, sender: MessageSender): boolean {
    const key = `${requestId}|${sender}`;
    const t = this.now;
    const last = this.lastSent.get(key);
    if (last !== undefined && t - last < MESSAGE_RATE_PER_REQUEST_MS) return false;
    if (this.lastSent.size > 50_000) this.lastSent.clear();
    this.lastSent.set(key, t);
    return true;
  }

  /** Ret: metrik her seferinde; audit (talep, neden) başına dakikada 1. Gövde yazılmaz. */
  private async rejected(ctx: AuditContext, who: Who, requestId: string, reason: RejectReason): Promise<void> {
    this.svc.d.metrics.inc("rs_request_messages_rejected_total", { reason });
    const k = `${requestId}|${reason}|${who.sender}`;
    if (this.rejectAudit.blockedFor(k) > 0 || this.rejectAudit.hit(k)) return;
    await writeAudit(this.svc.d.db, ctx, {
      tenantId: who.tenantId,
      userId: who.userId,
      username: who.username,
      action: REQUEST_COMMS_AUDIT.MESSAGE_REJECTED,
      entity: "support_requests",
      entityId: requestId,
      result: "fail",
      newValue: { reason, sender: who.sender },
    });
  }

  /** Şifre çözme; hata → null + `rs_crypto_decrypt_failures_total{table}` (alarm). Gövde/hata metni loglanmaz. */
  private decrypt(r: Pick<Row, "id" | "tenantId" | "requestId" | "bodyEnc">): string | null {
    try {
      return this.secrets.decrypt(r.bodyEnc, aadFor.sessionMessage(r.tenantId, r.requestId ?? "", r.id));
    } catch {
      this.svc.d.metrics.inc("rs_crypto_decrypt_failures_total", { table: TABLE });
      this.svc.d.log.error({ alarm: "crypto_decrypt_failed", table: TABLE, messageId: r.id }, "mesaj gövdesi çözülemedi");
      return null;
    }
  }

  private toItem(r: Row): RequestMessageItem {
    return {
      id: r.id,
      sender: r.sender as MessageSender,
      senderName: r.sender === "TECH" ? displayName(r.senderUser?.fullName) : null,
      body: this.decrypt(r),
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Müşteriye giden biçim (çözülemeyen gövde → sabit metin; şema `body` ≥ 1 ister). */
  private toChat(r: Row, withClientMsgId: boolean): Omit<RequestChatMessage, "t"> {
    return {
      id: r.id,
      sender: r.sender as MessageSender,
      ...(r.sender === "TECH" ? { senderName: displayName(r.senderUser?.fullName) } : {}),
      body: this.decrypt(r) ?? MESSAGE_UNREADABLE_LABEL,
      createdAt: r.createdAt.toISOString(),
      ...(withClientMsgId && r.sender === "CUSTOMER" && r.clientMsgId ? { clientMsgId: r.clientMsgId } : {}),
    };
  }

  /**
   * Ortak yazım: tavan → şifrele → koşullu INSERT + audit (tek TX). `null` → talep PENDING değil (satır 0).
   * Yinelenen clientMsgId'de mevcut satır döner (`duplicate: true`), audit/metrik yazılmaz.
   */
  private async store(
    ctx: AuditContext,
    who: Who,
    requestId: string,
    body: string,
    clientMsgId: string,
  ): Promise<{ row: Row; duplicate: boolean } | "cap" | "closed"> {
    const { db } = this.svc.d;
    const dup = await findByClientMsgId(db, who.tenantId, requestId, who.sender, clientMsgId);
    if (dup) return { row: dup, duplicate: true };
    if ((await countBySender(db, who.tenantId, requestId, who.sender)) >= MESSAGES_PER_SENDER_MAX) return "cap";
    const id = newId();
    const createdAt = new Date(this.now);
    const n = chars(body);
    const bodyEnc = this.secrets.encrypt(body, aadFor.sessionMessage(who.tenantId, requestId, id));
    try {
      const ok = await db.$transaction(async (tx) => {
        const inserted = await this.insertRow(tx, {
          id,
          tenantId: who.tenantId,
          requestId,
          sender: who.sender,
          senderUserId: who.userId,
          clientMsgId,
          bodyEnc,
          bodyChars: n,
          createdAt,
        });
        if (inserted === 0) return false;
        await writeAudit(tx, ctx, {
          tenantId: who.tenantId,
          userId: who.userId,
          username: who.username,
          action: REQUEST_COMMS_AUDIT.MESSAGE_SENT,
          entity: "support_requests",
          entityId: requestId,
          result: "success",
          newValue: { sender: who.sender, chars: n },
        });
        return true;
      });
      if (!ok) return "closed";
    } catch (err) {
      // Eşzamanlı aynı clientMsgId (UQ) → mevcut satır (idempotent).
      if (conflictIndex(err) !== null) {
        const again = await findByClientMsgId(db, who.tenantId, requestId, who.sender, clientMsgId);
        if (again) return { row: again, duplicate: true };
      }
      throw err;
    }
    this.svc.d.metrics.inc("rs_request_messages_total", { sender: who.sender });
    const row = await findByClientMsgId(db, who.tenantId, requestId, who.sender, clientMsgId);
    if (!row) throw new Error("message_missing_after_insert");
    return { row, duplicate: false };
  }

  /** Commit sonrası: müşteriye (yetenekli soket) mesaj/yankı + panele gövdesiz etkinlik. */
  private deliver(tenantId: string, requestId: string, row: Row, notifyPanel: boolean): void {
    this.svc.d.hub.sendChat(requestId, { t: "request.message", ...this.toChat(row, true) });
    if (notifyPanel) this.svc.d.hub.activity(tenantId, requestId, row.sender as MessageSender, row.createdAt.toISOString());
  }

  // ---------------- panel (REST)

  /** GET /support-requests/:id/messages (view; PENDING okuma audit'siz — K-P18-2a, `rs_request_messages_read_total`). */
  async list(tenantId: string, requestId: string, after?: string): Promise<RequestMessageListResponse> {
    const { db, hub, metrics } = this.svc.d;
    const r = await db.supportRequest.findFirst({ where: { id: requestId, tenantId }, select: { status: true } });
    if (!r) throw new AppError("NOT_FOUND");
    if (r.status !== "PENDING") throw new AppError("REQUEST_CLOSED");
    const rows = await listRows(db, tenantId, requestId, MESSAGE_PAGE_MAX, after);
    metrics.inc("rs_request_messages_read_total");
    return { items: rows.map((x) => this.toItem(x)), customerChat: hub.chatState(requestId) };
  }

  /**
   * POST /support-requests/:id/messages (view + message). S-P18-T5c: TECH göndereni aynı tenant'ın kullanıcısı ya da firma
   * bağlamındaki Super Admin (tenantScope zaten bağlamı verir; burada açıkça doğrulanır).
   */
  async fromTech(
    ctx: AuditContext,
    auth: AuthContext,
    tenantId: string,
    requestId: string,
    body: string,
    clientMsgId: string,
  ): Promise<SendRequestMessageResponse> {
    if (auth.user.tenantId !== tenantId && auth.user.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN");
    const { db, hub } = this.svc.d;
    const who: Who = { tenantId, userId: auth.user.id, username: auth.user.email, sender: "TECH" };
    const r = await db.supportRequest.findFirst({ where: { id: requestId, tenantId }, select: { status: true } });
    if (!r) throw new AppError("NOT_FOUND");
    if (r.status !== "PENDING") {
      await this.rejected(ctx, who, requestId, "closed");
      throw new AppError("REQUEST_CLOSED");
    }
    if (hub.chatState(requestId) === "UNSUPPORTED") {
      await this.rejected(ctx, who, requestId, "unsupported");
      throw new AppError("CHAT_UNSUPPORTED");
    }
    if (!this.takeRequestSlot(requestId, "TECH")) {
      await this.rejected(ctx, who, requestId, "rate");
      throw new AppError("RATE_LIMITED", { message: RATE_MESSAGE, retryAfterSec: 1 });
    }
    const out = await this.store(ctx, who, requestId, body, clientMsgId);
    if (out === "cap") {
      await this.rejected(ctx, who, requestId, "cap");
      throw new AppError("RATE_LIMITED", { message: CAP_MESSAGE, retryAfterSec: 60 });
    }
    if (out === "closed") {
      await this.rejected(ctx, who, requestId, "closed");
      throw new AppError("REQUEST_CLOSED");
    }
    if (!out.duplicate) this.deliver(tenantId, requestId, out.row, true);
    return { id: out.row.id, createdAt: out.row.createdAt.toISOString() };
  }

  // ---------------- müşteri (/ws/request, yalnız caps.chat)

  /**
   * `request.message` (S-P18-T1 c): genel kova/JSON/şema ws.ts'te geçti; burada sohbet kovaları — talep 1/sn → firma 300/dk
   * → tavan. Aşım `error RATE_LIMITED`, soket AÇIK kalır. Talep PENDING değilse `request.chat {enabled:false}`.
   * INSERT hatası → `error INTERNAL`, iletim yok (gövdesiz log: yalnız requestId + chars — S-P18-T9).
   */
  async fromCustomer(ctx: AuditContext, conn: RequestConn, body: string, clientMsgId: string): Promise<void> {
    const { hub, log } = this.svc.d;
    const { requestId, tenantId } = conn;
    const who: Who = { tenantId, userId: null, username: CUSTOMER_USERNAME, sender: "CUSTOMER" };
    const rate = (reason: RejectReason, message: string) => {
      hub.sendChatError(requestId, "RATE_LIMITED", message);
      return this.rejected(ctx, who, requestId, reason);
    };
    if (!this.takeRequestSlot(requestId, "CUSTOMER")) return rate("rate", RATE_MESSAGE);
    if (this.tenantCustomer.blockedFor(tenantId) > 0 || this.tenantCustomer.hit(tenantId)) {
      this.tenantAlert(tenantId);
      return rate("tenant_rate", RATE_MESSAGE);
    }
    let out: Awaited<ReturnType<RequestMessages["store"]>>;
    try {
      out = await this.store(ctx, who, requestId, body, clientMsgId);
    } catch (err) {
      log.error({ err, event: "request_message_store", requestId, chars: chars(body) }, "talep mesajı saklanamadı");
      hub.sendChatError(requestId, "INTERNAL", "Mesaj gönderilemedi.");
      return;
    }
    if (out === "cap") return rate("cap", CAP_MESSAGE);
    if (out === "closed") {
      await this.rejected(ctx, who, requestId, "closed");
      hub.sendChat(requestId, { t: "request.chat", enabled: false });
      return;
    }
    this.deliver(tenantId, requestId, out.row, !out.duplicate);
  }

  /** Firma müşteri kovası aşıldı: panellere `queue.alert` (pencere başına bir kez) + alarm logu (remote-watch). */
  private tenantAlert(tenantId: string): void {
    const until = this.now + this.tenantCustomer.blockedFor(tenantId) * 1000;
    const prev = this.alertedUntil.get(tenantId) ?? 0;
    if (prev > this.now) return;
    if (this.alertedUntil.size > 10_000) this.alertedUntil.clear();
    this.alertedUntil.set(tenantId, until);
    this.svc.d.hub.publish(tenantId, { t: "queue.alert", kind: "rate_limited", until: new Date(until).toISOString() });
    this.svc.d.log.warn({ alarm: "request_message_tenant_rate", tenantId }, "firma müşteri mesajı kovası aşıldı");
  }

  /** Yetenekli soket bağlandı (PENDING): son 50 mesaj `request.messages`. */
  async sendHistory(conn: RequestConn): Promise<void> {
    if (!conn.caps.chat) return;
    const rows = await lastRows(this.svc.d.db, conn.tenantId, conn.requestId, MESSAGE_HISTORY_WS);
    this.svc.d.hub.sendChat(conn.requestId, { t: "request.messages", items: rows.map((r) => this.toChat(r, true)) });
  }
}

interface Who {
  tenantId: string;
  userId: string | null;
  username: string;
  sender: MessageSender;
}
