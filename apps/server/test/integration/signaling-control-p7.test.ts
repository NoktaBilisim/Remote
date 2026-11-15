// P7 uzaktan kontrol sunucu tarafı (gerçek MySQL). Oda katmanı sahte Peer + sahte saat; S-P3-8 uçtan uca gerçek WS.
// mimari-protokol §3 (control.*, monitor.request, env.state, caps.update), akış A3/A4/A5; AC-24, 34, 43, 47, 50, 51, 99,
// 105, 111, 115, 116; G-03, G-04, G-15; S-P3-8.
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import { CONTROL_DENY_COOLDOWN_MS } from "@remote/contracts/ws";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { admitGuest } from "../../src/signaling/admit.ts";
import {
  CONTROL_AUDIT_TIMEOUT_MS,
  handleControlClose,
  handleControlRequest,
  handleControlState,
  handleEnvState,
  handleMonitorDenied,
  handleMonitorRequest,
  onShareMonitor,
} from "../../src/signaling/control.ts";
import { Rooms } from "../../src/signaling/rooms.ts";
import { ORIGIN, testDb } from "../helpers/app.ts";
import { startLive, TECH_PERMS, techSession, type Live, type TechSide } from "../helpers/signal-flow.ts";
import { connect, FakeClock, fakePeer, makeRooms, roomFixture, silentLog, TURN, type WsClient } from "../helpers/ws.ts";

const ALL = ["sessions.create", "remote_control.use", "file_transfer.use"] as const;
const consents = (sessionId: string) =>
  testDb().sessionConsent.findMany({ where: { sessionId, level: "CONTROL" }, orderBy: { createdAt: "asc" } });
const audits = (sessionId: string, action: string) => testDb().auditLog.findMany({ where: { entityId: sessionId, action } });

/** AGENT misafirli ACTIVE oda (sahte Peer). */
async function agentRoom(rooms: Rooms, perms: readonly (typeof ALL)[number][] = ALL, kind: "AGENT" | "BROWSER" = "AGENT") {
  const fx = await roomFixture(rooms, [...perms]);
  const g = fx.guest("203.0.113.7", kind);
  expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
  return { ...fx, g };
}

type FailMode = { fail: "none" | "error" | "hang" | "audit" };
/** $transaction'ı (error/hang) veya TX dışı audit yazımını (audit) isteğe bağlı bozan DB (fail-closed testleri). */
function flakyDb(mode: FailMode): Db {
  const db = testDb();
  return new Proxy(db, {
    get(target, key, recv) {
      if (key === "auditLog" && mode.fail === "audit") return { create: () => Promise.reject(new Error("db down")) };
      if (key === "$transaction" && (mode.fail === "error" || mode.fail === "hang")) {
        return () => (mode.fail === "error" ? Promise.reject(new Error("db down")) : new Promise(() => undefined));
      }
      const v: unknown = Reflect.get(target, key, recv);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

describe("P7 control.request sınırları", () => {
  it("AC-51: remote_control.use yoksa FORBIDDEN, misafire iletilmez", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, ["sessions.create", "file_transfer.use"]);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forbidden");
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "FORBIDDEN" });
    expect(fx.g.peer.of("control.request")).toHaveLength(0);
  });

  it("AC-34: tarayıcı misafirine kontrol isteği FORBIDDEN; control.state/env.state yok sayılır", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, ALL, "BROWSER");
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("browser");
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "FORBIDDEN", message: "Müşteri tarayıcı modunda: yalnız görüntüleme." });
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    handleEnvState(rooms, fx.room, fx.g.entry, { elevatedForeground: true, secureDesktop: false, selfElevated: true });
    expect(fx.room.guestEnv).toBeUndefined();
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
    expect(fx.techPeer.of("env.state")).toHaveLength(0);
    expect(await consents(fx.session.id)).toHaveLength(0);
  });

  it("AC-47/AC-99/AC-116: istek iletilir; ret → DENIED kaydı + teknisyene bildirim; 30 sn içinde yeni istek RATE_LIMITED", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await agentRoom(rooms);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    expect(fx.g.peer.of("control.request")).toHaveLength(1);
    expect(fx.room.control.state).toBe("REQUESTED");
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "DENIED" });
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source: "DENIED" });
    // tekrar eden ret kayıt şişirmez
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "DENIED" });
    const rows = await consents(fx.session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: "DENIED", source: "UI", consentTextId: null });
    expect(await audits(fx.session.id, CONTROL_AUDIT.DENIED)).toHaveLength(1);
    expect(await audits(fx.session.id, CONTROL_AUDIT.REQUESTED)).toHaveLength(1);

    clock.advance(CONTROL_DENY_COOLDOWN_MS - 1);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("cooldown");
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "RATE_LIMITED" });
    expect(fx.g.peer.of("control.request")).toHaveLength(1);
    clock.advance(1);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
  });

  it("AC-116 (G-03): oturum başına en çok 5 istek iletilir (iptal sayaçtan düşmez); 6. RATE_LIMITED", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    for (let i = 0; i < 5; i++) {
      expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
      await handleControlClose(rooms, fx.room, fx.tech, "cancel");
    }
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("limit");
    expect(fx.g.peer.of("control.request")).toHaveLength(5);
  });

  it("§3.3: bekleyen istek varken ikinci control.request CONFLICT, iletilmez ve sayaçtan düşmez", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("conflict");
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "CONFLICT" });
    expect(fx.g.peer.of("control.request")).toHaveLength(1);
    expect(fx.room.control.requests).toBe(1);
  });

  it("QA-P7-5: control.requested audit'i müşteriye iletimden önce yazılır", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    let rowsAtSend = -1;
    const send = fx.g.peer.send;
    fx.g.peer.send = (m) => {
      if (m.t === "control.request") void audits(fx.session.id, CONTROL_AUDIT.REQUESTED).then((r) => (rowsAtSend = r.length));
      send(m);
    };
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    await expect.poll(() => rowsAtSend).toBe(1);
  });

  it("QA-P7-5: istek audit'i yazılamazsa log + metrik, istek yine iletilir (açma yönü değil)", async () => {
    const metrics = createMetrics();
    const mode: FailMode = { fail: "none" };
    const rooms = new Rooms({ db: flakyDb(mode), log: silentLog, turn: TURN, metrics, clock: new FakeClock() });
    const fx = await agentRoom(rooms);
    mode.fail = "audit";
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    expect(fx.g.peer.of("control.request")).toHaveLength(1);
    expect(metrics.render()).toMatch(/rs_control_total\{event="control_request_audit_failed"\} 1/);
  });
});

