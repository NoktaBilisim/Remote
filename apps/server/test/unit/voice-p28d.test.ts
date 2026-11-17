// P28d K1 birim testleri (mimari-p28d r2 §3, §4.1, §4.2, §6): metrik kaydı, ses yeteneği kapısı (`voiceOf`/`hasVoice`),
// `endVoice` tetikleyici matrisi ve `voice.state` değişmezleri (`talkers ⊆ listeners`). Oda/Rooms yalnız kullanılan alanlarla
// kurulur (DB yok; audit sahte istemciye yazılır), saat sahte. Uçtan uca davranış `test/integration/voice-p28d.test.ts`.
import { VOICE_DENY_COOLDOWN_MS, VOICE_REQUEST_TIMEOUT_MS, WS_CAP_VOICE, voiceStateSchema } from "@remote/contracts/ws-voice";
import type { PermissionKey } from "@remote/contracts/permissions";
import { describe, expect, it } from "vitest";
import { createMetrics } from "../../src/ops/metrics.ts";
import { projectDetails } from "../../src/sessions/history.ts";
import { newMulti, tidOf } from "../../src/signaling/members.ts";
import { hasVoice, voiceOf } from "../../src/signaling/rooms-features.ts";
import type { Rooms } from "../../src/signaling/rooms.ts";
import type { Guest, Member, Room, TechConn } from "../../src/signaling/types.ts";
import {
  activeVoiceCount,
  endVoice,
  handleGuestVoice,
  handleTechVoice,
  newVoice,
  voicePermChange,
  voiceSync,
} from "../../src/signaling/voice.ts";
import { FakeClock, fakePeer, silentLog, type FakePeer } from "../helpers/ws.ts";

const VOICE: PermissionKey[] = ["sessions.view", "sessions.voice"];
const flush = () => new Promise((r) => setTimeout(r, 0));

function conn(userId: string, perms: PermissionKey[] = VOICE): TechConn & { peer: FakePeer } {
  return {
    peer: fakePeer(),
    userId,
    username: `${userId}@x`,
    authToken: "x",
    permissions: new Set(perms),
    role: "USER",
    ctx: { ip: "10.0.0.1", userAgent: "t", requestId: "r" },
  };
}

function fixture() {
  const clock = new FakeClock();
  const metrics = createMetrics();
  const audits: { action: string; result: string; newValue: unknown; username: string }[] = [];
  const db = { auditLog: { create: async ({ data }: { data: (typeof audits)[number] }) => void audits.push(data) } };
  const rooms = { clock, metrics, db, log: silentLog, live: (r: Room) => !r.ending } as unknown as Rooms;
  const own = conn("own");
  const gpeer = fakePeer();
  gpeer.voice = true;
  gpeer.multi = true;
  const guest = { id: "g", name: "Ayşe", kind: "BROWSER", state: "ADMITTED", peer: gpeer } as unknown as Guest;
  const room = {
    sessionId: "S",
    tenantId: "T",
    technicianId: "own",
    technicianName: "Sahip",
    tech: own,
    admitted: guest,
    ending: false,
    multi: newMulti("own"),
    voice: newVoice(),
  } as unknown as Room;
  const addMember = (userId: string, role: Member["role"] = "participant", perms = VOICE) => {
    const c = conn(userId, perms);
    room.multi.members.set(userId, {
      userId,
      username: `${userId}@x`,
      fullName: userId,
      role,
      via: "invite",
      conn: c,
      joinedAudited: true,
      authSessionId: "a",
    });
    return c;
  };
  const states = (p: FakePeer) => p.of("voice.state").map((m) => voiceStateSchema.parse(m));
  /** İstek + kabul: active, konuşan = sahip. */
  const startCall = () => {
    handleTechVoice(rooms, room, own, { t: "voice.request" });
    const callId = room.voice.callId ?? "";
    handleGuestVoice(rooms, room, guest, { t: "voice.answer", callId, accept: true });
    return callId;
  };
  return { clock, metrics, audits, rooms, room, own, guest, gpeer, addMember, states, startCall };
}

