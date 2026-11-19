// E2E sahte API — P28c-K2 çoklu teknisyen arayüzü (mimari-p28c r2 §4.1, §4.4). Yalnız test; sözleşme contracts api/multi.ts,
// ws-multi.ts. Çerez u-p28c<senaryo>-<rastgele>:
//   p28cinv  USER (sessions.view): 2 gelen davet (biri gözetimsiz); Katıl → üye konsolu (katılımcı roster'ı); Reddet → 204.
//   p28csup  ADMIN (sessions.supervise): etkin oturumlar (normal / desteklemiyor / gözetimsiz); İzle → izleyici konsolu.
//   p28cown  USER (sessions.invite): sahip konsolu; roster'da bağlı katılımcı; adaylar; davet 201 / geri çek 204.
//   p28cunsup aynı (sahip) ama hello.guestMulti=false (AC-372; adaylar yine 409 CLIENT_UNSUPPORTED — yarış yolu). Sahip konsolu kimliği: GET /api/v1/__e2e/p28c-own.
// Konsol WS'i mock-ws.mjs: kayıttaki `multiHello` teknisyen hello'suna eklenir (tid/techRole/roster).
import { createInviteInputSchema, joinWithReasonInputSchema, MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import { techsRosterSchema } from "@remote/contracts/ws-multi";
import { byId, ulid } from "./mock-sessions.mjs";

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const TENANT = { id: "01JTNP28C0000000000000000A", name: "Demo Firma" };
const SELF = "01JMSP28C0000000000000000A";
// Oturum kimlikleri çerez başına üretilir (paralel desktop/mobile projeleri aynı odaya bağlanıp 4409 ile birbirini atmasın).
const TID = { OWNER: "AAAAAAAAAAA", ME: "MMMMMMMMMMM", PART: "PPPPPPPPPPP" };
const KINDS = /^u-(p28cinv|p28csup|p28cown|p28cunsup)-/;

export function p28cUser(cookie) {
  const m = cookie?.match(KINDS);
  if (!m) return null;
  const kind = m[1];
  const perms = ["sessions.view"];
  if (kind === "p28csup") perms.push("sessions.supervise");
  if (kind === "p28cown" || kind === "p28cunsup") perms.push("sessions.invite", "sessions.create");
  return {
    kind,
    user: {
      id: SELF,
      email: "p28c@ornek.com",
      username: null,
      fullName: "Elif Teknisyen",
      role: kind === "p28csup" ? "ADMIN" : "USER",
      tenantId: TENANT.id,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    permissions: perms,
    tenant: TENANT,
    actingTenant: null,
    mfa: { enabled: true, required: false, stage: "ok", recoveryCodesLeft: 10 },
  };
}

const roster = (meRole) => {
  const techs = [
    { tid: TID.OWNER, name: "Ayşe Sahip", role: "controller", owner: true, connected: true },
    { tid: TID.ME, name: "Elif Teknisyen", role: meRole, owner: false, connected: true },
  ];
  techsRosterSchema.parse({ t: "techs.roster", techs });
  return techs;
};
const ownerRoster = () => {
  const techs = [
    { tid: TID.ME, name: "Elif Teknisyen", role: "controller", owner: true, connected: true },
    { tid: TID.PART, name: "Burak Katılımcı", role: "participant", owner: false, connected: true },
  ];
  techsRosterSchema.parse({ t: "techs.roster", techs });
  return techs;
};

function seed(id, ownerSelf, multiHello) {
  if (byId.has(id)) return;
  const view = {
    id,
    status: "ACTIVE",
    code: null,
    techVerifyCode: ownerSelf ? "4321" : "",
    technician: ownerSelf ? { id: SELF, name: "Elif Teknisyen" } : { id: "01JUSER0000000000000000099", name: "Ayşe Sahip" },
    createdAt: iso(-600_000),
    expiresAt: iso(600_000),
    endedAt: null,
    endedBy: null,
    endReason: null,
  };
  byId.set(id, { view, token: `p28c-${id}`, ref: `p28c-${id}`, multiHello });
}
const stores = new Map();
function store(cookie, kind) {
  let s = stores.get(cookie);
  if (s) return s;
  const ids = { inv: ulid(), sup: ulid(), own: ulid() };
  seed(ids.inv, false, { tid: TID.ME, techRole: "participant", roster: roster("participant"), guestMulti: true });
  seed(ids.sup, false, { tid: TID.ME, techRole: "observer", roster: roster("observer"), guestMulti: true });
  // K1c (AC-372): p28cunsup misafiri multi1 bildirmedi → hello.guestMulti=false ("Davet et" baştan pasif)
  seed(ids.own, true, { tid: TID.ME, techRole: "owner", roster: ownerRoster(), guestMulti: kind !== "p28cunsup" });
  s = {
    ids,
    invites: [
      {
        inviteId: "inv000000000000000000A",
        sessionId: ids.inv,
        fromName: "Ayşe Sahip",
        customerName: "Ali Müşteri",
        unattended: false,
        expiresAt: iso(110_000),
      },
      {
        inviteId: "inv000000000000000000B",
        sessionId: ids.sup,
        fromName: "Ayşe Sahip",
        customerName: "SUNUCU-01",
        unattended: true,
        expiresAt: iso(110_000),
      },
    ],
    active: [
      {
        id: ids.sup,
        technicianName: "Ayşe Sahip",
        customerName: "Ali Müşteri",
        mode: "ATTENDED",
        startedAt: iso(-300_000),
        techCount: 1,
        full: false,
        supported: true,
        unattended: false,
      },
      {
        id: ulid(),
        technicianName: "Can Eski",
        customerName: "Eski İstemci",
        mode: "ATTENDED",
        startedAt: iso(-200_000),
        techCount: 1,
        full: false,
        supported: false,
        unattended: false,
      },
      {
        id: ids.inv,
        technicianName: "Ayşe Sahip",
        customerName: "SUNUCU-01",
        mode: "UNATTENDED",
        startedAt: iso(-50_000),
        techCount: 2,
        full: false,
        supported: true,
        unattended: true,
        consentMode: "no_user",
      },
    ],
    sent: [],
    seq: 0,
  };
  stores.set(cookie, s);
  return s;
}

/** Panel kabuğu her sayfada yoklar: P28c dışı kullanıcılara boş liste. */
export function emptyInvites(url) {
  const path = url.split("?")[0];
  return path === "/api/v1/sessions/invites" || /^\/api\/v1\/sessions\/[0-9A-Z]{26}\/invites$/.test(path);
}

export async function handleP28c(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = p28cUser(session);
  if (!who) return false;
  const path = url.split("?")[0];
  const m = req.method;
  const s = store(session, who.kind);
  const ok = (st, body) => (send(res, st, body), true);
  // Test kancası: çerezin sahip konsolu oturum kimliği
  if (m === "GET" && path === "/api/v1/__e2e/p28c-own") return ok(200, { id: s.ids.own });
  const one = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})$/);
  if (m === "GET" && one && Object.values(s.ids).includes(one[1])) {
    const rec = byId.get(one[1]);
    return rec ? ok(200, rec.view) : ok(404, err("NOT_FOUND", "Bulunamadı."));
  }
  if (m === "GET" && path === "/api/v1/sessions/invites") return ok(200, { items: who.kind === "p28cinv" ? s.invites : [] });
  if (m === "GET" && path === "/api/v1/sessions/active")
    return who.kind === "p28csup" ? ok(200, { items: s.active }) : ok(403, err("FORBIDDEN", "Yetkiniz yok."));
  const cand = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/invite-candidates$/);
  if (m === "GET" && cand) {
    if (who.kind === "p28cunsup") return ok(409, err("CLIENT_UNSUPPORTED", MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED));
    return ok(200, {
      items: [
        { userId: "01JKRP28C0000000000000000A", fullName: "Kerem Yardımcı", avatarUrl: null },
        { userId: "01JKRP28C0000000000000000B", fullName: "Selin Destek", avatarUrl: null },
      ],
    });
  }
  // K1c: sahibin bekleyen giden davetleri (bitişe göre artan; süresi dolan düşer)
  const out = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/invites$/);
  if (m === "GET" && out) {
    if (out[1] !== s.ids.own) return ok(200, { items: [] });
    const now = Date.now();
    return ok(200, { items: s.sent.filter((x) => Date.parse(x.expiresAt) > now) });
  }
  if (m === "GET") return false;
  if (!csrfOk) return ok(403, err("CSRF_INVALID", "CSRF doğrulaması başarısız."));
  const inv = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/invites$/);
  if (m === "POST" && inv) {
    const p = createInviteInputSchema.safeParse(await readJson(req));
    if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası"));
    const r = { inviteId: `snt${String(s.seq++).padStart(19, "0")}`, expiresAt: iso(120_000) };
    const names = { "01JKRP28C0000000000000000A": "Kerem Yardımcı", "01JKRP28C0000000000000000B": "Selin Destek" };
    s.sent.push({ inviteId: r.inviteId, userId: p.data.userId, inviteeName: names[p.data.userId] ?? "Teknisyen", expiresAt: r.expiresAt });
    return ok(201, r);
  }
  const del = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/invites\/([\w-]{22})$/);
  if (m === "DELETE" && del) {
    s.sent = s.sent.filter((x) => x.inviteId !== del[2]);
    return (send(res, 204), true);
  }
  const acc = path.match(/^\/api\/v1\/sessions\/invites\/([\w-]{22})\/(accept|reject)$/);
  if (m === "POST" && acc) {
    const i = s.invites.find((x) => x.inviteId === acc[1]);
    if (!i) return ok(410, err("INVITE_GONE", MULTI_ERROR_MESSAGES.INVITE_GONE));
    s.invites = s.invites.filter((x) => x !== i);
    if (acc[2] === "reject") return (send(res, 204), true);
    return ok(200, { sessionId: i.sessionId, consoleUrl: `/sessions/${i.sessionId}/console` });
  }
  const sup = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/supervise$/);
  if (m === "POST" && sup) {
    const body = await readJson(req);
    const p = joinWithReasonInputSchema.safeParse(body);
    const row = s.active.find((x) => x.id === sup[1]);
    // P28u r3 (K-P28u-r3-9): gövde boş nesne; eski `reason` alanı → 400
    if (!p.success || !row) return ok(400, err("VALIDATION", "Doğrulama hatası"));
    return ok(200, { sessionId: s.ids.sup, consoleUrl: `/sessions/${s.ids.sup}/console` });
  }
  return false;
}
