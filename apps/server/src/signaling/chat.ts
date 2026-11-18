// P22 oturum sohbeti — sinyalizasyon tarafı (mimari-p22 r2 §4.1–4.4, §7, §15.1, §15.4–15.6; AC-264; ADR-0025 m.1).
// Tek yol: gönderen → sunucu (kapı → kova → şifrele → koşullu INSERT) → commit sonrası herkese ilet. DataChannel sohbeti yok.
// Kurallar:
//  - Kapı (§4.3 adım 1): oda ACTIVE değil → `not_active`; gözetimsiz → `forbidden`; izleyici → `forbidden` (handlers, seatMay);
//    lobi misafiri → `forbidden`; kabul edilmiş misafir eski (`guestChat = "outdated"`) → teknisyen de `outdated` (satır 0).
//  - Kovalar (adım 2): gönderen başına 5 / kayan 1 sn, oturumda gönderen başına 2.000 (DB'den tohumlanır), firma müşteri 600/dk.
//  - Oda başına seri zincir: saklama sırası = yayın sırası; geçmiş de aynı zincirde okunur.
//  - Misafire `chat.*` YALNIZ `hasSessionChat` soketine (eski Go istemci yeni tipi alınca 1008 ile düşer — T-P22-5).
//  - Gövde loga, audit'e ve metriğe ASLA girmez (log: sessionId, chars, hata kodu). Mesaj başına audit yok (K-P22-6).
import { MESSAGE_UNREADABLE_LABEL } from "@remote/contracts/api/requests";
import { CHAT_AUDIT, CHAT_AUDIT_REJECT_REASONS, type ChatAuditRejectReason } from "@remote/contracts/audit";
import type { MessageSender } from "@remote/contracts/chat";
import { CHAT_SEND_PER_SEC } from "@remote/contracts/dc";
import type { ServerOutbound } from "@remote/contracts/ws";
import {
  CHAT_HISTORY_MAX,
  CHAT_HISTORY_MAX_BYTES,
  SESSION_CHAT_CAP_PER_SENDER,
  SESSION_CHAT_CAP_TOTAL,
  SESSION_CHAT_TENANT_CUSTOMER_PER_MIN,
  type ChatHistoryItem,
  type ChatRejectReason,
  type ChatSend,
} from "@remote/contracts/ws-chat";
import { CUSTOMER_USERNAME, writeAudit, type AuditContext } from "../audit/service.ts";
import type { SecretBox } from "../lib/crypto.ts";
import { newId } from "../lib/ids.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { fitNewest } from "../lib/ws-budget.ts";
import {
  countBySender,
  decryptRow,
  displayName,
  findByClientMsgId,
  insertIfActive,
  lastSessionChatRows,
  storeChat,
  type ChatInsert,
  type ChatRow,
  type DbOrTx,
  type StoreChatResult,
} from "../sessions/chat.ts";
import { seatOf, techConns, tidOf } from "./members.ts";
import { hasSessionChat } from "./rooms-features.ts";
import type { Rooms } from "./rooms.ts";
import type { ChatRoom, Guest, Peer, Room, TechConn } from "./types.ts";

const MIN = 60_000;
const SEC = 1000;
const CHAT_SYSTEM_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };

/** `bindChat` bağımlılıkları (ws.ts `attachSignaling` bağlar). */
export interface ChatDeps {
  secrets: SecretBox;
  /** Firma müşteri kovası aşıldı → panellere `queue.alert{rate_limited}` (talep hub'ı; yoksa yalnız alarm logu). */
  alert?: (tenantId: string, until: string) => void;
}

/** Oda dışı (süreç başına) sohbet durumu. */
export interface ChatBinding {
  deps: ChatDeps;
  tenantCustomer: FixedWindowCounter;
  alertedUntil: Map<string, number>;
  /** Test enjeksiyon noktası (önce-kaydet testi: INSERT hatası → iletim yok). */
  insert: (db: DbOrTx, m: ChatInsert) => Promise<number>;
}