describe("P7 control.state kayıt zaman çizelgesi", () => {
  it("AC-111/AC-50: GRANTED → consent + audit sonra teknisyene; HOTKEY ile kapanış REVOKED/HOTKEY", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.room.control.state).toBe("GRANTED");
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "GRANTED", source: "UI" });
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("conflict");

    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "HOTKEY" });
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source: "HOTKEY" });
    const rows = await consents(fx.session.id);
    expect(rows.map((r) => [r.decision, r.source])).toEqual([
      ["GRANTED", "UI"],
      ["REVOKED", "HOTKEY"],
    ]);
    expect(rows[0]?.ip).toBe(fx.consent.ip);
    expect(await audits(fx.session.id, CONTROL_AUDIT.GRANTED)).toHaveLength(1);
    const revoked = await audits(fx.session.id, CONTROL_AUDIT.REVOKED);
    expect(revoked[0]).toMatchObject({ username: "customer", result: "success", newValue: { decision: "REVOKED", source: "HOTKEY" } });
  });

  it("AC-111 (G-15): GRANTED kaydı yazılamazsa control.revoke{audit} + teknisyene INTERNAL; kontrol açılmaz", async () => {
    const mode: FailMode = { fail: "none" };
    const rooms = new Rooms({ db: flakyDb(mode), log: silentLog, turn: TURN, metrics: createMetrics(), clock: new FakeClock() });
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    mode.fail = "error";
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.g.peer.of("control.revoke")).toEqual([{ t: "control.revoke", reason: "audit" }]);
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "INTERNAL" });
    expect(fx.techPeer.of("error").at(-1)?.message).toMatch(/ref: [0-9A-Z]{26}/);
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
    expect(fx.room.control.state).toBe("VIEW");
    expect(await consents(fx.session.id)).toHaveLength(0);
  });

  it("AC-111: GRANTED kaydı 1 sn içinde bitmezse (asılı DB) kontrol geri alınır", async () => {
    const mode: FailMode = { fail: "none" };
    const clock = new FakeClock();
    const rooms = new Rooms({ db: flakyDb(mode), log: silentLog, turn: TURN, metrics: createMetrics(), clock });
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    mode.fail = "hang";
    const p = handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    await Promise.resolve();
    expect(CONTROL_AUDIT_TIMEOUT_MS).toBeLessThan(1000);
    clock.advance(CONTROL_AUDIT_TIMEOUT_MS);
    await p;
    expect(fx.g.peer.of("control.revoke")).toEqual([{ t: "control.revoke", reason: "audit" }]);
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
  });

  it("AC-24: misafir koparsa kontrol VIEW + REVOKED/RECONNECT; yeniden bağlanınca yalnız görüntüleme", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    rooms.detachGuest(fx.room, fx.g.entry, fx.g.peer);
    await fx.room.control.chain;
    expect(fx.room.control.state).toBe("VIEW");
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source: "RECONNECT" });
    expect((await consents(fx.session.id)).map((r) => [r.decision, r.source])).toEqual([
      ["GRANTED", "UI"],
      ["REVOKED", "RECONNECT"],
    ]);
    const { fakePeer } = await import("../helpers/ws.ts");
    const again = fakePeer();
    rooms.reattachGuest(fx.room, again);
    expect(again.of("hello")[0]?.caps).toEqual(["remote_control", "file_transfer"]);
    expect(fx.room.control.state).toBe("VIEW");
  });
});

