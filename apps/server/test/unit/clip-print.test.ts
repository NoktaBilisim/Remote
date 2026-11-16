// P28a K2 sunucu kapısı birim testleri (mimari-p28 §4.3, r2 Y-P28a-1, O-P28a-1/4/5; AC-343, 344, 347, 348, 351, 352).
// Ağsız: sahte Peer + sahte saat + audit'i belleğe yazan sahte DB. Gerçek WS/MySQL yolu test/integration/clip-print-*.
import type { ServerOutbound } from "@remote/contracts/ws";
import {
  CLIP_CONSENT_PER_MIN,
  CLIP_PENDING_TIMEOUT_MS,
  CLIP_PER_MIN,
  ID_REUSE_WINDOW,
  PRINT_DENY_COOLDOWN_MS,
  PRINT_PENDING_TIMEOUT_MS,
  PRINT_PER_SESSION,
  type GuestFeature,
} from "@remote/contracts/ws-clip-print";
import type { PermissionKey } from "@remote/contracts/permissions";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import {
  handleClipConsent,
  handleClipReport,
  handleClipRequest,
  handlePrintCancel,
  handlePrintReport,
  handlePrintRequest,
  newClipPrint,
  onCapsNarrowed,
  onControlClosed,
  onGuestGone,
} from "../../src/signaling/clip-print.ts";
import { newControl } from "../../src/signaling/control.ts";
import { Rooms } from "../../src/signaling/rooms.ts";
import { capsFor, capsOf, featuresOf } from "../../src/signaling/rooms-features.ts";
import type { Clock, Guest, Peer, Room, TechConn } from "../../src/signaling/types.ts";
import { newMulti } from "../../src/signaling/members.ts";

class Clk implements Clock {
  t = 1_000_000;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => {
    this.timers.set(++this.seq, { at: this.t + ms, fn });
    return this.seq;
  };
  clearTimeout = (h: unknown): void => void this.timers.delete(h as number);
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = target;
  }
}

type Sent = Peer & { sent: ServerOutbound[]; of<T extends ServerOutbound["t"]>(t: T): Extract<ServerOutbound, { t: T }>[] };
function peer(features?: GuestFeature[]): Sent {
  const p: Sent = {
    sent: [],
    send: (m) => void p.sent.push(m),
    close: () => undefined,
    isOpen: () => true,
    of: <T extends ServerOutbound["t"]>(t: T) => p.sent.filter((m): m is Extract<ServerOutbound, { t: T }> => m.t === t),
    ...(features ? { features: new Set(features) } : {}),
  };
  return p;
}

type AuditRow = { action: string; result: string; userId: string | null; username: string | null; newValue: Record<string, unknown> };
const ALL: PermissionKey[] = ["remote_control.use", "remote_control.clipboard", "file_transfer.use", "file_transfer.print"];