const bindings = new WeakMap<Rooms, ChatBinding>();

/** Sohbeti odalara bağlar (bağlanmamış `Rooms` — birim testleri — `chat.send`'i `internal` ile reddeder, geçmiş göndermez). */
export function bindChat(rooms: Rooms, deps: ChatDeps): ChatBinding {
  const prev = bindings.get(rooms);
  prev?.tenantCustomer.close();
  const b: ChatBinding = {
    deps,
    tenantCustomer: new FixedWindowCounter(SESSION_CHAT_TENANT_CUSTOMER_PER_MIN + 1, MIN, MIN, { now: () => rooms.clock.now() }),
    alertedUntil: new Map(),
    insert: insertIfActive,
  };
  bindings.set(rooms, b);
  return b;
}

export const chatBindingOf = (rooms: Rooms): ChatBinding | undefined => bindings.get(rooms);

/** Kapanışta kova zamanlayıcısı. */
export function unbindChat(rooms: Rooms): void {
  bindings.get(rooms)?.tenantCustomer.close();
  bindings.delete(rooms);
}

function chatOf(room: Room): ChatRoom {
  room.chat ??= { legacyAudited: false, chain: Promise.resolve(), sendTimes: new Map(), rejectAudited: new Set() };
  return room.chat;
}

/** Oda zincirine ekler (hata loglanır, zincir kırılmaz). */
function enqueue(rooms: Rooms, room: Room, job: () => Promise<void>): Promise<void> {
  const c = chatOf(room);
  const next = c.chain.then(job).catch((err: unknown) => {
    rooms.log.error(
      { ref: newId(), event: "session_chat_chain", sessionId: room.sessionId, code: errCode(err) },
      "oturum sohbeti işlenemedi",
    );
  });
  c.chain = next;
  return next;
}

const errCode = (err: unknown): string => {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : err instanceof Error ? err.name : "unknown";
};

/** Sohbet etkin mi: oda ACTIVE (kabul edilmiş, bitmiyor) ve gözetimsiz değil. */
const chatActive = (rooms: Rooms, room: Room): boolean => rooms.live(room) && Boolean(room.admitted) && !room.unattended;

/** Bağlı misafirin sohbet soketi (yalnız `hasSessionChat`). */
function guestChatPeer(room: Room): Peer | undefined {
  const p = room.admitted?.peer;
  return p && hasSessionChat(room, p) ? p : undefined;
}

// ------------------------------------------------------------------ gönderen

/** Gönderen (audit aktörü + satır alanları). */
interface Who {
  sender: MessageSender;
  peer: Peer;
  userId: string | null;
  username: string;
  ctx: AuditContext;
}

const keyOf = (w: Who): string => (w.sender === "TECH" ? `tech:${w.userId ?? ""}` : "customer");

const techWho = (conn: TechConn): Who => ({
  sender: "TECH",
  peer: conn.peer,
  userId: conn.userId,
  username: conn.username,
  ctx: conn.ctx,
});
const guestWho = (guest: Guest, peer: Peer): Who => ({
  sender: "CUSTOMER",
  peer,
  userId: null,
  username: CUSTOMER_USERNAME,
  ctx: guest.ctx ?? CHAT_SYSTEM_CTX,
});

const isAuditReason = (r: ChatRejectReason): r is ChatAuditRejectReason => (CHAT_AUDIT_REJECT_REASONS as readonly string[]).includes(r);

/**
 * Ret: yalnız gönderen sokete `chat.rejected` (soket açık), metrik her seferinde; audit yalnız `CHAT_AUDIT_REJECT_REASONS` ve
 * (neden, gönderen) başına oturumda 1. Misafir soketi `hasSessionChat` değilse çerçeve gönderilmez (eski istemci düşmesin).
 */
