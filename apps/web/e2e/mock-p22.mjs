// E2E sahte API — P22 oturum sohbeti (mimari-p22 §4, §5.1, §8; AC-264, AC-291, AC-292). Yalnız test.
// 1) WS sohbet taklidi (mock-ws.mjs çağırır): `chat.state/history/message/rejected`, eski istemci (`guestChat:"outdated"`),
//    çıkış çerçeveleri contracts şemasından geçer. Gövde "#reddet" içeren ilk gönderim `chat.rejected{internal}` (Tekrar dene sınaması).
// 2) Oturum geçmişi sohbeti: GET /sessions/:id/chat (u-hc-* → sessions.view_chat; diğer geçmiş çerezleri 403). Özet
//    `chatSummaryOf` mock-history detayına eklenir.
// 3) Aydınlatma metni + genel ayarlar bandı: u-p22ct-* (ADMIN; metin sohbet paragrafı içermez → chatParagraphMissing).
import { createHash } from "node:crypto";
import { CHAT_CONSENT_KEY_SENTENCE, CHAT_CONSENT_PARAGRAPH, chatBodySchema } from "@remote/contracts/chat";
import { chatHistorySchema, chatMessageSchema, chatRejectedSchema, chatStateSchema, WS_CAP_SCHAT } from "@remote/contracts/ws-chat";