describe("P7 monitor.request ve env.state", () => {
  it("AC-43 (G-03): yalnız AGENT; tek bekleyen istek (ikincisi CONFLICT); share.state ile karşılanınca monitor.granted + yeni istek iletilir", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    fx.room.share = {
      state: "sharing",
      monitors: [
        { id: 0, name: "A", w: 1920, h: 1080, primary: true },
        { id: 1, name: "B", w: 1280, h: 1024, primary: false },
        { id: 2, name: "C", w: 1280, h: 1024, primary: false },
      ],
      activeMonitor: 0,
    };
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 7)).toBe("invalid_monitor");
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 0)).toBe("already_active"); // S7-15: etkin monitör → VALIDATION, sayaç düşmez
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "VALIDATION" });
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 1)).toBe("forwarded");
    expect(fx.g.peer.of("monitor.request")).toEqual([{ t: "monitor.request", monitorId: 1 }]);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 2)).toBe("conflict");
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "CONFLICT" });
    await onShareMonitor(rooms, fx.room, fx.g.entry, 0); // başka monitör: karşılanmadı
    expect(fx.room.control.monitorPending?.id).toBe(1);
    await onShareMonitor(rooms, fx.room, fx.g.entry, 1);
    fx.room.share.activeMonitor = 1; // handlers share.state ile aynı
    expect(fx.room.control.monitorPending).toBeUndefined();
    expect(await audits(fx.session.id, CONTROL_AUDIT.MONITOR_GRANTED)).toMatchObject([
      { username: "customer", newValue: { monitorId: "1" } },
    ]);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 0)).toBe("forwarded");
    expect(await audits(fx.session.id, CONTROL_AUDIT.MONITOR_REQUESTED)).toHaveLength(2);

    const b = await agentRoom(makeRooms(), ALL, "BROWSER");
    expect(await handleMonitorRequest(makeRooms(), b.room, b.tech, 0)).toBe("browser");
  });

  it("AC-105/K8: env.state AGENT'tan teknisyene alanları yeniden kurularak iletilir; son değer odada, misafir kopunca temizlenir", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    handleEnvState(rooms, fx.room, fx.g.entry, { elevatedForeground: true, secureDesktop: false, selfElevated: true });
    expect(fx.techPeer.of("env.state")).toEqual([{ t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: true }]);
    expect(fx.room.guestEnv).toEqual({ elevatedForeground: true, secureDesktop: false, selfElevated: true });
    rooms.detachGuest(fx.room, fx.g.entry, fx.g.peer);
    expect(fx.room.guestEnv).toBeUndefined();
  });

  it('S7-9/K8: GRANTED audit\'inde selfElevated — env.state gelmediyse "unknown", geldiyse son değer', async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    await handleControlClose(rooms, fx.room, fx.tech, "release");
    handleEnvState(rooms, fx.room, fx.g.entry, { elevatedForeground: false, secureDesktop: false, selfElevated: true });
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    await fx.room.control.chain;
    const granted = await testDb().auditLog.findMany({
      where: { entityId: fx.session.id, action: CONTROL_AUDIT.GRANTED },
      orderBy: { id: "asc" },
    });
    expect(granted.map((r) => r.newValue)).toEqual([
      { decision: "GRANTED", source: "UI", selfElevated: "unknown" },
      { decision: "GRANTED", source: "UI", selfElevated: "true" },
    ]);
  });
});

describe("P7 / S-P3-8 yetki daralması (oda katmanı)", () => {
  it("AC-115: applyPermChange remote_control düşerse caps.update + control.revoke{permission} + REVOKED/SYSTEM + audit; yeni istek FORBIDDEN", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    await rooms.applyPermChange(fx.user.id, ["sessions.create", "file_transfer.use"]);
    expect(fx.g.peer.of("caps.update")).toEqual([{ t: "caps.update", caps: ["file_transfer"] }]);
    expect(fx.g.peer.of("control.revoke")).toEqual([{ t: "control.revoke", reason: "permission" }]);
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source: "SYSTEM" });
    expect((await consents(fx.session.id)).map((r) => [r.decision, r.source, r.ip])).toEqual([
      ["GRANTED", "UI", fx.consent.ip],
      ["REVOKED", "SYSTEM", null],
    ]);
    expect(await audits(fx.session.id, CONTROL_AUDIT.CAPS_CHANGED)).toHaveLength(1);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forbidden");
    // müşteri yine de izin verirse kapı hemen kapatılır (bekleyen istek yok → stale, kayıt yok)
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.g.peer.of("control.revoke").at(-1)).toEqual({ t: "control.revoke", reason: "stale" });
    expect(await consents(fx.session.id)).toHaveLength(2);
    expect(fx.room.control.state).toBe("VIEW");
    // değişiklik yoksa tekrar bildirim yok; caps yalnız daralır
    await rooms.applyPermChange(fx.user.id, ALL);
    expect(fx.g.peer.of("caps.update")).toHaveLength(1);
    expect(fx.room.caps).toEqual(["file_transfer"]);
  });
});

