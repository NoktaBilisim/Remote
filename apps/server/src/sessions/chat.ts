// P22 oturum sohbeti — satır yazma/okuma (mimari-p22 r2 §3.1–3.2, §4.3 adım 3, §15.4, §15.6 "Okuma AAD"; AC-264; ADR-0025 m.1).
// Kurallar:
//  - Gövde alan şifreli (`aadFor.sessionMessage(tenant, request_id ?? session_id, id)`); oturum satırında `request_id` NULL (K-P22-13).
//  - Satırı okuyan HER kod (WS geçmişi, REST geçmiş ucu, P18 talep mesajları) `decryptRow` kullanır; çözme hatası → `null` +
//    `rs_crypto_decrypt_failures_total{table}` (alarm). Gövde ve hata metni loglanmaz.
//  - Yazım: koşullu INSERT (oturum ACTIVE + tenant) → 0 satır = `not_active`; UQ(session_id, sender, client_msg_id) ihlali →
//    mevcut satır; TECH'te `sender_user_id` aynıysa idempotent, değilse `invalid` (§3.1).
//  - Mesaj başına audit YOK (K-P22-6); oturum bitişinde `writeChatSummary` DB'den sayar (S-P22-4).
import { CHAT_AUDIT, CHAT_SUMMARY_SENDER_IDS_MAX } from "@remote/contracts/audit";
import type { MessageSender } from "@remote/contracts/chat";
import { UNSAFE_NAME_CHARS } from "@remote/contracts/api/sessions";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";

export type DbOrTx = Db | Prisma.TransactionClient;
const TABLE = "session_messages";

/** Teknisyen adı (müşteriye/geçmişe giden): görünmez/kontrol karakteri ayıklanır, ≤ 100 kod noktası (P18'den taşındı). */
export function displayName(fullName: string | null | undefined): string {
  const clean = [...(fullName ?? "")]
    .filter((ch) => !UNSAFE_NAME_CHARS.test(ch))
    .join("")
    .trim();
  return [...clean].slice(0, 100).join("") || "Teknisyen";
}

/** Çözme için gereken bağımlılıklar (metrik + alarm logu). */
export interface ChatCryptoDeps {
  secrets: SecretBox;
  metrics: Metrics;
  log: FastifyBaseLogger;
}

/** Çözülecek satırın asgari alanları. */
export interface EncryptedRow {
  id: string;
  tenantId: string;
  requestId: string | null;
  sessionId: string | null;
  bodyEnc: Uint8Array;
}

/**
 * Tek okuma yardımcısı (r2 §15.6): AAD üst bağı `requestId ?? sessionId`. Hata → `null` + metrik + gövdesiz alarm logu.
 */
export function decryptRow(d: ChatCryptoDeps, r: EncryptedRow): string | null {
  try {
    return d.secrets.decrypt(r.bodyEnc, aadFor.sessionMessage(r.tenantId, r.requestId ?? r.sessionId ?? "", r.id));
  } catch {
    d.metrics.inc("rs_crypto_decrypt_failures_total", { table: TABLE });
    d.log.error({ alarm: "crypto_decrypt_failed", table: TABLE, messageId: r.id }, "mesaj gövdesi çözülemedi");
    return null;
  }
}

/** Oturum sohbeti satırı seçimi (WS + REST ortak). */
export const chatRowSelect = {
  id: true,
  tenantId: true,
  requestId: true,
  sessionId: true,
  sender: true,
  senderUserId: true,
  clientMsgId: true,
  bodyEnc: true,
  createdAt: true,
  senderUser: { select: { fullName: true } },
} as const;
export type ChatRow = Prisma.SessionMessageGetPayload<{ select: typeof chatRowSelect }>;

/** Okunabilir öğe (REST `SessionChatItem` ve WS `chat.message` gövdesinin ortak çekirdeği). */
export interface ChatRowView {
  id: string;
  sender: MessageSender;
  senderUserId: string | null;
  /** Yalnız TECH'te (Display süzgeci, ≤ 100); CUSTOMER'da null. */
  senderName: string | null;
  body: string | null;
  createdAt: string;
}

