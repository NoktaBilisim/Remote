import { describe, expect, it } from "vitest";
import type { ServerOutbound } from "@remote/contracts/ws";
import { guestReducer, initialGuest, resumingGuest, type GuestState } from "./guest-machine";
import { backoff, guestProtocols, parseServerMessage, wsUrl } from "./signal";
import { iceGate, initialIceGate, initialTech, techReducer, type IceGate, type TechState } from "./tech-machine";

const SID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const GID = "01JABCDEFGHJKMNPQRSTVWXYZ1";
const hello = (over: Partial<Extract<ServerOutbound, { t: "hello" }>> = {}): ServerOutbound => ({
  t: "hello",
  role: "guest",
  sessionId: SID,
  peerPresent: true,
  iceServers: [],
  maxEndsAt: "2026-11-11T12:00:00.000Z",
  reconnectToken: "a".repeat(43),
  ...over,
});
const g = (s: GuestState, ...ms: ServerOutbound[]) => ms.reduce((a, m) => guestReducer(a, { type: "msg", m }), s);
const tm = (s: TechState, ...ms: ServerOutbound[]) => ms.reduce((a, m) => techReducer(a, { type: "msg", m, now: 1000 }), s);

describe("misafir durum makinesi", () => {
  it("lobi → kabul → paylaşım → bitiş", () => {
    let s = g(initialGuest, { t: "lobby.wait", expiresAt: "2026-11-11T10:05:00.000Z" });
    expect(s.phase).toBe("lobby");
    s = g(s, hello());
    expect(s).toMatchObject({ phase: "live", techPresent: true, reconnectToken: "a".repeat(43) });
    s = guestReducer(s, { type: "share", on: true });
    expect(s.share).toBe("sharing");
    s = g(s, { t: "session.ended", reason: "tech" });
    expect(s).toMatchObject({ phase: "ended", end: "ended", share: "idle" });
    expect(g(s, hello())).toBe(s); // bittikten sonra olay yok sayılır
  });
  it("lobide paylaşım olayı yok sayılır; ret/lobi süresi ayrı ekran", () => {
    const lobby = g(initialGuest, { t: "lobby.wait", expiresAt: "2026-11-11T10:05:00.000Z" });
    expect(guestReducer(lobby, { type: "share", on: true }).share).toBe("idle");
    expect(g(lobby, { t: "session.ended", reason: "rejected" }).end).toBe("rejected");
    expect(g(lobby, { t: "session.ended", reason: "lobby_timeout" }).end).toBe("lobbyTimeout");
    expect(g(lobby, { t: "session.ended", reason: "timeout" }).end).toBe("expired");
  });
  it("kabul sonrası kopma → yeniden bağlanma; lobide kopma → kayıp; 1008 → hata", () => {
    const live = g(initialGuest, hello());
    const lost = guestReducer(live, { type: "closed", code: 1006, now: 5 });
    expect(lost).toMatchObject({ phase: "live", reconnectSince: 5 });
    expect(guestReducer(lost, { type: "closed", code: 1006, now: 9 }).reconnectSince).toBe(5);
    expect(g(lost, hello()).reconnectSince).toBeNull();
    expect(guestReducer(lost, { type: "giveUp" }).end).toBe("lost");
    const lobby = g(initialGuest, { t: "lobby.wait", expiresAt: "2026-11-11T10:05:00.000Z" });
    expect(guestReducer(lobby, { type: "closed", code: 1006, now: 1 }).end).toBe("lost");
    expect(guestReducer(live, { type: "closed", code: 1008, now: 1 }).end).toBe("error");
  });
  it("teknisyen ayrılınca/dönünce, ICE ve uyarı güncellenir", () => {
    let s = g(initialGuest, hello(), { t: "peer.left", role: "tech", reason: "disconnect" });
    expect(s.techPresent).toBe(false);
    s = g(s, { t: "peer.joined", role: "tech" }, { t: "ice.servers", iceServers: [{ urls: ["turn:x"] }] });
    expect(s.techPresent).toBe(true);
    expect(s.iceServers).toHaveLength(1);
    expect(g(s, { t: "session.warning", kind: "max_duration_5min", endsAt: "2026-11-11T12:00:00.000Z" }).warnEndsAt).toBeTruthy();
  });
});