describe("P28d metrikler (§6)", () => {
  it("AC-379: rs_voice_calls_total ve rs_voice_denied_total kayıtlı (ilk olaydan önce etiketsiz 0); inc sayılır", () => {
    const m = createMetrics();
    const before = m.render().split("\n");
    expect(before).toContain("# TYPE rs_voice_calls_total counter");
    expect(before).toContain("rs_voice_calls_total 0");
    expect(before).toContain("rs_voice_denied_total 0");
    m.inc("rs_voice_denied_total", { code: "stale_call" });
    expect(m.render().split("\n")).toContain('rs_voice_denied_total{code="stale_call"} 1');
  });
});

describe("P28d ses yeteneği kapısı (§4.1, O-PD-3)", () => {
  const g = (kind: "BROWSER" | "AGENT") => ({ kind }) as Guest;
  const r = (unattended: boolean) => ({ ...(unattended ? { unattended: {} } : {}) }) as Room;
  it("AC-379: BROWSER destekli; AGENT yalnız rs.cap.voice1 ile; gözetimsiz odada belirteç yok sayılır", () => {
    expect(voiceOf([], r(false), g("BROWSER"))).toBe(true);
    expect(voiceOf([], r(false), g("AGENT"))).toBe(false);
    expect(voiceOf([WS_CAP_VOICE], r(false), g("AGENT"))).toBe(true);
    expect(voiceOf([WS_CAP_VOICE], r(true), g("AGENT"))).toBe(false);
    expect(voiceOf([], r(true), g("BROWSER"))).toBe(false);
  });
  it("AC-379: hasVoice gözetimsiz odada soket bayrağı olsa da false; soket yoksa false", () => {
    expect(hasVoice(r(false), { voice: true } as never)).toBe(true);
    expect(hasVoice(r(true), { voice: true } as never)).toBe(false);
    expect(hasVoice(r(false), undefined)).toBe(false);
  });
});