export function viewRow(d: ChatCryptoDeps, r: ChatRow): ChatRowView {
  const sender = r.sender as MessageSender;
  return {
    id: r.id,
    sender,
    senderUserId: r.senderUserId,
    senderName: sender === "TECH" ? displayName(r.senderUser?.fullName) : null,
    body: decryptRow(d, r),
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Oturum satırları, artan (created_at, id). `after` oturum + tenant ile aranır; bulunmazsa yok sayılır (S-P22-11, P18
 * `listRows` kalıbı). `take` = sayfa + 1 verilirse çağıran `more` hesaplar.
 */
export async function listSessionChatRows(
  db: DbOrTx,
  tenantId: string,
  sessionId: string,
  take: number,
  after?: string,
): Promise<ChatRow[]> {
  let where: Prisma.SessionMessageWhereInput = { sessionId, tenantId, requestId: null };
  if (after) {
    const a = await db.sessionMessage.findFirst({ where: { id: after, sessionId, tenantId }, select: { createdAt: true } });
    if (a) where = { ...where, OR: [{ createdAt: { gt: a.createdAt } }, { createdAt: a.createdAt, id: { gt: after } }] };
  }
  return db.sessionMessage.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take, select: chatRowSelect });
}

/** Son `take` oturum satırı, artan sıra (WS `chat.history`). */
export async function lastSessionChatRows(db: DbOrTx, tenantId: string, sessionId: string, take: number): Promise<ChatRow[]> {
  const rows = await db.sessionMessage.findMany({
    where: { sessionId, tenantId, requestId: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: chatRowSelect,
  });
  return rows.reverse();
}

/** Oturumdaki mesaj sayısı (IX(session_id, tenant_id, created_at)). */
export function countSessionChat(db: DbOrTx, tenantId: string, sessionId: string): Promise<number> {
  return db.sessionMessage.count({ where: { sessionId, tenantId, requestId: null } });
}

// ------------------------------------------------------------------ yazım

export interface ChatInsert {
  id: string;
  tenantId: string;
  sessionId: string;
  sender: MessageSender;
  senderUserId: string | null;
  clientMsgId: string;
  bodyEnc: Uint8Array;
  bodyChars: number;
  createdAt: Date;
}

/** Koşullu INSERT (oturum ACTIVE + tenant ise 1, değilse 0); `request_id` NULL (K-P22-13). */
export function insertIfActive(db: DbOrTx, m: ChatInsert): Promise<number> {
  return db.$executeRaw`INSERT INTO session_messages
      (id, tenant_id, request_id, session_id, sender, sender_user_id, client_msg_id, body_enc, body_chars, created_at)
    SELECT ${m.id}, ${m.tenantId}, NULL, ${m.sessionId}, ${m.sender}, ${m.senderUserId}, ${m.clientMsgId}, ${Buffer.from(m.bodyEnc)},
      ${m.bodyChars}, ${m.createdAt}
    FROM support_sessions WHERE id = ${m.sessionId} AND tenant_id = ${m.tenantId} AND status = 'ACTIVE'`;
}

/** Yinelenen gönderim araması (UQ(session_id, sender, client_msg_id) öneki). */
export function findByClientMsgId(db: DbOrTx, tenantId: string, sessionId: string, sender: MessageSender, clientMsgId: string) {
  return db.sessionMessage.findFirst({ where: { sessionId, tenantId, sender, clientMsgId }, select: chatRowSelect });
}

export interface StoreChatInput {
  tenantId: string;
  sessionId: string;
  sender: MessageSender;
  /** TECH'te soketin kullanıcısı; CUSTOMER'da null. */
  senderUserId: string | null;
  clientMsgId: string;
  /** `chatBodySchema` ile normalize edilmiş gövde. */
  body: string;
  now: Date;
}

export type StoreChatResult =
  { kind: "stored"; row: ChatRow } | { kind: "duplicate"; row: ChatRow } | { kind: "not_active" } | { kind: "invalid" };

export interface StoreChatDeps {
  db: Db;
  secrets: SecretBox;
  /** Test enjeksiyon noktası (önce-kaydet testi). */
  insert?: (db: DbOrTx, m: ChatInsert) => Promise<number>;
}

const chars = (v: string): number => [...v].length;

/**
 * Tekil kısıt ihlali: model çağrısında P2002; ham `$executeRaw` (koşullu INSERT … SELECT) ise P2010 + sürücü kodu 1062
 * (`meta.driverAdapterError.cause.originalCode`, P20 K1 kalıbı).
 */
function isUniqueViolation(err: unknown): boolean {
  if (conflictIndex(err) !== null) return true;
  const cause = (err as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } } } | null)?.meta
    ?.driverAdapterError?.cause;
  const code = cause?.originalCode ?? cause?.code;
  return code === "1062" || code === 1062;
}