/** $transaction'ı elle açılana kadar bekleten DB (açılış yazılırken kapatma yarışı). */
function gatedDb(): { db: Db; open: () => void } {
  const db = testDb();
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const proxy = new Proxy(db, {
    get(target, key, recv) {
      if (key === "$transaction") return (fn: Parameters<Db["$transaction"]>[0]) => gate.then(() => db.$transaction(fn));
      const v: unknown = Reflect.get(target, key, recv);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { db: proxy, open };
}

/** GRANTED'e kadar götürülmüş AGENT odası. */
async function grantedRoom(rooms: Rooms) {
  const fx = await agentRoom(rooms);
  expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
  await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
  expect(fx.room.control.state).toBe("GRANTED");
  return fx;
}

describe("P7 §3.3 K1 — control.release (S7-1)", () => {
  it("S7-1: GRANTED → önce misafire control.release + teknisyene {VIEW,TECH} (DB beklenmez), sonra REVOKED/TECH + control.released", async () => {
    const mode: FailMode = { fail: "none" };
    const rooms = new Rooms({ db: flakyDb(mode), log: silentLog, turn: TURN, metrics: createMetrics(), clock: new FakeClock() });
    const fx = await grantedRoom(rooms);
    mode.fail = "hang";
    const p = handleControlClose(rooms, fx.room, fx.tech, "release");
    // DB asılıyken bile kapatma anında: bellek VIEW, mesajlar gitti
    expect(fx.room.control.state).toBe("VIEW");
    expect(fx.g.peer.of("control.release")).toEqual([{ t: "control.release" }]);
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source: "TECH" });
    void p; // kayıt asılı kalır; kapatma ona bağlı değil
  });

  it("S7-1: bırakma kaydı REVOKED/TECH (ip yok) + audit control.released (aktör teknisyen); yeniden kontrol yeni istek ister, 30 sn beklemesi yok", async () => {
    const rooms = makeRooms();
    const fx = await grantedRoom(rooms);
    await handleControlClose(rooms, fx.room, fx.tech, "release");
    expect((await consents(fx.session.id)).map((r) => [r.decision, r.source, r.ip])).toEqual([
      ["GRANTED", "UI", fx.consent.ip],
      ["REVOKED", "TECH", null],
    ]);
    expect(await audits(fx.session.id, CONTROL_AUDIT.RELEASED)).toMatchObject([
      { userId: fx.user.id, result: "success", newValue: { decision: "REVOKED", source: "TECH", via: "release" } },
    ]);
    // misafirin geç gelen {VIEW, SYSTEM} onayı ek kayıt üretmez
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "SYSTEM" });
    expect(await consents(fx.session.id)).toHaveLength(2);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    expect(fx.room.control.requests).toBe(2);
  });

  it("§3.3: VIEW'da control.release/cancel yok sayılır (mesaj, kayıt yok — idempotent)", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlClose(rooms, fx.room, fx.tech, "release");
    await handleControlClose(rooms, fx.room, fx.tech, "cancel");
    expect(fx.g.peer.of("control.release")).toHaveLength(0);
    expect(fx.g.peer.of("control.cancel")).toHaveLength(0);
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
    expect(await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).toHaveLength(0);
  });

  it("S7-1: açılış kaydı yazılırken bırakma → GRANTED teknisyene iletilmez; geç commit REVOKED/TECH ile dengelenir", async () => {
    const gated = gatedDb();
    const rooms = new Rooms({ db: testDb(), log: silentLog, turn: TURN, metrics: createMetrics(), clock: new FakeClock() });
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    (rooms as { db: Db }).db = gated.db;
    const granting = handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    await expect.poll(() => fx.room.control.granting).toBe(true);
    await handleControlClose(rooms, fx.room, fx.tech, "release");
    expect(fx.g.peer.of("control.release")).toHaveLength(1);
    gated.open();
    await granting;
    await fx.room.control.chain;
    expect(fx.techPeer.of("control.state").map((m) => m.state)).toEqual(["VIEW"]);
    expect(fx.room.control.state).toBe("VIEW");
    expect((await consents(fx.session.id)).map((r) => [r.decision, r.source])).toEqual([
      ["GRANTED", "UI"],
      ["REVOKED", "TECH"],
    ]);
    expect(await audits(fx.session.id, CONTROL_AUDIT.RELEASED)).toHaveLength(1);
  });
});

describe("P7 §3.3 K2 — control.cancel ve geç GRANTED (S7-2, QA-P7-4)", () => {
  it("S7-2: REQUESTED → VIEW; misafire control.cancel, teknisyene {VIEW,TECH}; audit control.cancelled, consent yok; ret beklemesi başlamaz", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlClose(rooms, fx.room, fx.tech, "cancel");
    expect(fx.room.control.state).toBe("VIEW");
    expect(fx.g.peer.of("control.cancel")).toEqual([{ t: "control.cancel" }]);
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source: "TECH" });
    expect(await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).toMatchObject([{ userId: fx.user.id, result: "success" }]);
    expect(await consents(fx.session.id)).toHaveLength(0);
    expect(fx.room.control.deniedAt).toBeUndefined();
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
  });

  it("K6: REQUESTED'de istemciden {VIEW, SYSTEM|UI|HOTKEY} → VIEW, teknisyene aynı kaynak; consent yok, audit control.cancelled{by:agent}; bekleme yok, yeni istek hemen iletilir", async () => {
    for (const source of ["SYSTEM", "UI", "HOTKEY"] as const) {
      const rooms = makeRooms();
      const fx = await agentRoom(rooms);
      expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
      await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source });
      expect(fx.room.control.state).toBe("VIEW");
      expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source });
      expect(await consents(fx.session.id)).toHaveLength(0);
      await expect
        .poll(() => audits(fx.session.id, CONTROL_AUDIT.CANCELLED))
        .toMatchObject([{ username: "customer", result: "success", newValue: { by: "agent", source } }]);
      expect(fx.room.control.deniedAt).toBeUndefined();
      expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
      expect(fx.room.control.requests).toBe(2);
      // ikinci istek de aynı yolla kapanır; VIEW'dayken gelen tekrar ek kayıt üretmez
      await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source });
      await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source });
      await expect.poll(async () => (await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).length).toBe(2);
      expect(fx.techPeer.of("control.state").filter((m) => m.state === "VIEW")).toHaveLength(2);
    }
  });

  it("QA-P7-4/S7-2: iptal sonrası gelen geç GRANTED kaydedilmez/iletilmez; misafire control.revoke{stale}", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlClose(rooms, fx.room, fx.tech, "cancel");
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.g.peer.of("control.revoke")).toEqual([{ t: "control.revoke", reason: "stale" }]);
    expect(fx.techPeer.of("control.state").filter((m) => m.state === "GRANTED")).toHaveLength(0);
    expect(fx.room.control.state).toBe("VIEW");
    expect(await consents(fx.session.id)).toHaveLength(0);
    expect(await audits(fx.session.id, CONTROL_AUDIT.GRANTED)).toHaveLength(0);
  });

  it("QA-P7-4: istek hiç yokken (VIEW) GRANTED → revoke{stale}, kayıt yok; GRANTED iken tekrar GRANTED → yok sayılır", async () => {
    const metrics = createMetrics();
    const rooms = new Rooms({ db: testDb(), log: silentLog, turn: TURN, metrics, clock: new FakeClock() });
    const fx = await agentRoom(rooms);
    for (let i = 0; i < 3; i++) await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.g.peer.of("control.revoke")).toHaveLength(3);
    expect(await consents(fx.session.id)).toHaveLength(0);
    expect(metrics.render()).toMatch(/rs_control_total\{event="control_state_unexpected"\} 3/);

    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.g.peer.of("control.revoke")).toHaveLength(3);
    expect(fx.techPeer.of("control.state").filter((m) => m.state === "GRANTED")).toHaveLength(1);
    expect(await consents(fx.session.id)).toHaveLength(1);
  });

  it("S7-2: GRANTED iken control.cancel = bırakma (misafire control.release, REVOKED/TECH, control.released)", async () => {
    const rooms = makeRooms();
    const fx = await grantedRoom(rooms);
    await handleControlClose(rooms, fx.room, fx.tech, "cancel");
    expect(fx.g.peer.of("control.release")).toHaveLength(1);
    expect(fx.g.peer.of("control.cancel")).toHaveLength(0);
    expect((await consents(fx.session.id)).map((r) => [r.decision, r.source])).toEqual([
      ["GRANTED", "UI"],
      ["REVOKED", "TECH"],
    ]);
    expect(await audits(fx.session.id, CONTROL_AUDIT.RELEASED)).toMatchObject([{ newValue: { via: "cancel" } }]);
  });
});