describe("P28d endVoice tetikleyici matrisi (§4.2; 7 neden)", () => {
  it("AC-374 tech: konuşan bitirir → idle{tech, callId} herkese; audit end{durationSec, talkerIds, listenerIds}", async () => {
    const f = fixture();
    const callId = f.startCall();
    f.clock.advance(12_400);
    handleTechVoice(f.rooms, f.room, f.own, { t: "voice.end", callId });
    expect(f.states(f.gpeer).at(-1)).toMatchObject({ phase: "idle", callId, endReason: "tech", talkers: [], listeners: [] });
    await flush();
    expect(f.audits.at(-1)).toMatchObject({
      action: "voice.end",
      newValue: { durationSec: 12, reason: "tech", talkerIds: ["own"], listenerIds: ["own"] },
    });
    expect(activeVoiceCount([f.room])).toBe(0);
  });

  it("AC-373 timeout: 60 sn yanıtsız → reject{timeout} + bekleme; customer: ret → reject{customer} + bekleme", async () => {
    const f = fixture();
    handleTechVoice(f.rooms, f.room, f.own, { t: "voice.request" });
    f.clock.advance(VOICE_REQUEST_TIMEOUT_MS);
    expect(f.states(f.own.peer).at(-1)).toMatchObject({ phase: "idle", endReason: "timeout" });
    expect(f.room.voice.cooldownUntil).toBe(f.clock.now() + VOICE_DENY_COOLDOWN_MS);
    f.clock.advance(VOICE_DENY_COOLDOWN_MS);
    handleTechVoice(f.rooms, f.room, f.own, { t: "voice.request" });
    handleGuestVoice(f.rooms, f.room, f.guest, { t: "voice.answer", callId: f.room.voice.callId ?? "", accept: false });
    await flush();
    expect(f.audits.filter((a) => a.action === "voice.reject").map((a) => [a.newValue, a.result, a.username])).toEqual([
      [{ reason: "timeout" }, "fail", "system"],
      [{ reason: "customer" }, "fail", "customer"],
    ]);
    expect(f.metrics.render()).toContain('rs_voice_calls_total{result="timeout"} 1');
  });

  it("AC-374 customer/device: misafir bitirir → bekleme başlar; tech bitişinde bekleme yok (D-PD-2)", () => {
    for (const reason of ["customer", "device"] as const) {
      const f = fixture();
      const callId = f.startCall();
      handleGuestVoice(f.rooms, f.room, f.guest, { t: "voice.end", callId, reason });
      expect(f.states(f.own.peer).at(-1)).toMatchObject({ phase: "idle", endReason: reason });
      expect(f.room.voice.cooldownUntil).toBeGreaterThan(f.clock.now());
    }
    const f = fixture();
    const callId = f.startCall();
    handleTechVoice(f.rooms, f.room, f.own, { t: "voice.end", callId });
    expect(f.room.voice.cooldownUntil).toBe(0);
  });

  it("V-PD-5 left: konuşan sahip soketi düşer → konuşan kalmaz → left; katılımcı da konuşuyorsa görüşme sürer", () => {
    const f = fixture();
    const a = f.addMember("a");
    const callId = f.startCall();
    handleTechVoice(f.rooms, f.room, a, { t: "voice.join", callId });
    f.room.tech = undefined;
    voiceSync(f.rooms, f.room);
    expect(f.states(a.peer).at(-1)).toMatchObject({ phase: "active", talkers: [tidOf(f.room, "a")], listeners: [tidOf(f.room, "a")] });
    const m = f.room.multi.members.get("a");
    if (m) m.conn = undefined;
    voiceSync(f.rooms, f.room);
    expect(f.states(f.gpeer).at(-1)).toMatchObject({ phase: "idle", endReason: "left" });
  });

  it("V-PD-7 disconnect: misafir soketi gider → active end{disconnect}, pending reject{disconnect}; bekleme yok", async () => {
    const f = fixture();
    f.startCall();
    f.guest.peer = undefined;
    voiceSync(f.rooms, f.room);
    expect(f.states(f.own.peer).at(-1)).toMatchObject({ phase: "idle", endReason: "disconnect" });
    f.guest.peer = f.gpeer;
    handleTechVoice(f.rooms, f.room, f.own, { t: "voice.request" });
    f.guest.peer = undefined;
    voiceSync(f.rooms, f.room);
    await flush();
    expect(f.audits.at(-1)).toMatchObject({ action: "voice.reject", newValue: { reason: "disconnect" } });
    expect(f.room.voice.cooldownUntil).toBe(0);
  });

  it("gözetimsiz değişim: odaya gözetimsiz bilgisi gelirse sonraki eşitlemede görüşme disconnect ile biter", () => {
    const f = fixture();
    f.startCall();
    f.room.unattended = {} as Room["unattended"];
    voiceSync(f.rooms, f.room);
    expect(f.room.voice.phase).toBe("idle");
    expect(f.states(f.own.peer).at(-1)).toMatchObject({ endReason: "disconnect" });
  });

  it("session_ended: endVoice oda bitişinde (ending) de yayın + audit yapar", async () => {
    const f = fixture();
    f.startCall();
    f.room.ending = true;
    endVoice(f.rooms, f.room, "session_ended");
    expect(f.states(f.gpeer).at(-1)).toMatchObject({ phase: "idle", endReason: "session_ended" });
    await flush();
    expect(f.audits.at(-1)).toMatchObject({ action: "voice.end", newValue: { reason: "session_ended" } });
  });
});

