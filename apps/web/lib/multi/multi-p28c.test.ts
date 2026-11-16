import { describe, expect, it } from "vitest";
import { LOW_BPS, LOW_FPS, techsRosterSchema, type TechRosterEntry } from "@remote/contracts/ws-multi";
import { MULTI_AUDIT, MULTI_AUDIT_GROUP } from "@remote/contracts/audit";
import { actionLabel, actionOptionGroups } from "@/lib/audit/actions";
import { featureState } from "@/lib/clip/feature-state";
import { offerDecision } from "@/lib/webrtc/guest-peers";
import { senderEncodings } from "@/lib/webrtc/sender-caps";
import { initialTech, techReducer } from "@/lib/webrtc/tech-machine";
import { initialGuest, guestReducer } from "@/lib/webrtc/guest-machine";
import { watchBlock } from "@/app/(panel)/sessions/active-sessions";
import { newInvites } from "@/components/invite-notifier";
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import { inviteBlockOf } from "./errors";
import { canSend, chatAuthor, joinedSince, seatOf, sortedRoster } from "./roster";
import { describeEvent, leaveReasonLabel } from "./timeline";

const A = "AAAAAAAAAAA";
const B = "BBBBBBBBBBB";
const C = "CCCCCCCCCCC";
const roster: TechRosterEntry[] = [
  { tid: A, name: "Ayşe Sahip", role: "controller", owner: true, connected: true },
  { tid: B, name: "Burak Katılımcı", role: "participant", owner: false, connected: true },
  { tid: C, name: "Cem İzleyici", role: "observer", owner: false, connected: true },
];

describe("P28c roster / yer (AC-366..368)", () => {
  it("örnek roster sözleşmeye uyar", () => {
    expect(techsRosterSchema.safeParse({ t: "techs.roster", techs: roster }).success).toBe(true);
  });
  it("yer roster'daki kendi satırdan türetilir; devir sonrası hello olmadan değişir", () => {
    expect(seatOf(roster, A, "owner")).toEqual({ owner: true, controller: true, observer: false });
    expect(seatOf(roster, C, "observer")).toEqual({ owner: false, controller: false, observer: true });
    const after = roster.map((e) => (e.tid === B ? { ...e, owner: true } : e.tid === A ? { ...e, owner: false } : e));
    expect(seatOf(after, B, "participant").owner).toBe(true);
    expect(seatOf([], null, null)).toEqual({ owner: true, controller: true, observer: false });
  });
  it("gönderim kapısı varsayılan-ret (ROLE_MAY)", () => {
    const part = seatOf(roster, B, null);
    expect(canSend(part, "control.request")).toBe(false);
    expect(canSend(part, "quality.summary")).toBe(false);
    expect(canSend(part, "member.leave")).toBe(true);
    expect(canSend(part, "session.end")).toBe(false);
    expect(canSend(seatOf(roster, A, null), "session.transfer")).toBe(true);
    expect(canSend(seatOf(roster, A, null), "uydurma.tip")).toBe(false);
  });
  it("sohbet by → ad yalnız roster'dan; çözülemezse Müşteri (D-PC-4)", () => {
    expect(chatAuthor(B, roster, "Müşteri")).toBe("Burak Katılımcı");
    expect(chatAuthor(undefined, roster, "Müşteri")).toBe("Müşteri");
    expect(chatAuthor("ZZZZZZZZZZZ", roster, "Müşteri")).toBe("Müşteri");
  });
  it("yeni katılan bildirimi ilk roster'da yok; sıralama sahip önce", () => {
    expect(joinedSince(null, roster)).toEqual([]);
    expect(joinedSince(roster.slice(0, 2), roster).map((e) => e.tid)).toEqual([C]);
    expect(sortedRoster([...roster].reverse())[0]!.tid).toBe(A);
  });
});