describe("P7 §3.3 K3 — teknisyen kopması / sekme değişimi (S7-4)", () => {
  it("S7-4/AC-24: teknisyen koparsa misafire önce control.revoke{reconnect}, sonra peer.left; REVOKED/RECONNECT; bekleyen monitör temizlenir", async () => {
    const rooms = makeRooms();
    const fx = await grantedRoom(rooms);
    fx.room.control.monitorPending = { id: 1, at: 0, peer: fx.g.peer };
    rooms.detachTech(fx.room, fx.techPeer);
    const types = fx.g.peer.sent.map((m) => m.t);
    const revokeAt = types.lastIndexOf("control.revoke");
    expect(fx.g.peer.sent[revokeAt]).toEqual({ t: "control.revoke", reason: "reconnect" });
    expect(revokeAt).toBeLessThan(types.lastIndexOf("peer.left"));
    expect(fx.room.control.state).toBe("VIEW");
    expect(fx.room.control.monitorPending).toBeUndefined();
    await fx.room.control.chain;
    expect((await consents(fx.session.id)).map((r) => [r.decision, r.source])).toEqual([
      ["GRANTED", "UI"],
      ["REVOKED", "RECONNECT"],
    ]);
  });

  it("S7-4: yeni konsol sekmesi (VIEW'da bile) misafire önce control.revoke{reconnect}, sonra peer.joined{tech}; ek kayıt yok", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    const { fakePeer } = await import("../helpers/ws.ts");
    const tab2 = fakePeer();
    rooms.attachTech(fx.row, { ...fx.tech, peer: tab2 });
    const types = fx.g.peer.sent.map((m) => m.t);
    expect(fx.g.peer.of("control.revoke")).toEqual([{ t: "control.revoke", reason: "reconnect" }]);
    expect(types.indexOf("control.revoke")).toBeLessThan(types.lastIndexOf("peer.joined"));
    expect(tab2.of("hello")).toHaveLength(1);
    expect(await consents(fx.session.id)).toHaveLength(0);
  });
});

describe("P7 §3.3 K5-d — oturum sonu", () => {
  it("K5-d: kontrol açıkken oturum biterse session.ended sonrası REVOKED/SYSTEM + control.revoked{session_ended}", async () => {
    const rooms = makeRooms();
    const fx = await grantedRoom(rooms);
    await rooms.finish(fx.room, "tech", "TECH", fx.tech.ctx);
    expect(fx.g.peer.of("session.ended")).toHaveLength(1);
    await fx.room.control.chain;
    expect((await consents(fx.session.id)).map((r) => [r.decision, r.source])).toEqual([
      ["GRANTED", "UI"],
      ["REVOKED", "SYSTEM"],
    ]);
    const rows = await audits(fx.session.id, CONTROL_AUDIT.REVOKED);
    expect(rows).toMatchObject([{ username: "system", newValue: { source: "SYSTEM", reason: "session_ended" } }]);
  });

  it("K5-d: kayıt yazılamazsa bitiş engellenmez (session.ended gider, oda silinir)", async () => {
    const mode: FailMode = { fail: "none" };
    const rooms = new Rooms({ db: flakyDb(mode), log: silentLog, turn: TURN, metrics: createMetrics(), clock: new FakeClock() });
    const fx = await grantedRoom(rooms);
    mode.fail = "error";
    await rooms.finish(fx.room, "customer", "CUSTOMER");
    await fx.room.control.chain;
    expect(fx.g.peer.of("session.ended")).toEqual([{ t: "session.ended", reason: "customer" }]);
    expect(fx.techPeer.of("session.ended")).toHaveLength(1);
    expect(rooms.get(fx.session.id)).toBeUndefined();
  });

  it("K5-d: kontrol kapalıyken oturum sonu ek kayıt yazmaz", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await rooms.finish(fx.room, "tech", "TECH", fx.tech.ctx);
    await fx.room.control.chain;
    expect(await consents(fx.session.id)).toHaveLength(0);
  });
});