describe("P28d dinleyenler ve konuşanlar (V-PD-3, Y-PD-3, AC-378)", () => {
  it("AC-378: listeners = bağlı + rol + sessions.voice; yetkisiz izleyici dışarıda; her yayın şemayı geçer", () => {
    const f = fixture();
    f.addMember("a");
    f.addMember("obs", "observer");
    f.addMember("nov", "observer", ["sessions.view"]);
    f.startCall();
    const last = f.states(f.gpeer).at(-1);
    expect(last?.listeners).toEqual(["own", "a", "obs"].map((u) => tidOf(f.room, u)));
    expect(last?.talkers).toEqual([tidOf(f.room, "own")]);
  });

  it("Y-PD-3: voicePermChange — sessions.voice düşen tid konuşan + dinleyenden çıkar; son konuşan düşünce left", () => {
    const f = fixture();
    const a = f.addMember("a");
    const callId = f.startCall();
    handleTechVoice(f.rooms, f.room, a, { t: "voice.join", callId });
    a.permissions = new Set(["sessions.view"]);
    voicePermChange(f.rooms, f.room, "a", a.permissions);
    expect(f.states(f.gpeer).at(-1)).toMatchObject({ talkers: [tidOf(f.room, "own")], listeners: [tidOf(f.room, "own")] });
    f.own.permissions = new Set(["sessions.view"]);
    voicePermChange(f.rooms, f.room, "own", f.own.permissions);
    expect(f.states(f.gpeer).at(-1)).toMatchObject({ phase: "idle", endReason: "left" });
  });

  it("isteyen pending'de giderse kabul anında konuşan kalmaz → accept + end{left} (talkers ⊆ listeners korunur)", async () => {
    const f = fixture();
    handleTechVoice(f.rooms, f.room, f.own, { t: "voice.request" });
    const callId = f.room.voice.callId ?? "";
    f.room.tech = undefined;
    voiceSync(f.rooms, f.room);
    expect(f.room.voice.phase).toBe("pending");
    handleGuestVoice(f.rooms, f.room, f.guest, { t: "voice.answer", callId, accept: true });
    expect(f.states(f.gpeer).every((s) => s.talkers.every((t) => s.listeners.includes(t)))).toBe(true);
    expect(f.states(f.gpeer).at(-1)).toMatchObject({ phase: "idle", endReason: "left" });
    await flush();
    expect(f.audits.map((a) => a.action)).toEqual(["voice.request", "voice.accept", "voice.end"]);
  });

  it("D-PD-2: aynı durum yeniden yayınlanmaz (tekrarlayan join no-op); eşleşmeyen callId düşer", () => {
    const f = fixture();
    const a = f.addMember("a");
    const callId = f.startCall();
    handleTechVoice(f.rooms, f.room, a, { t: "voice.join", callId });
    const n = f.gpeer.of("voice.state").length;
    handleTechVoice(f.rooms, f.room, a, { t: "voice.join", callId });
    voiceSync(f.rooms, f.room);
    handleGuestVoice(f.rooms, f.room, f.guest, { t: "voice.end", callId: "A".repeat(22), reason: "customer" });
    expect(f.gpeer.of("voice.state")).toHaveLength(n);
    expect(f.room.voice.phase).toBe("active");
    expect(f.metrics.render()).toContain('rs_voice_denied_total{code="stale_call"} 1');
  });
});

describe("P28d oturum geçmişi zaman çizelgesi (AC-379)", () => {
  it("AC-379: voice.end yalnız neden + süre; talkerIds/listenerIds (kullanıcı kimliği) dönmez; voice.reject neden", () => {
    const end = { durationSec: 192, reason: "tech", talkerIds: ["u1", "u2"], listenerIds: ["u1", "u2"] };
    expect(projectDetails("voice.end", null, end)).toEqual({ reason: "tech", durationSec: 192 });
    expect(projectDetails("voice.reject", null, { reason: "timeout" })).toEqual({ reason: "timeout" });
    expect(projectDetails("voice.join", null, { any: "x" })).toEqual({});
  });
});