function setup(o: { perms?: PermissionKey[]; features?: GuestFeature[]; kind?: "AGENT" | "BROWSER"; control?: "VIEW" | "GRANTED" } = {}) {
  const clock = new Clk();
  const audits: AuditRow[] = [];
  const db = { auditLog: { create: ({ data }: { data: AuditRow }) => Promise.resolve(void audits.push(data)) } } as unknown as Db;
  const metrics = createMetrics();
  const rooms = new Rooms({ db, log: pino({ level: "silent" }), turn: { urls: [], secret: "", ttlMin: 60 }, metrics, clock });
  const perms = new Set(o.perms ?? ALL);
  const techPeer = peer();
  const tech: TechConn = {
    peer: techPeer,
    userId: "01JTECH00000000000000000000",
    username: "tech@example.test",
    authToken: "x",
    permissions: perms,
    role: "USER",
    ctx: { ip: "10.0.0.1", userAgent: "test", requestId: "r" },
  };
  const guestPeer = peer(o.features ?? ["clipboard", "print"]);
  const ctx = { ip: "203.0.113.7", userAgent: "agent", requestId: "q" };
  const guest = { id: "g", name: "Ayşe", kind: o.kind ?? "AGENT", state: "ADMITTED", peer: guestPeer, ctx } as unknown as Guest;
  const room: Room = {
    sessionId: "01JSESSION0000000000000000",
    tenantId: "t1",
    technicianId: tech.userId,
    technicianName: "Tek",
    multi: newMulti(tech.userId),
    expiresAt: 0,
    tech,
    lobby: new Map(),
    lobbyArrivals: 0,
    admitted: guest,
    admitting: false,
    admitFails: 0,
    rejectedIps: new Set(),
    caps: capsOf(perms),
    fileMeta: { quotas: new Map(), auditAt: new Map() },
    control: { ...newControl(), state: o.control ?? "GRANTED" },
    clipPrint: newClipPrint(),
    timers: {},
    ending: false,
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const denied = () =>
    metrics
      .render()
      .split("\n")
      .filter((l) => l.startsWith("rs_clip_print_denied_total{"));
  return { clock, audits, rooms, room, tech, techPeer, guest, guestPeer, flush, denied };
}

const cid = (n: number) => `cid-${String(n).padStart(6, "0")}`;
const lastError = (p: Sent) => p.of("error").at(-1);

describe("P28a capsOf / capsFor / featuresOf (§4.1–4.2)", () => {
  it("AC-352: eski istemciye (özellik yok) yalnız bugünkü iki cap gider; bildirilen özellik eklenir", () => {
    const caps = capsOf(new Set(ALL));
    expect(caps).toEqual(["remote_control", "file_transfer", "clipboard", "print"]);
    expect(capsFor(caps, new Set())).toEqual(["remote_control", "file_transfer"]);
    expect(capsFor(caps, new Set(["clipboard"]))).toEqual(["remote_control", "file_transfer", "clipboard"]);
  });

  it("AC-352 (O-P28a-4): gözetimsiz odada ve tarayıcı misafirinde belirteçler okunmaz; bilinmeyen rs.cap yok sayılır", () => {
    const { room, guest } = setup();
    const protos = ["rs.v1", "rs.cap.clip1", "rs.cap.print1", "rs.cap.chat9"];
    expect([...featuresOf(protos, room, guest)]).toEqual(["clipboard", "print"]);
    expect(
      featuresOf(protos, { ...room, unattended: { deviceId: "d", deviceName: "PC", customerId: "c", consentRequest: "ask" } }, guest).size,
    ).toBe(0);
    expect(featuresOf(protos, room, { ...guest, kind: "BROWSER" }).size).toBe(0);
  });
});

describe("P28a pano kapısı (§4.3 clip.push/clip.pull)", () => {
  it("AC-343: kapı sırası — yetki → misafir → özellik → kontrol → izin → bekleyen → hız → kimlik", () => {
    const noPerm = setup({ perms: ["remote_control.use"] });
    expect(handleClipRequest(noPerm.rooms, noPerm.room, noPerm.tech, { cid: cid(1), bytes: 5 })).toBe(false);
    expect(lastError(noPerm.techPeer)).toMatchObject({ code: "FORBIDDEN" });

    const s = setup({ features: [] });
    expect(handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(1), bytes: 5 })).toBe(false);
    expect(lastError(s.techPeer)?.message).toContain("desteklemiyor");

    const v = setup({ control: "VIEW" });
    v.room.clipPrint.consent = true;
    expect(handleClipRequest(v.rooms, v.room, v.tech, { cid: cid(1) })).toBe(false);
    expect(lastError(v.techPeer)).toMatchObject({ code: "FORBIDDEN", message: "Önce uzaktan kontrol izni alın." });

    const c = setup();
    expect(handleClipRequest(c.rooms, c.room, c.tech, { cid: cid(1), bytes: 5 })).toBe(false);
    expect(lastError(c.techPeer)).toMatchObject({ code: "FORBIDDEN", message: "Müşteri pano iznini açmadı." });
    c.room.clipPrint.consent = true;
    expect(handleClipRequest(c.rooms, c.room, c.tech, { cid: cid(1), bytes: 5 })).toBe(true);
    expect(c.guestPeer.of("clip.push")).toEqual([{ t: "clip.push", cid: cid(1), bytes: 5 }]);
    expect(handleClipRequest(c.rooms, c.room, c.tech, { cid: cid(2) })).toBe(false);
    expect(lastError(c.techPeer)).toMatchObject({ code: "CONFLICT" });
    expect(c.guestPeer.of("clip.pull")).toHaveLength(0);
    expect(c.denied().join("\n")).toContain('reason="pending"');
  });

  it("AC-343: misafir yoksa CONFLICT; tarayıcı misafiri FORBIDDEN", () => {
    const s = setup();
    s.room.admitted = undefined;
    expect(handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(1) })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "CONFLICT" });
    const b = setup({ kind: "BROWSER" });
    b.room.clipPrint.consent = true;
    expect(handleClipRequest(b.rooms, b.room, b.tech, { cid: cid(1) })).toBe(false);
    expect(lastError(b.techPeer)).toMatchObject({ code: "FORBIDDEN" });
  });

  it("AC-347: rapor → audit clipboard.transfer (yön, bayt, sonuç; içerik yok) + clip.status; eşleşmeyen rapor yok sayılır", async () => {
    const s = setup();
    s.room.clipPrint.consent = true;
    handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(1) });
    handleClipReport(s.rooms, s.room, { cid: cid(9), dir: "TO_TECH", bytes: 3, result: "OK" });
    handleClipReport(s.rooms, s.room, { cid: cid(1), dir: "TO_CUSTOMER", bytes: 3, result: "OK" });
    expect(s.techPeer.of("clip.status")).toHaveLength(0);
    handleClipReport(s.rooms, s.room, { cid: cid(1), dir: "TO_TECH", bytes: 42, result: "OK" });
    await s.flush();
    expect(s.techPeer.of("clip.status")).toEqual([{ t: "clip.status", cid: cid(1), result: "OK", bytes: 42 }]);
    expect(s.audits).toHaveLength(1);
    expect(s.audits[0]).toMatchObject({ action: "clipboard.transfer", result: "success", userId: s.tech.userId });
    expect(s.audits[0]?.newValue).toEqual({ direction: "TO_TECH", bytes: 42, result: "OK", reportedBy: "customer" });
    expect(s.room.clipPrint.clipPending).toBeNull();
  });

  it("§4.3: 10 sn içinde rapor yoksa sunucu TIMEOUT üretir (audit dahil); geç rapor yok sayılır", async () => {
    const s = setup();
    s.room.clipPrint.consent = true;
    handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(1), bytes: 10 });
    s.clock.advance(CLIP_PENDING_TIMEOUT_MS);
    await s.flush();
    expect(s.techPeer.of("clip.status").at(-1)).toMatchObject({ result: "TIMEOUT", bytes: 0 });
    expect(s.audits[0]).toMatchObject({ result: "fail", newValue: { result: "TIMEOUT", reportedBy: "server" } });
    handleClipReport(s.rooms, s.room, { cid: cid(1), dir: "TO_CUSTOMER", bytes: 10, result: "OK" });
    expect(s.techPeer.of("clip.status")).toHaveLength(1);
  });

  it("T5: kayan 60 sn'de 30 pano isteği; 31. RATE_LIMITED, pencere kayınca yeniden açılır", () => {
    const s = setup();
    s.room.clipPrint.consent = true;
    for (let i = 0; i < CLIP_PER_MIN; i++) {
      expect(handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(i) })).toBe(true);
      handleClipReport(s.rooms, s.room, { cid: cid(i), dir: "TO_TECH", bytes: 1, result: "OK" });
      s.clock.advance(100);
    }
    expect(handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(100) })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "RATE_LIMITED" });
    s.clock.advance(60_000);
    expect(handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(101) })).toBe(true);
  });

  it("O-P28a-1 m.3: iletilmiş kimlik yeniden kullanılırsa VALIDATION; son 64 dışına çıkan kimlik yeniden kabul", () => {
    const s = setup();
    s.room.clipPrint.consent = true;
    handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(0) });
    handleClipReport(s.rooms, s.room, { cid: cid(0), dir: "TO_TECH", bytes: 0, result: "EMPTY" });
    expect(handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(0) })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "VALIDATION" });
    // print kimliği de aynı pencerededir
    expect(handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(0), sizeBytes: 100 })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "VALIDATION" });
    for (let i = 1; i <= ID_REUSE_WINDOW; i++) s.room.clipPrint.usedIds.push(cid(1000 + i));
    s.room.clipPrint.usedIds.splice(0, s.room.clipPrint.usedIds.length - ID_REUSE_WINDOW);
    expect(handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(0) })).toBe(true);
    expect(s.room.clipPrint.usedIds).toHaveLength(ID_REUSE_WINDOW);
  });
});