function reject(rooms: Rooms, room: Room, who: Who, clientMsgId: string, reason: ChatRejectReason): void {
  rooms.metrics.inc("rs_session_chat_rejected_total", { reason });
  if (who.sender === "TECH" || hasSessionChat(room, who.peer)) who.peer.send({ t: "chat.rejected", clientMsgId, reason });
  if (!isAuditReason(reason)) return;
  const c = chatOf(room);
  const k = `${reason}|${keyOf(who)}`;
  if (c.rejectAudited.has(k)) return;
  c.rejectAudited.add(k);
  void writeAudit(rooms.db, who.ctx, {
    tenantId: room.tenantId,
    userId: who.userId,
    username: who.username,
    action: CHAT_AUDIT.REJECTED,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "fail",
    newValue: { reason, sender: who.sender },
  }).catch((err: unknown) => {
    rooms.log.error(
      { ref: newId(), event: "session_chat_audit_failed", sessionId: room.sessionId, code: errCode(err) },
      "sohbet ret audit'i yazılamadı",
    );
  });
}

/** Gönderen başına 5 / kayan 1 sn (kabul anı kaydedilir). */
function takeSenderSlot(rooms: Rooms, c: ChatRoom, key: string): boolean {
  const now = rooms.clock.now();
  const times = (c.sendTimes.get(key) ?? []).filter((t) => now - t < SEC);
  if (times.length >= CHAT_SEND_PER_SEC) {
    c.sendTimes.set(key, times);
    return false;
  }
  times.push(now);
  c.sendTimes.set(key, times);
  return true;
}

/** Firma müşteri kovası (600/dk); aşımda pencere başına bir `queue.alert` + alarm logu. */
function takeTenantSlot(rooms: Rooms, b: ChatBinding, tenantId: string): boolean {
  if (b.tenantCustomer.blockedFor(tenantId) === 0 && !b.tenantCustomer.hit(tenantId)) return true;
  const now = rooms.clock.now();
  if ((b.alertedUntil.get(tenantId) ?? 0) <= now) {
    const until = now + b.tenantCustomer.blockedFor(tenantId) * SEC;
    if (b.alertedUntil.size > 10_000) b.alertedUntil.clear();
    b.alertedUntil.set(tenantId, until);
    b.deps.alert?.(tenantId, new Date(until).toISOString());
    rooms.log.warn({ alarm: "session_chat_tenant_rate", tenantId }, "firma müşteri oturum sohbeti kovası aşıldı");
  }
  return false;
}

// ------------------------------------------------------------------ giriş

/** Teknisyen `chat.send` (rol kapısı handlers'ta geçti). */
export function handleTechChat(rooms: Rooms, room: Room, conn: TechConn, m: ChatSend): void {
  gateAndStore(rooms, room, techWho(conn), m);
}

/** Kabul edilmiş `schat1` misafirin `chat.send`'i. */
export function handleGuestChat(rooms: Rooms, room: Room, guest: Guest, peer: Peer, m: ChatSend): void {
  gateAndStore(rooms, room, guestWho(guest, peer), m);
}

/** Rol/durum reddi (izleyici, lobi misafiri): `forbidden`, soket açık. */
export function rejectTechForbidden(rooms: Rooms, room: Room, conn: TechConn, clientMsgId: string): void {
  reject(rooms, room, techWho(conn), clientMsgId, "forbidden");
}
export function rejectGuestForbidden(rooms: Rooms, room: Room, guest: Guest, peer: Peer, clientMsgId: string): void {
  reject(rooms, room, guestWho(guest, peer), clientMsgId, "forbidden");
}

/** Zarf geçerli, gövde geçersiz (1.001 kod noktası, bidi…): `invalid`, soket açık. */
export function rejectTechInvalid(rooms: Rooms, room: Room, conn: TechConn, clientMsgId: string): void {
  reject(rooms, room, techWho(conn), clientMsgId, "invalid");
}
export function rejectGuestInvalid(rooms: Rooms, room: Room, guest: Guest, peer: Peer, clientMsgId: string): void {
  reject(rooms, room, guestWho(guest, peer), clientMsgId, "invalid");
}