describe("P28c misafir kabul listesi (Y-PC-4) ve düşük akış (AC-371)", () => {
  it("roster yoksa from'suz eski yol; roster varsa yalnız çizilmiş + bağlı tid", () => {
    expect(offerDecision(null, new Set(), undefined)).toBe("answer");
    expect(offerDecision(roster, new Set([A]), A)).toBe("answer");
    expect(offerDecision(roster, new Set(), B)).toBe("wait");
    expect(offerDecision(roster, new Set([A]), "ZZZZZZZZZZZ")).toBe("drop");
    expect(offerDecision(roster, new Set([A]), undefined)).toBe("drop");
    const off = roster.map((e) => (e.tid === B ? { ...e, connected: false } : e));
    expect(offerDecision(off, new Set([B]), B)).toBe("drop");
  });
  it("ikincil gönderici tavanlı, kontrol sahibinde tavan kalkar", () => {
    expect(senderEncodings([{ active: true }], true)).toEqual([{ active: true, maxFramerate: LOW_FPS, maxBitrate: LOW_BPS }]);
    expect(senderEncodings([{ maxFramerate: LOW_FPS, maxBitrate: LOW_BPS }], false)).toEqual([{}]);
  });
});

describe("P28c konsol makinesi", () => {
  const hello = {
    t: "hello" as const,
    role: "tech" as const,
    sessionId: "01JSSP28C0000000000000000A",
    peerPresent: true,
    iceServers: [],
    maxEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
    tid: B,
    techRole: "participant" as const,
    roster,
  };
  it("hello tid/techRole/roster; techs.roster günceller", () => {
    let s = techReducer(initialTech, { type: "msg", m: hello, now: 0 });
    expect(s.tid).toBe(B);
    expect(s.roster).toHaveLength(3);
    s = techReducer(s, { type: "msg", m: { t: "techs.roster", techs: roster.slice(0, 2) }, now: 0 });
    expect(s.roster).toHaveLength(2);
  });
  it("4403 → removed (yeniden bağlanma yok); ayrılma → left", () => {
    const live = techReducer(initialTech, { type: "msg", m: hello, now: 0 });
    expect(techReducer(live, { type: "closed", code: 4403, now: 1 })).toMatchObject({ phase: "ended", end: "removed" });
    expect(techReducer(live, { type: "end", end: "left" })).toMatchObject({ phase: "ended", end: "left" });
  });
  it("misafir: teknisyen varlığı roster'dan", () => {
    const g = guestReducer(initialGuest, { type: "msg", m: { t: "techs.roster", techs: roster.map((e) => ({ ...e, connected: false })) } });
    expect(g.techPresent).toBe(false);
  });
});

describe("P28c arayüz kararları", () => {
  it("pano/yazdırma kontrol sahibi değilken pasif + neden", () => {
    const s = featureState({
      feature: "clipboard",
      permitted: true,
      ready: true,
      guestPresent: true,
      guestKind: "AGENT",
      unattended: false,
      guestFeatures: ["clipboard"],
      controlGranted: true,
      clipConsent: true,
      busy: false,
      notController: true,
    });
    expect(s).toEqual({ visible: true, enabled: false, reason: "notController" });
  });
  it("İzle pasiflik nedenleri (AC-372, V-PC-5)", () => {
    const base = {
      id: "01JSSP28C0000000000000000A",
      technicianName: "A",
      customerName: "M",
      mode: "ATTENDED" as never,
      startedAt: new Date().toISOString(),
      techCount: 1,
      full: false,
      supported: true,
      unattended: false,
      silent: false,
    };
    expect(watchBlock(base)).toBeNull();
    expect(watchBlock({ ...base, supported: false })).toMatch(/desteklemiyor/);
    expect(watchBlock({ ...base, unattended: true, consentMode: "asked" })).toMatch(/İzinli gözetimsiz/);
    expect(watchBlock({ ...base, full: true })).toBe("Oturum dolu");
  });
  it("yalnız yeni davetler bildirilir", () => {
    const i = {
      inviteId: "x".repeat(22),
      sessionId: "s",
      fromName: "A",
      customerName: "M",
      unattended: false,
      silent: false,
      expiresAt: "",
    };
    expect(newInvites(new Set(), [i])).toHaveLength(1);
    expect(newInvites(new Set([i.inviteId]), [i])).toHaveLength(0);
  });
  it("audit: Çoklu teknisyen ayrı grup, 'tümü' yok, etiketli", () => {
    const g = actionOptionGroups().find((x) => x.label === MULTI_AUDIT_GROUP.label);
    expect(g?.options.map((o) => o.value).sort()).toEqual([...MULTI_AUDIT_GROUP.actions].sort());
    expect(actionLabel(MULTI_AUDIT.TRANSFER)).toBe("Oturum devredildi");
    const session = actionOptionGroups().find((x) => x.options.some((o) => o.value === "session.*"));
    expect(session?.options.some((o) => o.value === MULTI_AUDIT.TRANSFER)).toBe(false);
  });
});