describe("P28a clip.consent (§4.3, r2 O-P28a-5)", () => {
  it("AC-344: açma yalnız GRANTED iken; değilse misafire {on:false}, audit yok", async () => {
    const s = setup({ control: "VIEW" });
    handleClipConsent(s.rooms, s.room, s.guest, true);
    await s.flush();
    expect(s.room.clipPrint.consent).toBe(false);
    expect(s.guestPeer.of("clip.consent")).toEqual([{ t: "clip.consent", on: false }]);
    expect(s.audits).toHaveLength(0);
  });

  it("AC-344 (D-P28aK-2): oturum caps'inde clipboard yoksa açma reddedilir — misafire {on:false}, audit yok, metrik reason=permission", async () => {
    const s = setup({ perms: ["remote_control.use", "file_transfer.use", "file_transfer.print"] });
    handleClipConsent(s.rooms, s.room, s.guest, true);
    await s.flush();
    expect(s.room.clipPrint.consent).toBe(false);
    expect(s.guestPeer.of("clip.consent")).toEqual([{ t: "clip.consent", on: false }]);
    expect(s.techPeer.of("clip.consent")).toEqual([]);
    expect(s.audits).toHaveLength(0);
    expect(s.denied().join("\n")).toContain('kind="consent",reason="permission"');
  });

  it("AC-344 (D-P28aK-2): caps oturum içinde daraldıktan sonra yeniden açma reddedilir", async () => {
    const s = setup();
    handleClipConsent(s.rooms, s.room, s.guest, true);
    s.room.caps = s.room.caps.filter((c) => c !== "clipboard");
    onCapsNarrowed(s.rooms, s.room);
    handleClipConsent(s.rooms, s.room, s.guest, true);
    await s.flush();
    expect(s.room.clipPrint.consent).toBe(false);
    expect(s.guestPeer.of("clip.consent")).toEqual([
      { t: "clip.consent", on: false },
      { t: "clip.consent", on: false },
    ]);
    expect(s.audits.map((a) => a.newValue)).toEqual([
      { on: true, by: "customer" },
      { on: false, by: "system", reason: "permission" },
    ]);
  });

  it("AC-347: değişim audit clipboard.consent{on, by:customer} + teknisyene iletim; aynı değer no-op", async () => {
    const s = setup();
    handleClipConsent(s.rooms, s.room, s.guest, true);
    handleClipConsent(s.rooms, s.room, s.guest, true);
    await s.flush();
    expect(s.techPeer.of("clip.consent")).toEqual([{ t: "clip.consent", on: true }]);
    expect(s.audits).toHaveLength(1);
    expect(s.audits[0]).toMatchObject({ action: "clipboard.consent", username: "customer", newValue: { on: true, by: "customer" } });
  });

  it("AC-347 (O-P28a-5): 1 dk içinde 7 değişim → 6 audit, 7. misafire {on:false} + metrik reason=rate", async () => {
    const s = setup();
    for (let i = 0; i < CLIP_CONSENT_PER_MIN + 1; i++) {
      handleClipConsent(s.rooms, s.room, s.guest, i % 2 === 0);
      s.clock.advance(1000);
    }
    await s.flush();
    expect(s.audits.filter((a) => a.action === "clipboard.consent")).toHaveLength(CLIP_CONSENT_PER_MIN);
    expect(s.room.clipPrint.consent).toBe(false);
    expect(s.guestPeer.of("clip.consent").at(-1)).toEqual({ t: "clip.consent", on: false });
    expect(s.denied().join("\n")).toContain('kind="consent",reason="rate"');
    s.clock.advance(60_000);
    handleClipConsent(s.rooms, s.room, s.guest, true);
    expect(s.room.clipPrint.consent).toBe(true);
  });
});