describe("P7 §3.3 K4 — monitor.denied", () => {
  const MONITORS = {
    state: "sharing" as const,
    monitors: [
      { id: 0, name: "A", w: 1920, h: 1080, primary: true },
      { id: 1, name: "B", w: 1280, h: 1024, primary: false },
    ],
    activeMonitor: 0,
  };

  it("AC-43 (K4): ret yalnız bekleyen kimlik için — temizlenir, teknisyene iletilir, audit monitor.denied, 30 sn bekleme", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await agentRoom(rooms);
    fx.room.share = { ...MONITORS };
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 1)).toBe("forwarded");
    await handleMonitorDenied(rooms, fx.room, fx.g.entry, 0); // başka kimlik → yok say
    expect(fx.techPeer.of("monitor.denied")).toHaveLength(0);
    expect(fx.room.control.monitorPending?.id).toBe(1);
    await handleMonitorDenied(rooms, fx.room, fx.g.entry, 1);
    expect(fx.techPeer.of("monitor.denied")).toEqual([{ t: "monitor.denied", monitorId: 1 }]);
    expect(fx.room.control.monitorPending).toBeUndefined();
    expect(await audits(fx.session.id, CONTROL_AUDIT.MONITOR_DENIED)).toMatchObject([
      { username: "customer", newValue: { monitorId: "1" } },
    ]);
    expect(await consents(fx.session.id)).toHaveLength(0);
    await handleMonitorDenied(rooms, fx.room, fx.g.entry, 1); // tekrar → kayıt şişmez
    expect(await audits(fx.session.id, CONTROL_AUDIT.MONITOR_DENIED)).toHaveLength(1);

    clock.advance(CONTROL_DENY_COOLDOWN_MS - 1);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 1)).toBe("cooldown");
    expect(fx.techPeer.of("error").at(-1)).toMatchObject({ code: "RATE_LIMITED" });
    clock.advance(1);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 1)).toBe("forwarded");
  });

  it("K5-e: 30 sn yanıtsızlık ret gibi işler (audit/mesaj yok): sonraki 30 sn RATE_LIMITED, sonra iletilir; sayaç kontrolden ayrı", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await agentRoom(rooms);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 0)).toBe("forwarded");
    clock.advance(CONTROL_DENY_COOLDOWN_MS);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 0)).toBe("cooldown");
    clock.advance(CONTROL_DENY_COOLDOWN_MS - 1);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 0)).toBe("cooldown");
    clock.advance(1);
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 0)).toBe("forwarded");
    expect(await audits(fx.session.id, CONTROL_AUDIT.MONITOR_DENIED)).toHaveLength(0);
    expect(fx.techPeer.of("monitor.denied")).toHaveLength(0);
    expect(fx.room.control.requests).toBe(0);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
  });

  it("AC-34: tarayıcı misafirinden monitor.denied yok sayılır", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, ALL, "BROWSER");
    fx.room.control.monitorPending = { id: 0, at: 0, peer: fx.g.peer };
    await handleMonitorDenied(rooms, fx.room, fx.g.entry, 0);
    expect(fx.techPeer.of("monitor.denied")).toHaveLength(0);
    expect(fx.room.control.monitorPending).toBeDefined();
  });

  it("S7-15/AC-43: misafir koparsa bekleyen monitör isteği temizlenir; yeniden bağlanan istemcinin share.state'i monitor.granted yazdırmaz, teknisyen CONFLICT almaz", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    fx.room.share = { ...MONITORS };
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 1)).toBe("forwarded");
    rooms.detachGuest(fx.room, fx.g.entry, fx.g.peer);
    expect(fx.room.control.monitorPending).toBeUndefined();
    const again = fakePeer();
    rooms.reattachGuest(fx.room, again);
    await onShareMonitor(rooms, fx.room, fx.g.entry, 1); // diyalog görülmeden gelen ilk share.state
    expect(await audits(fx.session.id, CONTROL_AUDIT.MONITOR_GRANTED)).toHaveLength(0);
    fx.room.share = { ...MONITORS, activeMonitor: 1 };
    expect(await handleMonitorRequest(rooms, fx.room, fx.tech, 0)).toBe("forwarded");
    expect(again.of("monitor.request")).toEqual([{ t: "monitor.request", monitorId: 0 }]);
  });

  it("S7-15: karşılanma yalnız isteğin iletildiği bağlantıdan — başka bağlantı kimliğiyle bekleyen istek monitor.granted yazdırmaz", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms);
    fx.room.control.monitorPending = { id: 1, at: 0, peer: fakePeer() };
    await onShareMonitor(rooms, fx.room, fx.g.entry, 1);
    expect(fx.room.control.monitorPending?.id).toBe(1);
    expect(await audits(fx.session.id, CONTROL_AUDIT.MONITOR_GRANTED)).toHaveLength(0);
  });
});

// ---- Uçtan uca (gerçek WS): S-P3-8 60 sn yeniden doğrulama yedek yolu ----
let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

/** Origin'siz AGENT resolve/join + WS → admit. */
async function agentAdmitted(l: Live, t: TechSide, ip = "203.0.113.30"): Promise<WsClient> {
  return (await agentAdmittedHello(l, t, ip)).g;
}