/**
 * §4.3 adım 3: id → şifrele → koşullu INSERT. Hata (UQ dışı) fırlatılır — çağıran `internal` ile reddeder, iletmez.
 */
export async function storeChat(d: StoreChatDeps, m: StoreChatInput): Promise<StoreChatResult> {
  const id = newId();
  const bodyEnc = d.secrets.encrypt(m.body, aadFor.sessionMessage(m.tenantId, m.sessionId, id));
  const row: ChatInsert = {
    id,
    tenantId: m.tenantId,
    sessionId: m.sessionId,
    sender: m.sender,
    senderUserId: m.senderUserId,
    clientMsgId: m.clientMsgId,
    bodyEnc,
    bodyChars: chars(m.body),
    createdAt: m.now,
  };
  try {
    const n = await (d.insert ?? insertIfActive)(d.db, row);
    if (n === 0) return { kind: "not_active" };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const prev = await findByClientMsgId(d.db, m.tenantId, m.sessionId, m.sender, m.clientMsgId);
    if (!prev) throw err;
    // §3.1: CUSTOMER'da NULL eşleşmesi aynı oturumun misafiri (S-P22-10); TECH'te kullanıcı farklıysa ret.
    return prev.senderUserId === m.senderUserId ? { kind: "duplicate", row: prev } : { kind: "invalid" };
  }
  const saved = await d.db.sessionMessage.findUnique({ where: { id }, select: chatRowSelect });
  if (!saved) throw new Error("chat_missing_after_insert");
  return { kind: "stored", row: saved };
}

// ------------------------------------------------------------------ özet (S-P22-4)

/** Gönderen başına sayım (tavan tohumu ve özet). */
export async function countBySender(
  db: DbOrTx,
  tenantId: string,
  sessionId: string,
): Promise<{ sender: MessageSender; senderUserId: string | null; n: number }[]> {
  const rows = await db.sessionMessage.groupBy({
    by: ["sender", "senderUserId"],
    where: { sessionId, tenantId, requestId: null },
    _count: { _all: true },
  });
  return rows.map((r) => ({ sender: r.sender as MessageSender, senderUserId: r.senderUserId, n: r._count._all }));
}

/** Oturumda `session.chat_legacy` satırı var mı (özetin `legacy` alanı ve geçmiş detayı aynı kaynaktan). */
export async function hasLegacyAudit(db: DbOrTx, tenantId: string, sessionId: string): Promise<boolean> {
  const n = await db.auditLog.count({
    where: { tenantId, entity: "support_sessions", entityId: sessionId, action: CHAT_AUDIT.LEGACY },
  });
  return n > 0;
}

/** Sistem bağlamı (oturum bitiş yolları süreç kaynaklıdır; IP/UA yok). */
const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "session-chat", requestId: "" };

/**
 * S-P22-4 / §7.1: oturum bitişinde `session.chat_summary {tech, customer, senderUserIds, legacy}` — sayılar DB'den
 * (`GROUP BY sender, sender_user_id`). Mesaj yoksa ve `legacy` değilse yazılmaz. Oturumu bitiren HER yol çağırır
 * (kendi TX'inde); aynı oturum için ikinci kez yazılmaz (yinelenen bitiş yolu).
 */
export async function writeChatSummary(tx: DbOrTx, tenantId: string, sessionId: string, ctx: AuditContext = SYSTEM_CTX): Promise<void> {
  const prev = await tx.auditLog.count({
    where: { tenantId, entity: "support_sessions", entityId: sessionId, action: CHAT_AUDIT.SUMMARY },
  });
  if (prev > 0) return;
  const groups = await countBySender(tx, tenantId, sessionId);
  const legacy = await hasLegacyAudit(tx, tenantId, sessionId);
  let tech = 0;
  let customer = 0;
  const ids: string[] = [];
  for (const g of groups) {
    if (g.sender === "TECH") {
      tech += g.n;
      if (g.senderUserId && ids.length < CHAT_SUMMARY_SENDER_IDS_MAX) ids.push(g.senderUserId);
    } else customer += g.n;
  }
  if (tech + customer === 0 && !legacy) return;
  await writeAudit(tx, ctx, {
    tenantId,
    userId: null,
    username: "system",
    action: CHAT_AUDIT.SUMMARY,
    entity: "support_sessions",
    entityId: sessionId,
    result: "success",
    newValue: { tech, customer, senderUserIds: ids, legacy },
  });
}
