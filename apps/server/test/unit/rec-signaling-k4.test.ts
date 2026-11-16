// P28e K4 sinyal kapıları birim testleri (mimari-p28e r2 §5.3, §6.1–§6.5; AC-381, 382, 384, 388, 448; S-P28e-1, 2, 10).
// Ağsız: sahte Peer + sahte saat + sahte RecService (K3 servisi yerine; arayüz rec/types.ts). DB yolu K3/K4 entegrasyonunda.
import type { ServerOutbound } from "@remote/contracts/ws";
import {
  REC_CONSENT_LINE_SHA256,
  REC_CONSENT_WINDOW_MS,
  REC_RECORDER_RETURN_MS,
  REC_STOP_GRACE_MS,
  REC_WATCHDOG_MS,
  deviceRecStateSchema,
  recHelloGuestSchema,
  recHelloTechSchema,
  recStateGuestSchema,
  recStateTechSchema,
} from "@remote/contracts/ws-rec";
import type { DeviceRecordOutbound } from "@remote/contracts/ws-device";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import type { RecService, RecStartResult, RecStopInput } from "../../src/rec/types.ts";
import { onGuestMessage, TokenBucket } from "../../src/signaling/handlers.ts";
import { bindRec, handleRecConsent, handleRecError, handleRecRevoke, recPolicyAdmitted } from "../../src/signaling/rec.ts";
import { Rooms } from "../../src/signaling/rooms.ts";
import type { Clock, Guest, Peer, Room, TechConn } from "../../src/signaling/types.ts";

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

type Sent = Peer & { sent: ServerOutbound[]; closed: number[]; recs(): Extract<ServerOutbound, { t: "rec.state" }>[] };
function peer(rec: boolean): Sent {
  const p: Sent = {
    sent: [],
    closed: [],
    send: (m) => void p.sent.push(m),
    close: (code) => void p.closed.push(code),
    isOpen: () => true,
    recs: () => p.sent.filter((m): m is Extract<ServerOutbound, { t: "rec.state" }> => m.t === "rec.state"),
    ...(rec ? { rec: true } : {}),
  };
  return p;
}

const RID = "01JREC0000000000000000000A";
const TOKEN = "u".repeat(43);

function fakeSvc(start: RecStartResult = { ok: true, rid: RID, startedAt: new Date(0), basis: "consent" }) {
  const calls = { start: 0, stops: [] as RecStopInput[], fails: [] as { reason: string; code?: string }[], drops: [] as unknown[] };
  let active = false;
  const svc: RecService = {
    startConsent: async () => {
      calls.start++;
      if (start.ok) active = true;
      return start;
    },
    startPolicy: async () => start,
    auditStartFail: async (i) => void calls.fails.push({ reason: i.reason, ...(i.code ? { code: i.code } : {}) }),
    stop: async (i) => {
      calls.stops.push(i);
      const changed = active;
      active = false;
      return { changed, durationMs: 0, sizeBytes: 0, stoppedAt: new Date(2_000_000) };
    },
    issueUploadToken: () => TOKEN,
    dropUploadTokens: (s) => void calls.drops.push(s),
    canOffer: async () => true,
    sweepOrphans: async () => 0,
  };
  return { svc, calls };
}

function setup(o: { techRec?: boolean; guestRec?: boolean; unattended?: boolean; start?: RecStartResult } = {}) {
  const clock = new Clk();
  const db = { auditLog: { create: () => Promise.resolve() } } as unknown as Db;
  const metrics = createMetrics();
  const rooms = new Rooms({ db, log: pino({ level: "silent" }), turn: { urls: [], secret: "", ttlMin: 60 }, metrics, clock });
  const device: DeviceRecordOutbound[] = [];
  rooms.devices = {
    revoked: () => undefined,
    has: () => true,
    sendRecord: (_id, m) => (device.push(m), true),
  };
  const { svc, calls } = fakeSvc(o.start);
  const port = bindRec(rooms, svc);
  const room: Room = rooms.getOrCreate({
    id: "01JSESSION0000000000000000",
    tenantId: "t1",
    technicianId: "01JTECH00000000000000000000",
    technician: { fullName: "Tek" },
    expiresAt: new Date(clock.t + 3_600_000),
  });
  const techPeer = peer(o.techRec ?? true);
  const tech: TechConn = {
    peer: techPeer,
    userId: room.technicianId,
    username: "tech@example.test",
    authToken: "x",
    permissions: new Set(),
    role: "USER",
    ctx: { ip: "10.0.0.1", userAgent: "test", requestId: "r" },
    authSessionId: "01JAUTH0000000000000000000",
    connId: "c1",
  };
  const guestPeer = peer(o.guestRec ?? true);
  const guest = {
    id: "g",
    name: "Ayşe",
    kind: "AGENT",
    state: "ADMITTED",
    peer: guestPeer,
    ctx: { ip: "203.0.113.7", userAgent: "agent", requestId: "q" },
  } as unknown as Guest;
  room.tech = tech;
  room.admitted = guest;
  room.share = { state: "sharing" };
  if (o.unattended)
    room.unattended = {
      deviceId: "d1",
      deviceName: "PC",
      customerId: "c",
      consentRequest: "silent",
      consentMode: "silent",
      recording: true,
    };
  room.recGate = { firstAdmitHelloAt: clock.t };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { clock, rooms, room, tech, techPeer, guest, guestPeer, svc, calls, port, device, metrics, flush };
}