/** agentAdmitted + misafir hello (yeniden bağlanma belirteci için). */
async function agentAdmittedHello(l: Live, t: TechSide, ip = "203.0.113.30") {
  const headers = { "x-forwarded-for": ip };
  const r = await l.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers,
    payload: { token: t.token, clientKind: "AGENT" },
  });
  if (r.statusCode !== 200) throw new Error(`resolve ${r.statusCode} ${r.body}`);
  const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
  const j = await l.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/join",
    headers,
    payload: { joinNonce, customerName: "Mehmet Müşteri", consentAccepted: true, consentTextId: consentText.id },
  });
  if (j.statusCode !== 200) throw new Error(`join ${j.statusCode} ${j.body}`);
  const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
  const g = await connect(`${l.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`]);
  await g.waitFor("lobby.wait");
  await t.ws.waitFor("peer.pending");
  t.ws.send({ t: "guest.admit", admitCode });
  const hello = await g.waitFor("hello");
  await t.ws.waitFor("peer.joined");
  return { g, hello };
}

describe("P7 / S-P3-8 uçtan uca", () => {
  it("AC-115: kontrol açıkken remote_control.use kaldırılınca yeniden doğrulamada control.revoke{permission} + caps.update; kapı kapanır", async () => {
    live = await startLive({ signaling: { revalidateMs: 150 } });
    const t = await techSession(live);
    const g = await agentAdmitted(live, t);
    t.ws.send({ t: "control.request" });
    await g.waitFor("control.request");
    g.send({ t: "control.state", state: "GRANTED", source: "UI" });
    expect(await t.ws.waitFor("control.state")).toMatchObject({ state: "GRANTED", source: "UI" });

    await testDb().userPermission.update({
      where: { userId_permKey: { userId: t.tech.id, permKey: "remote_control.use" } },
      data: { granted: false },
    });
    expect(await g.waitFor("control.revoke")).toEqual({ t: "control.revoke", reason: "permission" });
    expect(await g.waitFor("caps.update")).toEqual({ t: "caps.update", caps: ["file_transfer"] });
    expect(await t.ws.waitFor("control.state")).toMatchObject({ state: "VIEW", source: "SYSTEM" });
    // istemci kapıyı kapatıp onaylar; ek kayıt yok
    g.send({ t: "control.state", state: "VIEW", source: "SYSTEM" });
    t.ws.send({ t: "control.request" });
    expect(await t.ws.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    await expect
      .poll(async () => (await consents(t.sessionId)).map((r) => [r.decision, r.source]))
      .toEqual([
        ["GRANTED", "UI"],
        ["REVOKED", "SYSTEM"],
      ]);
  });

  it("AC-115: pasifleştirilen teknisyenin tüm odaları (teknisyeni kopuk oda dahil) auth_revoked ile biter, 4401", async () => {
    live = await startLive({ signaling: { revalidateMs: 150 } });
    const a = await techSession(live);
    const res = await live.app.inject({ method: "POST", url: "/api/v1/sessions", headers: a.techAuth.headers, payload: {} });
    const created = res.json<{ id: string; link: string; code: string }>();
    const { techHeaders } = await import("../helpers/ws.ts");
    const bWs = await connect(`${live.base}/ws/tech?sessionId=${created.id}`, ["rs.v1"], techHeaders(a.techAuth.token, ORIGIN));
    await bWs.waitFor("hello");
    const b: TechSide = { ...a, sessionId: created.id, token: created.link.split("/").pop() ?? "", code: created.code, ws: bWs };
    const ga = await agentAdmitted(live, a);
    const gb = await agentAdmitted(live, b, "203.0.113.31");
    bWs.ws.close();
    await gb.waitFor("peer.left");

    await testDb().user.update({ where: { id: a.tech.id }, data: { status: "PASSIVE" } });
    for (const ws of [a.ws, ga, gb]) expect((await ws.waitFor("session.ended", 3000)).reason).toBe("auth_revoked");
    expect((await a.ws.closed).code).toBe(4401);
    for (const id of [a.sessionId, b.sessionId]) {
      expect(await testDb().supportSession.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "ENDED",
        endReason: "auth_revoked",
      });
    }
    expect(live.app.rooms.size).toBe(0);
  });

  it("AC-115: rol değişimi yeniden doğrulamada teknisyenin odalarını bitirir", async () => {
    live = await startLive({ signaling: { revalidateMs: 150 } });
    const t = await techSession(live);
    const g = await agentAdmitted(live, t);
    await testDb().user.update({ where: { id: t.tech.id }, data: { role: "ADMIN" } });
    expect((await g.waitFor("session.ended", 3000)).reason).toBe("auth_revoked");
    expect((await t.ws.closed).code).toBe(4401);
    expect(TECH_PERMS["remote_control.use"]).toBe(true);
  });
});