describe("misafir F5 dönüşü (TEST-P4-1)", () => {
  it("hello → doğrudan live (lobi yok), yeni token alınır; hello öncesi kapanış → resumeFailed", () => {
    const live = g(resumingGuest, hello({ reconnectToken: "b".repeat(43) }));
    expect(live).toMatchObject({ phase: "live", resuming: false, reconnectToken: "b".repeat(43), share: "idle" });
    expect(guestReducer(resumingGuest, { type: "closed", code: 1006, now: 1 })).toMatchObject({ phase: "ended", end: "resumeFailed" });
    // Dönüşten sonra kopma normal yeniden bağlanma penceresine girer
    expect(guestReducer(live, { type: "closed", code: 1006, now: 5 }).reconnectSince).toBe(5);
    expect(g(resumingGuest, { t: "session.ended", reason: "tech" })).toMatchObject({ phase: "ended", end: "ended" });
  });
});

describe("teknisyen durum makinesi", () => {
  const pending = (id = GID, name = "Ayşe"): ServerOutbound => ({
    t: "peer.pending",
    guestId: id,
    name,
    guestKind: "BROWSER",
    since: "2026-11-11T10:00:00.000Z",
  });
  it("PENDING hello → lobi → hatalı kod → kabul → paylaşım", () => {
    let s = tm(initialTech, hello({ role: "tech", maxEndsAt: null, peerPresent: false, reconnectToken: undefined }), pending(), pending());
    expect(s.phase).toBe("waiting");
    expect(s.pending).toHaveLength(1); // tekrar eden bildirim çoğaltılmaz
    s = techReducer(s, { type: "admit" });
    expect(s).toMatchObject({ admitBusy: true, admitName: "Ayşe" });
    s = tm(s, { t: "error", code: "ADMIT_CODE_INVALID", message: "x" });
    expect(s).toMatchObject({ admitBusy: false, wrongCodes: 1, lastError: "ADMIT_CODE_INVALID" });
    s = tm(techReducer(s, { type: "admit" }), { t: "peer.joined", role: "guest", guestKind: "BROWSER" });
    expect(s).toMatchObject({ phase: "live", pending: [], guest: { name: "Ayşe", kind: "BROWSER" }, share: "unknown" });
    s = tm(s, { t: "share.state", state: "sharing" });
    expect(s.share).toBe("sharing");
    s = tm(s, { t: "peer.left", role: "guest", reason: "disconnect" });
    expect(s.peerLostSince).toBe(1000);
    expect(tm(s, { t: "session.ended", reason: "timeout" })).toMatchObject({ phase: "ended", end: "timeout" });
  });
  it("ret sayacı ve lobiden düşme", () => {
    let s = tm(initialTech, hello({ role: "tech", maxEndsAt: null }), pending());
    s = techReducer(s, { type: "reject" });
    s = tm(s, { t: "peer.pending.left", guestId: GID, reason: "rejected" });
    expect(s).toMatchObject({ rejects: 1, pending: [] });
  });
  it("kapanış kodları: 4401, 4409, 1008 son; diğerleri yeniden bağlanma", () => {
    const s = tm(initialTech, hello({ role: "tech", maxEndsAt: null }));
    expect(techReducer(s, { type: "closed", code: 4401, now: 1 }).end).toBe("auth_revoked");
    expect(techReducer(s, { type: "closed", code: 4409, now: 1 }).end).toBe("replaced");
    expect(techReducer(s, { type: "closed", code: 1009, now: 1 }).end).toBe("protocol");
    const r = techReducer(s, { type: "closed", code: 1006, now: 7 });
    expect(r).toMatchObject({ phase: "waiting", reconnectSince: 7 });
    expect(tm(r, hello({ role: "tech", maxEndsAt: null })).reconnectSince).toBeNull();
  });
  it("P28u K4: izinli istekte cihaz onayı sonrası güncel PENDING hello kipi getirir; unattended'sız hello kipi korur; ICE kapısı açılmaz", () => {
    const u = { deviceId: GID, deviceName: "AKTIF-PC", intervene: true };
    const pend = (unattended?: typeof u & { consentMode?: "asked" }) =>
      hello({ role: "tech", maxEndsAt: null, peerPresent: false, reconnectToken: undefined, ...(unattended ? { unattended } : {}) });
    const first = tm(initialTech, pend(u));
    expect(first).toMatchObject({ phase: "waiting", unattended: u });
    expect(first.unattended?.consentMode).toBeUndefined();
    const second = tm(first, pend({ ...u, consentMode: "asked" }));
    expect(second).toMatchObject({ phase: "waiting", guest: null, unattended: { consentMode: "asked", intervene: true } });
    expect(tm(second, pend()).unattended?.consentMode).toBe("asked");
    expect(iceGate(initialIceGate, pend({ ...u, consentMode: "asked" }))).toEqual({ gate: { ready: false, pending: false }, start: false });
  });
  it("ACTIVE oturuma yeniden bağlanan konsol: müşteri yoksa kopuk sayılır", () => {
    expect(tm(initialTech, hello({ role: "tech", peerPresent: false })).peerLostSince).toBe(1000);
  });
  it("yenilenen konsol: müşteri adı sekme belleğinden geri yüklenir; var olan ad ezilmez", () => {
    const s = tm(initialTech, hello({ role: "tech" }));
    expect(s.guest).toMatchObject({ name: null });
    expect(techReducer(s, { type: "restoreName", name: "Ayşe" }).guest?.name).toBe("Ayşe");
    expect(techReducer(s, { type: "restoreName", name: null }).guest?.name).toBeNull();
    const named = techReducer(s, { type: "restoreName", name: "Ayşe" });
    expect(techReducer(named, { type: "restoreName", name: "Başka" }).guest?.name).toBe("Ayşe");
    // PENDING (müşteri yok) iken ad uydurulmaz
    expect(techReducer(tm(initialTech, hello({ role: "tech", maxEndsAt: null })), { type: "restoreName", name: "Ayşe" }).guest).toBeNull();
  });
  it("TEST-P4-2: canlı kabulde peer.joined{guest, maxEndsAt} kalan süreyi başlatır; alan yoksa önceki değer kalır", () => {
    const w = tm(initialTech, hello({ role: "tech", maxEndsAt: null, peerPresent: false, reconnectToken: undefined }));
    expect(w.maxEndsAt).toBeNull();
    const end = "2026-11-11T18:00:00.000Z";
    const l = tm(w, { t: "peer.joined", role: "guest", guestKind: "BROWSER", maxEndsAt: end } as ServerOutbound);
    expect(l).toMatchObject({ phase: "live", maxEndsAt: end });
    // Misafir yeniden bağlanınca (alan yok) sayaç sıfırlanmaz; geçersiz değer yok sayılır
    expect(tm(l, { t: "peer.joined", role: "guest", guestKind: "BROWSER" }).maxEndsAt).toBe(end);
    expect(tm(w, { t: "peer.joined", role: "guest", maxEndsAt: "dün" } as ServerOutbound).maxEndsAt).toBeNull();
  });
  it("QA-P4-12: hello{tech} ad + paylaşım durumu, peer.joined adı taşırsa onlar kullanılır", () => {
    const h = { ...hello({ role: "tech" }), guestName: "Ayşe", share: { state: "sharing" } } as ServerOutbound;
    const s = tm(initialTech, h);
    expect(s).toMatchObject({ phase: "live", guest: { name: "Ayşe" }, share: "sharing" });
    // Sunucudan gelen ad sekme belleğindeki eski adla ezilmez
    expect(techReducer(s, { type: "restoreName", name: "Eski" }).guest?.name).toBe("Ayşe");
    let l = tm(initialTech, hello({ role: "tech", maxEndsAt: null }), pending(GID, "Ayşe"), pending("01JABCDEFGHJKMNPQRSTVWXYZ2", "Ali"));
    l = techReducer(l, { type: "admit" });
    expect(l.admitName).toBeNull(); // >1 bekleyen: tahmin yok
    expect(tm(l, { t: "peer.joined", role: "guest", guestKind: "BROWSER" }).guest?.name).toBeNull(); // → "Müşteri"
    expect(tm(l, { t: "peer.joined", role: "guest", guestKind: "BROWSER", guestName: "Ali" } as ServerOutbound).guest?.name).toBe("Ali");
  });
});

