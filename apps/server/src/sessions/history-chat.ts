// P22 — oturum geçmişinde sohbet görüntüleme: GET /sessions/:id/chat?after= (mimari-p22 §5.1–5.3, r2 §15.6 S-P22-11;
// AC-264, AC-255 K-P18-2). Zincir route'ta: requireAuth → `session_history.view` + `sessions.view_chat` → burada
// historyScope (USER yalnız kendi oturumu) → hız (60/dk/kullanıcı) → okuma → (after'sız ilk çağrıda) audit.
// Kapsam dışı / yok / başka tenant → 404 (IDOR). Gövde loga/audit'e yazılmaz; audit yalnız sayı taşır.
import {
  SESSION_CHAT_PAGE_MAX,
  type SessionChatItem,
  type SessionChatQuery,
  type SessionChatResponse,
} from "@remote/contracts/api/sessions";
import { CHAT_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { chatRowSelect, listSessionChatRows, viewRow, type ChatCryptoDeps, type ChatRow } from "./chat.ts";
import { historyWhere } from "./history-repo.ts";
import { historyScope } from "./service.ts";

/** §5.3: aynı kullanıcı + oturum için `session.chat_viewed` en çok 10 dk'da bir (bellek; yeniden başlamada sıfırlanır). */
export const CHAT_VIEW_AUDIT_WINDOW_MS = 10 * 60_000;
/** Pencere haritası üst sınırı: dolunca temizlenir (fazla audit yazılır, eksik değil — hassas okuma). */
const VIEW_MARKS_MAX = 50_000;

/**
 * `session.chat_viewed` penceresi. Bilerek `FixedWindowCounter` değil: o kapasite dolunca kapalı kalır (fail-closed) ve
 * audit'i sessizce düşürürdü; burada taşmada harita boşaltılır → audit yazılır.
 */
export class ChatViewMarks {
  private readonly marks = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Pencere içinde audit yazıldıysa true. */
  recent(key: string): boolean {
    const at = this.marks.get(key);
    return at !== undefined && this.now() - at < CHAT_VIEW_AUDIT_WINDOW_MS;
  }

  /** Audit başarıyla yazıldıktan SONRA çağrılır. */
  mark(key: string): void {
    if (this.marks.size >= VIEW_MARKS_MAX) this.marks.clear();
    this.marks.set(key, this.now());
  }
}

export interface SessionChatDeps extends ChatCryptoDeps {
  db: Db;
  /** 60/dk/kullanıcı (61. istek 429). */
  limiter: FixedWindowCounter;
  viewMarks: ChatViewMarks;
}

const toItem = (d: ChatCryptoDeps, r: ChatRow): SessionChatItem => {
  const v = viewRow(d, r);
  // `senderUserId` sözleşmede yok (SessionChatItem) — dışarı verilmez.
  return { id: v.id, sender: v.sender, senderName: v.senderName, body: v.body, createdAt: v.createdAt };
};

/**
 * Bağlı talebin kabul öncesi yazışması (K-P18-2 kapanışı): talep aynı tenant'ta ve anonim değilse; `items` ilk
 * `SESSION_CHAT_PAGE_MAX` (artan), `total` tam sayı (talep sohbeti gönderen başına ≤ 200 → toplam ≤ 400).
 */
async function requestSection(
  d: SessionChatDeps,
  tenantId: string,
  requestId: string,
): Promise<{ items: SessionChatItem[]; total: number } | null> {
  const req = await d.db.supportRequest.findFirst({ where: { id: requestId, tenantId, anonymizedAt: null }, select: { id: true } });
  if (!req) return null;
  const where = { requestId, tenantId };
  const [rows, total] = await Promise.all([
    d.db.sessionMessage.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: SESSION_CHAT_PAGE_MAX,
      select: chatRowSelect,
    }),
    d.db.sessionMessage.count({ where }),
  ]);
  return { items: rows.map((r) => toItem(d, r)), total };
}

/** GET /sessions/:id/chat (AC-264, AC-255). */
export async function getSessionChat(
  d: SessionChatDeps,
  ctx: AuditContext,
  auth: AuthContext,
  id: string,
  q: SessionChatQuery,
): Promise<SessionChatResponse> {
  const scope = historyScope(auth);
  const wait = d.limiter.blockedFor(auth.user.id);
  if (wait > 0 || d.limiter.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  const row = await d.db.supportSession.findFirst({
    where: { ...historyWhere(scope), id },
    select: { id: true, tenantId: true, requestId: true },
  });
  if (!row) throw new AppError("NOT_FOUND");
  // S-P22-11: `after` yalnız aynı oturum + tenant'ta aranır; bulunmazsa yok sayılır (baştan listelenir).
  const rows = await listSessionChatRows(d.db, row.tenantId, row.id, SESSION_CHAT_PAGE_MAX + 1, q.after);
  const more = rows.length > SESSION_CHAT_PAGE_MAX;
  const session = { items: rows.slice(0, SESSION_CHAT_PAGE_MAX).map((r) => toItem(d, r)), more };
  const request = q.after === undefined && row.requestId ? await requestSection(d, row.tenantId, row.requestId) : null;
  d.metrics.inc("rs_session_chat_reads_total");
  if (q.after === undefined) {
    const key = `${auth.user.id}|${row.id}`;
    if (!d.viewMarks.recent(key)) {
      await writeAudit(d.db, ctx, {
        tenantId: row.tenantId,
        userId: auth.user.id,
        username: auth.user.email,
        action: CHAT_AUDIT.VIEWED,
        entity: "support_sessions",
        entityId: row.id,
        result: "success",
        newValue: { messages: session.items.length, requestMessages: request?.items.length ?? 0 },
      });
      d.viewMarks.mark(key);
    }
  }
  return { request, session };
}