describe("P28a yazdırma kapısı (§4.3 print.request, r2 Y-P28a-1)", () => {
  it("AC-348: VIEW iken print.request FORBIDDEN, misafire print mesajı 0", () => {
    const s = setup({ control: "VIEW" });
    expect(handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(1), sizeBytes: 100 })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "FORBIDDEN", message: "Önce uzaktan kontrol izni alın." });
    expect(s.guestPeer.sent.filter((m) => m.t.startsWith("print."))).toHaveLength(0);
  });

  it("AC-348/AC-352: yetki yok / özellik yok / tarayıcı → FORBIDDEN; file_transfer.use gerekmez (K-P28a-13)", () => {
    const np = setup({ perms: ["remote_control.use", "file_transfer.use"] });
    expect(handlePrintRequest(np.rooms, np.room, np.tech, { pid: cid(1), sizeBytes: 100 })).toBe(false);
    const nf = setup({ features: ["clipboard"] });
    expect(handlePrintRequest(nf.rooms, nf.room, nf.tech, { pid: cid(1), sizeBytes: 100 })).toBe(false);
    const br = setup({ kind: "BROWSER" });
    expect(handlePrintRequest(br.rooms, br.room, br.tech, { pid: cid(1), sizeBytes: 100 })).toBe(false);
    for (const x of [np, nf, br]) expect(lastError(x.techPeer)).toMatchObject({ code: "FORBIDDEN" });
    const only = setup({ perms: ["remote_control.use", "file_transfer.print"] });
    expect(handlePrintRequest(only.rooms, only.room, only.tech, { pid: cid(1), sizeBytes: 100 })).toBe(true);
  });

  it("AC-351: rapor → audit print.job (karar, sayfa, boyut, sonuç; ad/hash yok); bekleyen varken CONFLICT", async () => {
    const s = setup();
    expect(handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(1), sizeBytes: 1234 })).toBe(true);
    expect(s.guestPeer.of("print.request")).toEqual([{ t: "print.request", pid: cid(1), sizeBytes: 1234 }]);
    expect(handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(2), sizeBytes: 5 })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "CONFLICT" });
    handlePrintReport(s.rooms, s.room, { pid: cid(1), decision: "APPROVED", result: "PRINTED", pages: 3 });
    await s.flush();
    expect(s.techPeer.of("print.status")).toEqual([{ t: "print.status", pid: cid(1), result: "PRINTED", pages: 3 }]);
    expect(s.audits[0]).toMatchObject({ action: "print.job", result: "success" });
    expect(s.audits[0]?.newValue).toEqual({ decision: "APPROVED", pages: 3, sizeBytes: 1234, result: "PRINTED", reportedBy: "customer" });
  });

  it("T5: ret/yanıtsızlık sonrası 30 sn bekleme; oturum başına 20 istek, 21. RATE_LIMITED", () => {
    const s = setup();
    handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(1), sizeBytes: 10 });
    handlePrintReport(s.rooms, s.room, { pid: cid(1), decision: "REJECTED", result: "REJECTED" });
    expect(handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(2), sizeBytes: 10 })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "RATE_LIMITED" });
    s.clock.advance(PRINT_DENY_COOLDOWN_MS);
    for (let i = 2; i <= PRINT_PER_SESSION; i++) {
      expect(handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(i), sizeBytes: 10 })).toBe(true);
      handlePrintReport(s.rooms, s.room, { pid: cid(i), decision: "APPROVED", result: "PRINTED", pages: 1 });
    }
    expect(handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(99), sizeBytes: 10 })).toBe(false);
    expect(lastError(s.techPeer)).toMatchObject({ code: "RATE_LIMITED", message: "Bu oturumda yazdırma sınırına ulaşıldı." });
  });

  it("§4.3: 10 dk rapor yoksa ABANDONED (audit); print.cancel yalnız bekleyen pid'e iletilir", async () => {
    const s = setup();
    handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(1), sizeBytes: 10 });
    handlePrintCancel(s.rooms, s.room, s.tech, cid(7));
    expect(s.guestPeer.of("print.cancel")).toHaveLength(0);
    handlePrintCancel(s.rooms, s.room, s.tech, cid(1));
    expect(s.guestPeer.of("print.cancel")).toEqual([{ t: "print.cancel", pid: cid(1) }]);
    s.clock.advance(PRINT_PENDING_TIMEOUT_MS);
    await s.flush();
    expect(s.techPeer.of("print.status").at(-1)).toMatchObject({ result: "ABANDONED" });
    expect(s.audits[0]?.newValue).toMatchObject({ decision: "NONE", result: "ABANDONED", reportedBy: "server" });
  });
});