/** §4.3 adım 1–2 (eşzamanlı, varışta) → adım 3–5 oda zincirinde. */
function gateAndStore(rooms: Rooms, room: Room, who: Who, m: ChatSend): void {
  const id = m.clientMsgId;
  if (!rooms.live(room) || !room.admitted) return reject(rooms, room, who, id, "not_active");
  if (room.unattended) return reject(rooms, room, who, id, "forbidden");
  const c = chatOf(room);
  if (c.guestChat !== "on") return reject(rooms, room, who, id, c.guestChat === "outdated" ? "outdated" : "not_active");
  const b = bindings.get(rooms);
  if (!b) return reject(rooms, room, who, id, "internal");
  if (!takeSenderSlot(rooms, c, keyOf(who))) return reject(rooms, room, who, id, "rate");
  if (who.sender === "CUSTOMER" && !takeTenantSlot(rooms, b, room.tenantId)) return reject(rooms, room, who, id, "rate");
  void enqueue(rooms, room, () => storeAndDeliver(rooms, room, b, who, m));
}

async function storeAndDeliver(rooms: Rooms, room: Room, b: ChatBinding, who: Who, m: ChatSend): Promise<void> {
  if (!chatActive(rooms, room)) return reject(rooms, room, who, m.clientMsgId, "not_active");
  const c = chatOf(room);
  const key = keyOf(who);
  let out: StoreChatResult;
  try {
    c.counts ??= await seedCounts(rooms.db, room);
    // Gönderen tavanı (2.000) ya da oturum toplam tavanı (10.000; güvenlik P22-Q S-P22-Q-3).
    if ((c.counts.get(key) ?? 0) >= SESSION_CHAT_CAP_PER_SENDER || totalOf(c.counts) >= SESSION_CHAT_CAP_TOTAL) {
      // Tavanda bile zaten saklanmış mesajın yeniden gönderimi idempotent yankı alır (S-P22-10), `cap` değil.
      const prev = await findByClientMsgId(rooms.db, room.tenantId, room.sessionId, who.sender, m.clientMsgId);
      if (prev && prev.senderUserId === who.userId)
        return void who.peer.send({ t: "chat.message", ...itemOf(rooms, room, b, prev), clientMsgId: m.clientMsgId });
      return reject(rooms, room, who, m.clientMsgId, "cap");
    }
    const started = process.hrtime.bigint();
    out = await storeChat(
      { db: rooms.db, secrets: b.deps.secrets, insert: b.insert },
      {
        tenantId: room.tenantId,
        sessionId: room.sessionId,
        sender: who.sender,
        senderUserId: who.userId,
        clientMsgId: m.clientMsgId,
        body: m.body,
        now: new Date(rooms.clock.now()),
      },
    );
    rooms.metrics.observe("rs_session_chat_store_seconds", Number(process.hrtime.bigint() - started) / 1e9);
  } catch (err) {
    // T-P22-3: INSERT hatası → iletim YOK. Log gövdesiz (sessionId, chars, hata kodu).
    rooms.log.error(
      { ref: newId(), event: "session_chat_store", sessionId: room.sessionId, chars: [...m.body].length, code: errCode(err) },
      "oturum sohbeti mesajı saklanamadı",
    );
    return reject(rooms, room, who, m.clientMsgId, "internal");
  }
  switch (out.kind) {
    case "not_active":
      return reject(rooms, room, who, m.clientMsgId, "not_active");
    case "invalid":
      return reject(rooms, room, who, m.clientMsgId, "invalid");
    case "duplicate":
      // S-P22-10: yinelenen → yalnız gönderene yankı; sayaç/metrik/yayın yok.
      who.peer.send({ t: "chat.message", ...itemOf(rooms, room, b, out.row), clientMsgId: m.clientMsgId });
      return;
    case "stored":
      c.counts.set(key, (c.counts.get(key) ?? 0) + 1);
      rooms.metrics.inc("rs_session_chat_messages_total", { sender: who.sender });
      fanOut(rooms, room, b, out.row, who.peer, m.clientMsgId);
  }
}