describe("teknisyen ilk teklif kapısı (TURN'süz ilk teklif düzeltmesi)", () => {
  const TURN = [{ urls: ["turn:turn.example:3478"], username: "1:x", credential: "c" }];
  const run = (ms: ServerOutbound[], g: IceGate = initialIceGate) =>
    ms.reduce<{ gate: IceGate; starts: number }>(
      (a, m) => {
        const r = iceGate(a.gate, m);
        return { gate: r.gate, starts: a.starts + (r.start ? 1 : 0) };
      },
      { gate: g, starts: 0 },
    );
  const pendingHello = hello({ role: "tech", peerPresent: false, maxEndsAt: null, reconnectToken: undefined });
  const joined: ServerOutbound = { t: "peer.joined", role: "guest", guestKind: "AGENT" };

  it("PENDING hello sonrası peer.joined ICE gelmeden teklif başlatmaz; ilk ice.servers ile tek kez başlatır", () => {
    const a = run([pendingHello, joined]);
    expect(a).toEqual({ gate: { ready: false, pending: true }, starts: 0 });
    const b = run([{ t: "ice.servers", iceServers: TURN }], a.gate);
    expect(b).toEqual({ gate: { ready: true, pending: false }, starts: 1 });
    expect(run([{ t: "ice.servers", iceServers: TURN }], b.gate).starts).toBe(0); // yenileme yeni peer kurmaz
  });
  it("sunucu sırası (ice.servers → peer.joined): peer.joined anında başlatır; TURN yoksa boş liste de hazır sayılır", () => {
    expect(run([pendingHello, { t: "ice.servers", iceServers: TURN }, joined]).starts).toBe(1);
    expect(run([pendingHello, { t: "ice.servers", iceServers: [] }, joined]).starts).toBe(1);
  });
  it("ACTIVE hello (yeniden bağlanma) misafir varsa hemen başlatır; misafir dönüşünde peer.joined yeniden başlatır", () => {
    const a = run([hello({ role: "tech", peerPresent: true, iceServers: TURN, reconnectToken: undefined })]);
    expect(a).toEqual({ gate: { ready: true, pending: false }, starts: 1 });
    expect(run([{ t: "peer.left", role: "guest" }, joined], a.gate).starts).toBe(1);
  });
  it("bekleyen teklif misafir ayrılınca düşer; teknisyen peer.joined'ı kapıyı etkilemez", () => {
    const a = run([pendingHello, joined, { t: "peer.left", role: "guest" }]);
    expect(a.gate.pending).toBe(false);
    expect(run([{ t: "ice.servers", iceServers: TURN }], a.gate).starts).toBe(0);
    expect(run([pendingHello, { t: "peer.joined", role: "tech" }]).gate.pending).toBe(false);
  });
});

describe("sinyal yardımcıları", () => {
  it("URL'de kimlik bilgisi yok; ticket alt protokolde", () => {
    expect(wsUrl("/ws/guest", { protocol: "https:", host: "h:4450" })).toBe("wss://h:4450/ws/guest");
    expect(wsUrl("/ws/guest", { protocol: "http:", host: "localhost" })).toBe("ws://localhost/ws/guest");
    expect(guestProtocols({ ticket: "T" })).toEqual(["rs.v1", "rs.ticket.T"]);
    expect(guestProtocols({ reconnect: "R" })).toEqual(["rs.v1", "rs.reconnect.R"]);
  });
  it("şema dışı/bozuk mesaj yok sayılır", () => {
    expect(parseServerMessage("{")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "lobby.wait", expiresAt: "x" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "control.revoke", reason: "bogus" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "p99.unknown" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "share.state", state: "sharing" }))).toEqual({ t: "share.state", state: "sharing" });
  });
  it("geri çekilme 10 sn ile sınırlı", () => {
    expect([0, 1, 2, 3, 4, 9].map(backoff)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });
});