const consent = (s: ReturnType<typeof setup>, sha = REC_CONSENT_LINE_SHA256) =>
  handleRecConsent(s.rooms, s.room, s.guest, s.guestPeer, sha);

describe("P28e K4 rec.consent kapısı (§6.2)", () => {
  it("AC-381 geçerli rıza → kayıt açılır; teknisyene rid+basis+upload, rec1 misafire yalnız {on}", async () => {
    const s = setup();
    await consent(s);
    expect(s.calls.start).toBe(1);
    const t = s.techPeer.recs().at(-1);
    expect(recStateTechSchema.parse(t)).toEqual({
      t: "rec.state",
      on: true,
      rid: RID,
      basis: "consent",
      upload: { token: TOKEN, series: 0, nextPart: 0 },
    });
    expect(recStateGuestSchema.parse(s.guestPeer.recs().at(-1))).toEqual({ t: "rec.state", on: true });
    expect(s.room.rec).toMatchObject({ rid: RID, state: "active", recorderConnId: "c1" });
  });

  it("AC-388 / S-P28e-10 SHA uyuşmazlığı → kayıt yok + consent_rejected{sha} oturum başına bir kez", async () => {
    const s = setup();
    await consent(s, "0".repeat(64));
    await consent(s, "1".repeat(64));
    expect(s.calls.start).toBe(0);
    expect(s.calls.fails).toEqual([{ reason: "consent_rejected", code: "sha" }]);
  });

  it("AC-381 30 sn penceresi aşıldı → consent_rejected{window}, kayıt yok", async () => {
    const s = setup();
    s.clock.advance(REC_CONSENT_WINDOW_MS + 1);
    await consent(s);
    expect(s.calls.start).toBe(0);
    expect(s.calls.fails).toEqual([{ reason: "consent_rejected", code: "window" }]);
  });

  it("AC-381 ikinci rıza ve gözetimsiz oda yok sayılır", async () => {
    const s = setup();
    await consent(s);
    await consent(s);
    expect(s.calls.start).toBe(1);
    const u = setup({ unattended: true });
    await consent(u);
    expect(u.calls.start).toBe(0);
  });

  it("K-P28e-9 konsol rec1 bildirmedi → unsupported fail, misafire off{unavailable}", async () => {
    const s = setup({ techRec: false });
    await consent(s);
    expect(s.calls.start).toBe(0);
    expect(s.calls.fails).toEqual([{ reason: "unsupported" }]);
    expect(s.guestPeer.recs()).toEqual([{ t: "rec.state", on: false, reason: "unavailable" }]);
  });

  it("AC-384 ayar kapalı / kota → misafire off{unavailable|quota}, oda belleği kurulmaz", async () => {
    const s = setup({ start: { ok: false, reason: "quota" } });
    await consent(s);
    expect(s.guestPeer.recs()).toEqual([{ t: "rec.state", on: false, reason: "quota" }]);
    expect(s.room.rec).toBeUndefined();
  });

  it("§6.1 rec1 bildirmeyen misafir sokette rec.consent şema dışı → 1008", async () => {
    const s = setup({ guestRec: false });
    const data = Buffer.from(JSON.stringify({ t: "rec.consent", lineSha256: REC_CONSENT_LINE_SHA256 }));
    await onGuestMessage(s.rooms, s.room, s.guest, s.guestPeer, new TokenBucket(s.clock), data, false);
    expect(s.guestPeer.closed).toEqual([1008]);
    expect(s.calls.start).toBe(0);
  });
});