describe("P28a yaşam döngüsü kancaları", () => {
  it("AC-348 (Y-P28a-1): kontrol VIEW'a dönünce bekleyen yazdırma iptal — print.cancel + CANCELLED audit; geç rapor yok sayılır", async () => {
    const s = setup();
    handleClipConsent(s.rooms, s.room, s.guest, true);
    handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(1), sizeBytes: 10 });
    s.room.control.state = "VIEW";
    onControlClosed(s.rooms, s.room);
    await s.flush();
    expect(s.guestPeer.of("print.cancel")).toEqual([{ t: "print.cancel", pid: cid(1) }]);
    expect(s.guestPeer.of("clip.consent")).toEqual([{ t: "clip.consent", on: false }]);
    expect(s.techPeer.of("print.status")).toEqual([{ t: "print.status", pid: cid(1), result: "CANCELLED" }]);
    const job = s.audits.find((a) => a.action === "print.job");
    expect(job?.newValue).toMatchObject({ result: "CANCELLED", reportedBy: "server" });
    const consent = s.audits.filter((a) => a.action === "clipboard.consent").at(-1);
    expect(consent?.newValue).toEqual({ on: false, by: "system", reason: "control_closed" });
    handlePrintReport(s.rooms, s.room, { pid: cid(1), decision: "APPROVED", result: "PRINTED", pages: 1 });
    expect(s.techPeer.of("print.status")).toHaveLength(1);
  });

  it("AC-344: misafir kopunca izin kapanır (reason disconnect), bekleyen işler DISCONNECTED", async () => {
    const s = setup();
    handleClipConsent(s.rooms, s.room, s.guest, true);
    handleClipRequest(s.rooms, s.room, s.tech, { cid: cid(1) });
    onGuestGone(s.rooms, s.room, "disconnect");
    await s.flush();
    expect(s.techPeer.of("clip.status").at(-1)).toMatchObject({ result: "DISCONNECTED" });
    expect(s.room.clipPrint.consent).toBe(false);
    expect(s.audits.find((a) => a.newValue.reason === "disconnect")).toBeDefined();
  });

  it("G-09: clipboard yetkisi düşünce izin kapanır (reason permission); print düşünce bekleyen yazdırma iptal", async () => {
    const s = setup();
    handleClipConsent(s.rooms, s.room, s.guest, true);
    handlePrintRequest(s.rooms, s.room, s.tech, { pid: cid(1), sizeBytes: 10 });
    s.room.caps = ["remote_control", "file_transfer"];
    onCapsNarrowed(s.rooms, s.room);
    await s.flush();
    expect(s.room.clipPrint.consent).toBe(false);
    expect(s.room.clipPrint.printPending).toBeNull();
    expect(s.audits.find((a) => a.newValue.reason === "permission")).toBeDefined();
  });
});