describe("P7 §3.3 uçtan uca (gerçek WS)", () => {
  it("S7-1/S7-2: WS üzerinden control.cancel ve control.release misafire iletilir, teknisyen {VIEW,TECH} alır", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await agentAdmitted(live, t);
    t.ws.send({ t: "control.request" });
    await g.waitFor("control.request");
    t.ws.send({ t: "control.cancel" });
    expect(await g.waitFor("control.cancel")).toEqual({ t: "control.cancel" });
    expect(await t.ws.waitFor("control.state")).toEqual({ t: "control.state", state: "VIEW", source: "TECH" });
    t.ws.send({ t: "control.request" });
    await g.waitFor("control.request");
    g.send({ t: "control.state", state: "GRANTED", source: "UI" });
    expect(await t.ws.waitFor("control.state")).toMatchObject({ state: "GRANTED" });
    t.ws.send({ t: "control.release" });
    expect(await g.waitFor("control.release")).toEqual({ t: "control.release" });
    expect(await t.ws.waitFor("control.state")).toEqual({ t: "control.state", state: "VIEW", source: "TECH" });
    await expect
      .poll(async () => (await consents(t.sessionId)).map((r) => [r.decision, r.source]))
      .toEqual([
        ["GRANTED", "UI"],
        ["REVOKED", "TECH"],
      ]);
    // teknisyen sekmesi kapanınca misafire revoke{reconnect}
    t.ws.ws.close();
    expect(await g.waitFor("control.revoke")).toEqual({ t: "control.revoke", reason: "reconnect" });
    await g.waitFor("peer.left");
  });

  it("S7-15: monitör isteği bekliyorken misafir kopup yeniden bağlanır; ilk share.state monitor.granted YAZMAZ, yeni istek iletilir", async () => {
    live = await startLive();
    const t = await techSession(live);
    const { g, hello } = await agentAdmittedHello(live, t);
    const monitors = [
      { id: 0, name: "A", w: 1920, h: 1080, primary: true },
      { id: 1, name: "B", w: 1280, h: 1024, primary: false },
    ];
    g.send({ t: "share.state", state: "sharing", monitors, activeMonitor: 0 });
    await t.ws.waitFor("share.state");
    t.ws.send({ t: "monitor.request", monitorId: 1 });
    await g.waitFor("monitor.request");
    g.ws.close();
    expect(await t.ws.waitFor("peer.left")).toMatchObject({ role: "guest", reason: "disconnect" });
    const again = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.reconnect.${hello.reconnectToken ?? ""}`]);
    await again.waitFor("hello");
    await t.ws.waitFor("peer.joined");
    again.send({ t: "share.state", state: "sharing", monitors, activeMonitor: 1 });
    expect(await t.ws.waitFor("share.state")).toMatchObject({ activeMonitor: 1 });
    t.ws.send({ t: "monitor.request", monitorId: 0 }); // CONFLICT değil: bekleyen istek kopmada temizlendi
    expect(await again.waitFor("monitor.request")).toEqual({ t: "monitor.request", monitorId: 0 });
    expect(await audits(t.sessionId, CONTROL_AUDIT.MONITOR_GRANTED)).toHaveLength(0);
    expect(await audits(t.sessionId, CONTROL_AUDIT.MONITOR_REQUESTED)).toHaveLength(2);
    again.ws.close();
  });

  it("K6 (WS): bekleyen istekte istemci {VIEW, SYSTEM} → teknisyene {VIEW, SYSTEM}, consent yok, audit control.cancelled; yeni istek hemen iletilir", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await agentAdmitted(live, t);
    t.ws.send({ t: "control.request" });
    await g.waitFor("control.request");
    g.send({ t: "control.state", state: "VIEW", source: "SYSTEM" });
    expect(await t.ws.waitFor("control.state")).toEqual({ t: "control.state", state: "VIEW", source: "SYSTEM" });
    t.ws.send({ t: "control.request" });
    expect(await g.waitFor("control.request")).toEqual({ t: "control.request" });
    await expect
      .poll(() => audits(t.sessionId, CONTROL_AUDIT.CANCELLED))
      .toMatchObject([{ username: "customer", newValue: { by: "agent", source: "SYSTEM" } }]);
    expect(await consents(t.sessionId)).toHaveLength(0);
    g.ws.close();
  });

  it("S7-9/K8 (WS): env.state selfElevated teknisyene iletilir ve GRANTED audit'ine yazılır; alan eksikse 1008", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await agentAdmitted(live, t);
    g.send({ t: "env.state", elevatedForeground: false, secureDesktop: false, selfElevated: true });
    expect(await t.ws.waitFor("env.state")).toEqual({
      t: "env.state",
      elevatedForeground: false,
      secureDesktop: false,
      selfElevated: true,
    });
    t.ws.send({ t: "control.request" });
    await g.waitFor("control.request");
    g.send({ t: "control.state", state: "GRANTED", source: "UI" });
    expect(await t.ws.waitFor("control.state")).toMatchObject({ state: "GRANTED" });
    expect(await audits(t.sessionId, CONTROL_AUDIT.GRANTED)).toMatchObject([{ newValue: { decision: "GRANTED", selfElevated: "true" } }]);
    g.send({ t: "env.state", elevatedForeground: false, secureDesktop: false });
    expect((await g.closed).code).toBe(1008);
  });

  it("S7-10: misafirden control.state{VIEW, RECONNECT|TECH} şema hatası → 1008; monitor.denied teknisyene iletilir", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await agentAdmitted(live, t);
    t.ws.send({ t: "monitor.request", monitorId: 0 });
    await g.waitFor("monitor.request");
    g.send({ t: "monitor.denied", monitorId: 0 });
    expect(await t.ws.waitFor("monitor.denied")).toEqual({ t: "monitor.denied", monitorId: 0 });
    g.send({ t: "control.state", state: "VIEW", source: "RECONNECT" });
    expect((await g.closed).code).toBe(1008);
    const g2 = await agentAdmitted(live, await techSession(live), "203.0.113.41");
    g2.send({ t: "control.state", state: "VIEW", source: "TECH" });
    expect((await g2.closed).code).toBe(1008);
  });
});