describe("P28e K4 durdurma, payı ve yayın (§5.3, §6.2–§6.5)", () => {
  it("AC-382 rec.revoke → stop{revoked}, herkese off{revoked}; ikinci revoke ve sonraki rıza yok sayılır; durma payı belleği", async () => {
    const s = setup();
    await consent(s);
    s.port.partAccepted(s.room.sessionId, 0, 2, s.clock.t);
    await handleRecRevoke(s.rooms, s.room, s.guest);
    await handleRecRevoke(s.rooms, s.room, s.guest);
    await consent(s);
    expect(s.calls.stops.map((x) => x.reason)).toEqual(["revoked"]);
    expect(s.calls.start).toBe(1);
    expect(s.techPeer.recs().at(-1)).toEqual({ t: "rec.state", on: false, reason: "revoked" });
    expect(s.guestPeer.recs().at(-1)).toEqual({ t: "rec.state", on: false, reason: "revoked" });
    expect(s.room.rec).toMatchObject({ state: "stopped", stopSeries: 0, stopNext: 3, stoppedAt: 2_000_000 });
  });

  it("AC-388 rec.error yalnız kaydediciden → stop{error, code}", async () => {
    const s = setup();
    await consent(s);
    const other = { ...s.tech, peer: peer(true), connId: "c2" };
    await handleRecError(s.rooms, s.room, other, "recorder_failed");
    expect(s.calls.stops).toEqual([]);
    await handleRecError(s.rooms, s.room, s.tech, "recorder_failed");
    expect(s.calls.stops.map((x) => [x.reason, x.code])).toEqual([["error", "recorder_failed"]]);
  });

  it("AC-388 / S-P28e-4 politika kapatma (servis portu) → teknisyen, rec1 misafir ve record1 cihaza off{policy_off}; idempotent", async () => {
    const s = setup({ unattended: true });
    recPolicyAdmitted(s.rooms, s.room, RID);
    expect(s.device).toEqual([{ t: "rec.state", on: true }]);
    s.port.stopped(s.room.sessionId, "policy_off", s.clock.t);
    s.port.stopped(s.room.sessionId, "policy_off", s.clock.t);
    expect(s.techPeer.recs().filter((m) => !m.on)).toEqual([{ t: "rec.state", on: false, reason: "policy_off" }]);
    expect(s.device.map((m) => deviceRecStateSchema.parse(m))).toEqual([
      { t: "rec.state", on: true },
      { t: "rec.state", on: false },
    ]);
    // gözetimsiz odada misafir (yardımcı) /ws/guest'e rec.state gitmez
    expect(s.guestPeer.recs()).toEqual([]);
  });

  it("AC-448 politika kaydı açılamadı (rid yok) → cihaz göstergesi kalkar", () => {
    const s = setup({ unattended: true });
    recPolicyAdmitted(s.rooms, s.room, null);
    expect(s.device).toEqual([{ t: "rec.state", on: false }]);
    expect(s.room.rec).toBeUndefined();
  });

  it("§6.4 oda kapanışı → stop{session_end}; port 15 sn son parça payı boyunca belleği görür, sonra görmez", async () => {
    const s = setup();
    await consent(s);
    s.rooms.closeSession(s.room.sessionId, "tech");
    await s.flush();
    expect(s.calls.stops.map((x) => x.reason)).toEqual(["session_end"]);
    expect(s.port.get(s.room.sessionId)).toMatchObject({ state: "stopped", stopSeries: 0 });
    expect(s.calls.drops).toContainEqual({ by: "session", sessionId: s.room.sessionId, graceMs: REC_STOP_GRACE_MS });
    s.clock.advance(REC_STOP_GRACE_MS);
    expect(s.port.get(s.room.sessionId)).toBeUndefined();
  });
});