const send = (ws, m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
let seq = 0;
/** Artan ULID benzeri id (saklama sırası = id sırası). */
const chatId = () => `01JCHAT${String(++seq).padStart(19, "0")}`;

// ---------------------------------------------------------------------------------------------------------------
// 1) WS
// ---------------------------------------------------------------------------------------------------------------

/** Soket alt protokollerinden `rs.cap.schat1`. */
export const hasSchat = (protos) => protos.includes(WS_CAP_SCHAT);

/** Misafir kabulünde: oda sohbet durumu (gözetimsiz oda bu sahte sunucuda yok). */
export function chatAdmit(r, schat) {
  r.chat ??= { items: [], rejectedOnce: new Set() };
  r.guestSchat = schat;
  r.guestChat = schat ? "on" : "outdated";
  if (schat) {
    send(r.guest, chatStateSchema.parse({ t: "chat.state", enabled: true }));
    if (r.chat.items.length) send(r.guest, chatHistorySchema.parse({ t: "chat.history", items: r.chat.items, more: false }));
  }
  send(r.tech, chatStateSchema.parse({ t: "chat.state", enabled: true }));
}

/** Teknisyen `hello` eki (yalnız kabul edilmiş misafir varken). */
export const chatHelloFields = (r) => (r.guest && r.guestChat ? { guestChat: r.guestChat } : {});

/** Teknisyen `hello` sonrası: etkin odada durum + geçmiş. */
export function chatTechHello(r, ws, active) {
  if (!active) return send(ws, chatStateSchema.parse({ t: "chat.state", enabled: false, reason: "not_active" }));
  send(ws, chatStateSchema.parse({ t: "chat.state", enabled: true }));
  if (r.chat?.items.length) send(ws, chatHistorySchema.parse({ t: "chat.history", items: r.chat.items, more: false }));
}

function store(r, ws, m, sender) {
  const reject = (reason) => send(ws, chatRejectedSchema.parse({ t: "chat.rejected", clientMsgId: m.clientMsgId, reason }));
  if (!r.chat) return reject("not_active");
  const b = chatBodySchema.safeParse(m.body);
  if (!b.success) return reject("invalid");
  if (b.data.includes("#reddet") && !r.chat.rejectedOnce.has(m.clientMsgId)) {
    r.chat.rejectedOnce.add(m.clientMsgId);
    return reject("internal");
  }
  const item = {
    id: chatId(),
    sender,
    ...(sender === "TECH" ? { tid: "OOOOOOOOOOO", senderName: "Mehmet Kaya" } : {}),
    body: b.data,
    createdAt: new Date().toISOString(),
  };
  r.chat.items.push(item);
  r.chatLog = [...(r.chatLog ?? []), { sender, body: b.data }];
  const own = { t: "chat.message", ...item, clientMsgId: m.clientMsgId };
  const other = { t: "chat.message", ...item };
  send(r.tech, chatMessageSchema.parse(sender === "TECH" ? own : other));
  if (r.guestSchat) send(r.guest, chatMessageSchema.parse(sender === "CUSTOMER" ? own : other));
}

/** Teknisyen `chat.send` (true = işlendi). Eski misafir → `outdated`, satır yok (AC-264 iki tarafta kapalı). */
export function chatTech(r, ws, m) {
  if (m.t !== "chat.send") return false;
  if (!r.guest && !r.chat) return (send(ws, chatRejectedSchema.parse({ t: "chat.rejected", clientMsgId: m.clientMsgId, reason: "not_active" })), true);
  if (r.guestChat === "outdated")
    return (send(ws, chatRejectedSchema.parse({ t: "chat.rejected", clientMsgId: m.clientMsgId, reason: "outdated" })), true);
  store(r, ws, m, "TECH");
  return true;
}

/** Misafir `chat.send`: yalnız `schat1` sokette şemada (aksi gerçek sunucuda 1008; burada yok sayılır). */
export function chatGuest(r, m) {
  if (m.t !== "chat.send") return false;
  if (r.guestSchat) store(r, r.guest, m, "CUSTOMER");
  return true;
}

/** Test kancası verisi: odada saklanan mesajlar (gönderen + gövde). */
export const chatLogOf = (r) => r?.chatLog ?? [];

// ---------------------------------------------------------------------------------------------------------------
// 2) Oturum geçmişi sohbeti (mock-history kimlikleri: kullanıcının kendi oturumları çift sıralı)
// ---------------------------------------------------------------------------------------------------------------

const H = (i) => `01JHXST${String(i).padStart(19, "0")}`;
const RICH = "01JHXST0000000000000000000";
const LEGACY_ID = H(4);
const ERROR_ID = H(6);
const REQUEST_ID = H(20);

/** `GET /sessions/:id/history` `chat` alanı (yalnız `sessions.view_chat` sahibine; çağıran denetler). */
export function chatSummaryOf(id) {
  if (id === RICH) return { count: 4, legacy: false };
  if (id === LEGACY_ID) return { count: 0, legacy: true };
  if (id === ERROR_ID) return { count: 2, legacy: false };
  if (id === REQUEST_ID) return { count: 1, legacy: false };
  return { count: 0, legacy: false };
}

const at = (min) => new Date(Date.parse("2026-11-10T09:00:00Z") + min * 60_000).toISOString();
const it = (n, sender, body, min) => ({
  id: `01JHCHAT${String(n).padStart(18, "0")}`,
  sender,
  senderName: sender === "TECH" ? "Mehmet Kaya" : null,
  body,
  createdAt: at(min),
});
const failed = new Set();
/** Görüntüleme sayacı (audit taklidi: `after`'sız çağrı). */
export const chatViews = new Map();

function chatResponse(id, after) {
  if (id === RICH) {
    if (after)
      return { request: null, session: { items: [it(4, "CUSTOMER", "Teşekkürler, sorun çözüldü.", 9)], more: false } };
    return {
      request: null,
      session: {
        items: [
          it(1, "TECH", "Merhaba, ekranınızı görüyorum.", 2),
          it(2, "CUSTOMER", '<img src=x onerror="window.__rsXss=1">', 3),
          { ...it(3, "CUSTOMER", "x", 4), body: null },
        ],
        more: true,
      },
    };
  }
  if (id === REQUEST_ID)
    return {
      request: { items: [it(10, "CUSTOMER", "Yazıcı çalışmıyor", 0), it(11, "TECH", "Birazdan bağlanıyorum", 1)], total: 2 },
      session: { items: [it(12, "TECH", "Bağlandım", 3)], more: false },
    };
  return { request: null, session: { items: [it(20, "TECH", "Merhaba", 2), it(21, "CUSTOMER", "Selam", 3)], more: false } };
}

// ---------------------------------------------------------------------------------------------------------------
// 3) Aydınlatma metni (u-p22ct-*)
// ---------------------------------------------------------------------------------------------------------------

const P22_TENANT = { id: "01JTENA0000000000000000001", name: "Demo Firma" };
const ADMIN_BODY =
  "Demo Firma olarak destek oturumunda ekranınızı yalnız sizin onayınızla görüntüleriz. Kişisel verileriniz 6698 sayılı " +
  "Kanun kapsamında işlenir; ayrıntı için destek@ornek.com adresine yazabilirsiniz.";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const missing = (body) => !body.normalize("NFC").replace(/\s+/g, " ").includes(CHAT_CONSENT_KEY_SENTENCE);
const consentStores = new Map();
function consentStore(cookie) {
  let s = consentStores.get(cookie);
  if (!s) {
    const v = { id: "01JCQNSENT0000000000000005", version: 5, sha256: sha(ADMIN_BODY), createdAt: at(0), createdByName: "Deniz Güven" };
    s = { current: { ...v, body: ADMIN_BODY }, versions: [v] };
    consentStores.set(cookie, s);
  }
  return s;
}
const consentView = (s) => ({ ...s, chatParagraphMissing: missing(s.current.body), chatParagraph: CHAT_CONSENT_PARAGRAPH });

export function p22User(cookie) {
  if (!cookie?.startsWith("u-p22ct-")) return null;
  return {
    user: { id: "01JUSP22000000000000000001", email: "deniz@ornek.com", fullName: "Deniz Güven", role: "ADMIN", mustChangePassword: false },
    permissions: ["sessions.view", "settings.view", "settings.edit"],
    tenant: P22_TENANT,
    actingTenant: null,
  };
}

/** true → istek işlendi. */
export async function handleP22(req, res, { url, session, csrfOk, send: reply, err, readJson }) {
  const path = url.split("?")[0];
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const cm = req.method === "GET" && path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/chat$/);
  if (cm && /^u-h[a-z]*-/.test(session ?? "")) {
    if (!session.startsWith("u-hc-")) return (reply(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const after = q.get("after");
    if (after !== null && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(after)) return (reply(res, 400, err("VALIDATION", "Doğrulama hatası")), true);
    const key = `${session}|${cm[1]}`;
    if (cm[1] === ERROR_ID && !failed.has(key)) {
      failed.add(key);
      return (reply(res, 500, err("INTERNAL", "Sunucu hatası oluştu.")), true);
    }
    if (!after) chatViews.set(key, (chatViews.get(key) ?? 0) + 1);
    return (reply(res, 200, chatResponse(cm[1], after), [], { "Cache-Control": "no-store" }), true);
  }
  const vh = req.method === "GET" && path.match(/^\/__e2e\/chat-views\/([\w-]+)\/([0-9A-Z]{26})$/);
  if (vh) return (reply(res, 200, { views: chatViews.get(`${vh[1]}|${vh[2]}`) ?? 0 }), true);

  const who = p22User(session);
  if (!who) return false;
  if (path === "/api/v1/settings/consent-text") {
    const s = consentStore(session);
    if (req.method === "GET") return (reply(res, 200, consentView(s)), true);
    if (req.method === "PUT") {
      if (!csrfOk) return (reply(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
      const { body = "" } = await readJson(req);
      const text = String(body).replace(/\r\n?/g, "\n").trim();
      if (text === s.current.body) return (reply(res, 200, { ...consentView(s), changed: false }), true);
      const v = { id: `01JCQNSENT${String(s.current.version + 1).padStart(16, "0")}`, version: s.current.version + 1, sha256: sha(text), createdAt: new Date().toISOString(), createdByName: "Deniz Güven" };
      s.current = { ...v, body: text };
      s.versions = [v, ...s.versions];
      return (reply(res, 200, { ...consentView(s), changed: true }), true);
    }
  }
  if (path === "/api/v1/settings/tenant" && req.method === "GET")
    return (
      reply(res, 200, {
        sessionTtlMin: 15,
        maxOpenSessions: 3,
        maxActiveHours: 4,
        maxFileMb: 100,
        retentionDays: 90,
        requireTech2fa: false,
        smtp: null,
      }),
      true
    );
  return false;
}