const totalOf = (counts: Map<string, number>): number => [...counts.values()].reduce((a, b) => a + b, 0);

/** Oturum gönderen sayaçlarını DB'den tohumlar (süreç ömrü boyunca bellekte artar). */
async function seedCounts(db: DbOrTx, room: Room): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const g of await countBySender(db, room.tenantId, room.sessionId)) {
    const k = g.sender === "TECH" ? `tech:${g.senderUserId ?? ""}` : "customer";
    out.set(k, (out.get(k) ?? 0) + g.n);
  }
  return out;
}

/** Commit sonrası yayın: tüm teknisyen soketleri (izleyici dahil) + `schat1` misafir; `clientMsgId` yalnız gönderende. */
function fanOut(rooms: Rooms, room: Room, b: ChatBinding, row: ChatRow, senderPeer: Peer, clientMsgId: string): void {
  const item = itemOf(rooms, room, b, row);
  const to = (p: Peer): void => p.send(p === senderPeer ? { t: "chat.message", ...item, clientMsgId } : { t: "chat.message", ...item });
  for (const conn of techConns(room)) to(conn.peer);
  const g = guestChatPeer(room);
  if (g) to(g);
}

/** Satır → `chat.message` / `chat.history` öğesi (çözülemeyen gövde sabit metin; şema `body` ≥ 1 ister). */
function itemOf(rooms: Rooms, room: Room, b: ChatBinding, r: ChatRow): ChatHistoryItem {
  const body = decryptRow({ secrets: b.deps.secrets, metrics: rooms.metrics, log: rooms.log }, r) ?? MESSAGE_UNREADABLE_LABEL;
  const at = r.createdAt.toISOString();
  if (r.sender !== "TECH") return { id: r.id, sender: "CUSTOMER", body, createdAt: at };
  return {
    id: r.id,
    sender: "TECH",
    ...(r.senderUserId ? { tid: tidOf(room, r.senderUserId) } : {}),
    senderName: displayName(r.senderUser?.fullName),
    body,
    createdAt: at,
  };
}

// ------------------------------------------------------------------ durum + geçmiş

/** `chat.state` (misafire yalnız `schat1` sokete). */
const stateMsg = (enabled: boolean, reason?: "not_active" | "ended"): ServerOutbound =>
  ({ t: "chat.state", enabled, ...(reason ? { reason } : {}) }) as const;

/**
 * Teknisyen `hello` sonrası (§4.2): `chat.state` (ACTIVE değilse `not_active`) + koltuklu sokete `chat.history`. Gözetimsiz
 * odada sohbet yok (K-P22-8) → hiçbir `chat.*` gitmez. Dönen: gönderilen geçmiş öğe sayısı (katılım audit'i `chatHistory`).
 */
export function chatTechHello(rooms: Rooms, room: Room, conn: TechConn): Promise<number> {
  if (room.unattended) return Promise.resolve(0);
  conn.peer.send(room.admitted ? stateMsg(true) : stateMsg(false, "not_active"));
  if (!room.admitted) return Promise.resolve(0);
  return sendHistory(rooms, room, conn.peer, () => seatOf(room, conn.peer) !== null);
}

/**
 * Misafir `hello` sonrası (admit + yeniden bağlanma): `guestChat` güncellenir; `schat1` sokete `chat.state{true}` + geçmiş;
 * eski istemcide oturum başına bir `session.chat_legacy` (+ metrik). Gözetimsiz odada hiçbir şey yapılmaz.
 */
export function chatGuestHello(rooms: Rooms, room: Room, guest: Guest): void {
  if (room.unattended) return;
  const c = chatOf(room);
  const peer = guest.peer;
  if (hasSessionChat(room, peer) && peer) {
    c.guestChat = "on";
    peer.send(stateMsg(true));
    void sendHistory(rooms, room, peer, () => room.admitted?.peer === peer);
    return;
  }
  c.guestChat = "outdated";
  if (c.legacyAudited) return;
  c.legacyAudited = true;
  rooms.metrics.inc("rs_session_chat_legacy_sessions_total");
  void enqueue(rooms, room, () =>
    writeAudit(rooms.db, CHAT_SYSTEM_CTX, {
      tenantId: room.tenantId,
      username: "system",
      action: CHAT_AUDIT.LEGACY,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: {},
    }),
  );
}