describe("P28e K4 kaynak eş, gözcü, kaydedici dönüşü, hello (§5.3, §6.3)", () => {
  it("D-P28e-K1-1 kaynak eş yokken kabul edilen parça sourceGone.next'i ilerletmez (yalnız yoldaki tek parça)", async () => {
    const s = setup();
    await consent(s);
    s.port.partAccepted(s.room.sessionId, 0, 4, s.clock.t);
    s.rooms.detachGuest(s.room, s.guest, s.guestPeer);
    const at = s.clock.t;
    s.clock.advance(1000);
    s.port.partAccepted(s.room.sessionId, 0, 5, s.clock.t);
    expect(s.room.rec?.sourceGone).toEqual({ at, series: 0, next: 5 });
    expect(s.room.rec?.nextPart).toBe(6);
  });
  it("S-P28e-2 misafir ayrılınca sourceGone; dönünce hello temizler ve rec1 sokete hello.rec HER ZAMAN gider (açık/durmuş)", async () => {
    const s = setup();
    await consent(s);
    s.port.partAccepted(s.room.sessionId, 0, 4, s.clock.t);
    s.rooms.detachGuest(s.room, s.guest, s.guestPeer);
    expect(s.room.rec?.sourceGone).toEqual({ at: s.clock.t, series: 0, next: 5 });
    const back = peer(true);
    s.rooms.reattachGuest(s.room, back);
    expect(s.room.rec?.sourceGone).toBeUndefined();
    const hello = back.sent.find((m) => m.t === "hello");
    expect(recHelloGuestSchema.parse((hello as { rec?: unknown }).rec)).toEqual({ on: true });
    await handleRecRevoke(s.rooms, s.room, s.guest);
    const again = peer(true);
    s.rooms.reattachGuest(s.room, again);
    expect((again.sent.find((m) => m.t === "hello") as { rec?: unknown }).rec).toEqual({ on: false, reason: "revoked" });
    const old = peer(false);
    s.rooms.reattachGuest(s.room, old);
    expect((old.sent.find((m) => m.t === "hello") as { rec?: unknown }).rec).toBeUndefined();
  });

  it("K-P28e-8 gözcü: paylaşım sürerken 30 sn parça yok → stop{error, no_upload}; kaynak yokken saymaz", async () => {
    const s = setup();
    await consent(s);
    s.rooms.detachGuest(s.room, s.guest, s.guestPeer);
    s.clock.advance(REC_WATCHDOG_MS * 3);
    await s.flush();
    expect(s.calls.stops).toEqual([]);
    s.rooms.reattachGuest(s.room, peer(true));
    s.room.share = { state: "sharing" };
    s.clock.advance(REC_WATCHDOG_MS - 1);
    await s.flush();
    expect(s.calls.stops).toEqual([]);
    s.clock.advance(REC_WATCHDOG_MS + 1);
    await s.flush();
    expect(s.calls.stops.map((x) => [x.reason, x.code])).toEqual([["error", "no_upload"]]);
  });

  it("§6.3 kaydedici ayrıldı: belirteç pay sonrası düşer; 120 sn dönmezse stop{error, no_upload}; dönerse yeni bölüm + belirteç", async () => {
    const s = setup();
    await consent(s);
    s.port.partAccepted(s.room.sessionId, 0, 9, s.clock.t);
    s.rooms.detachTech(s.room, s.techPeer);
    expect(s.calls.drops).toContainEqual({ by: "conn", connId: "c1", graceMs: REC_STOP_GRACE_MS });
    s.clock.advance(REC_RECORDER_RETURN_MS - 1000);
    const np = peer(true);
    s.rooms.attachTech(
      {
        id: s.room.sessionId,
        tenantId: "t1",
        technicianId: s.tech.userId,
        technician: { fullName: "Tek" },
        expiresAt: new Date(s.clock.t + 1e6),
      },
      { ...s.tech, peer: np, connId: "c3" },
    );
    const hello = np.sent.find((m) => m.t === "hello") as { rec?: unknown };
    expect(recHelloTechSchema.parse(hello.rec)).toEqual({
      on: true,
      rid: RID,
      basis: "consent",
      upload: { token: TOKEN, series: 1, nextPart: 0 },
    });
    s.clock.advance(5000);
    await s.flush();
    expect(s.calls.stops).toEqual([]);

    const t = setup();
    await consent(t);
    t.rooms.detachTech(t.room, t.techPeer);
    t.clock.advance(REC_RECORDER_RETURN_MS);
    await t.flush();
    expect(t.calls.stops.map((x) => [x.reason, x.code])).toEqual([["error", "no_upload"]]);
  });

  it("§11.2 metrik kayıtları /metrics çıktısında (rs_rec_active göstergesi dahil)", async () => {
    const s = setup();
    await consent(s);
    s.metrics.inc("rs_rec_part_total", { result: "ok" });
    s.metrics.observe("rs_rec_part_bytes", 100_000);
    const out = s.metrics.render();
    for (const n of ["rs_rec_part_total", "rs_rec_stop_total", "rs_rec_bytes_total", "rs_rec_view_throttled_total"])
      expect(out).toContain(`# TYPE ${n} counter`);
    expect(out).toContain('rs_rec_part_total{result="ok"} 1');
    expect(out).toContain('rs_rec_part_bytes_bucket{le="262144"} 1');
    expect(out).toContain("rs_rec_part_bytes_count 1");
    expect(out).toContain("rs_rec_active 1");
  });
});