describe("P28c K2b: guestMulti, zaman çizelgesi, katılımcılar", () => {
  it("hello/peer.joined guestMulti üç durumlu; peer.left son değeri korur; Davet et pasifliği", () => {
    const hello = {
      t: "hello",
      role: "tech",
      sessionId: "01JSESSION0000000000000000",
      maxEndsAt: new Date(Date.now() + 1e6).toISOString(),
      peerPresent: true,
      iceServers: [],
    };
    const now = Date.now();
    let s = techReducer(initialTech, { type: "msg", m: { ...hello } as never, now });
    expect(s.guestMulti).toBeNull();
    s = techReducer(s, { type: "msg", m: { t: "peer.joined", role: "guest", guestMulti: false } as never, now });
    expect(s.guestMulti).toBe(false);
    s = techReducer(s, { type: "msg", m: { t: "peer.left", role: "guest" } as never, now });
    expect(s.guestMulti).toBe(false);
    s = techReducer(s, { type: "msg", m: { ...hello, guestMulti: true } as never, now });
    expect(s.guestMulti).toBe(true);
    expect(inviteBlockOf(undefined, null)).toBeNull();
    expect(inviteBlockOf(undefined, true)).toBeNull();
    expect(inviteBlockOf(undefined, false)).toBe(MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED);
    expect(inviteBlockOf("asked", true)).toBe(MULTI_ERROR_MESSAGES.JOIN_NOT_ALLOWED);
  });
  it("zaman çizelgesi: P28c etiketi + rol/neden notu; P28c dışı olay contracts etiketinde kalır", () => {
    expect(describeEvent({ action: "session.participant_leave", details: { role: "observer", reason: "disconnect" } })).toEqual({
      label: "Teknisyen ayrıldı",
      note: "Rol: İzleyici · Bağlantı koptu",
      warn: false,
    });
    expect(describeEvent({ action: "session.invite_expire", details: { reason: "revoked" } }).note).toBe("Geri çekildi");
    expect(describeEvent({ action: "session.transfer", details: { failReason: "target_gone" } }).note).toContain("geri alındı");
    expect(describeEvent({ action: "session.invite", details: { inviteeName: "Selin" } })).toMatchObject({
      label: "Teknisyen davet edildi",
      note: "Davet edilen: Selin",
    });
    expect(describeEvent({ action: "session.control_handover", details: {} })).toEqual({
      label: "Kontrol devredildi",
      note: null,
      warn: false,
    });
    expect(describeEvent({ action: "session.created", details: {} }).label).toBe("Oturum oluşturuldu");
    expect(describeEvent({ action: "x.unknown", details: {} }).label).toBe("x.unknown");
  });
  it("katılımcı ayrılma nedeni: removed = müşteri çıkardı", () => {
    expect(leaveReasonLabel("removed")).toBe("Müşteri çıkardı");
    expect(leaveReasonLabel("auth_revoked")).toBe("Yetkisi düştü");
    expect(leaveReasonLabel("yeni")).toBe("yeni");
  });
});