/**
 * Güvenlik P22-Q S-P22-Q-1 (r2 §15.5): üyeye ilk katılımında gönderilen geçmiş sayısı — katılım audit'inden ayrı, gövdesiz satır
 * (`n > 0` iken, üye başına 1; çağıran yalnız ilk katılımda çağırır). En iyi çaba (hata loglanır).
 */
export function auditHistorySent(rooms: Rooms, room: Room, conn: TechConn, n: number): Promise<void> {
  if (n <= 0) return Promise.resolve();
  return writeAudit(rooms.db, conn.ctx, {
    tenantId: room.tenantId,
    userId: conn.userId,
    username: conn.username,
    action: CHAT_AUDIT.HISTORY_SENT,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "success",
    newValue: { userId: conn.userId, n },
  }).catch((err: unknown) => {
    rooms.log.error(
      { ref: newId(), event: "session_chat_audit_failed", sessionId: room.sessionId, code: errCode(err) },
      "sohbet geçmiş audit'i yazılamadı",
    );
  });
}

/** Kabul anında teknisyenlere `chat.state{true}` (önceki hello'da `not_active` almışlardı). */
export function chatAdmitted(room: Room): void {
  if (room.unattended) return;
  for (const conn of techConns(room)) conn.peer.send(stateMsg(true));
}

/** Teknisyen `hello` / `peer.joined{guest}` eki (alan yok = kabul edilmiş misafir yok ya da gözetimsiz). */
export function guestChatField(room: Room): { guestChat?: "on" | "outdated" } {
  const s = room.chat?.guestChat;
  return room.admitted && !room.unattended && s ? { guestChat: s } : {};
}

/** Oda kapanışı (teardown; `session.ended`'dan önce): `chat.state{false, ended}`. */
export function chatRoomClosed(room: Room): void {
  if (!room.admitted || room.unattended) return;
  const msg = stateMsg(false, "ended");
  for (const conn of techConns(room)) conn.peer.send(msg);
  guestChatPeer(room)?.send(msg);
}

/** Bitiş yolları özetten önce bekler (uçuştaki INSERT ve `chat_legacy` audit'i sayıma girsin). */
export function chatSettled(room: Room): Promise<void> {
  return room.chat?.chain ?? Promise.resolve();
}

/**
 * `chat.history` (S-P22-1, S-P22-5): son ≤ 100 mesaj, çerçeve ≤ 48 KiB (zarf dahil), artan; 101. satır ya da bütçe → `more`.
 * Oda zincirinde okunur (yayınla sıralı); okuma sonrası soket hâlâ yetkili mi (`stillMay`) ve oda ACTIVE mi yeniden denetlenir.
 */
function sendHistory(rooms: Rooms, room: Room, peer: Peer, stillMay: () => boolean): Promise<number> {
  const b = bindings.get(rooms);
  if (!b) return Promise.resolve(0);
  let sent = 0;
  return enqueue(rooms, room, async () => {
    if (!chatActive(rooms, room) || !stillMay()) return;
    const rows = await lastSessionChatRows(rooms.db, room.tenantId, room.sessionId, CHAT_HISTORY_MAX + 1);
    if (!chatActive(rooms, room) || !stillMay() || !peer.isOpen()) return;
    const extra = rows.length > CHAT_HISTORY_MAX;
    const items = rows.slice(-CHAT_HISTORY_MAX).map((r) => itemOf(rooms, room, b, r));
    const fit = fitNewest(items, (kept, more) => ({ t: "chat.history", items: kept, more }), CHAT_HISTORY_MAX_BYTES);
    peer.send({ t: "chat.history", items: fit.items, more: fit.more || extra });
    sent = fit.items.length;
  }).then(() => sent);
}
