// P13b-L birim testleri (mimari-lobi §3, §9.1): lobby-count waitingIn / waitingFor bellek sayımı, sahte saat, DB'siz.
// Kabul/ret/ayrılma/zaman aşımı/iptal/süre dolumu çıkış yolları, arrivals monotonluğu, ön-kabullü misafir, restart.
import { LOBBY_GUEST_MAX, waitingSessionsResponseSchema } from "@remote/contracts/api/sessions";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../src/auth/session.ts";
import type { Db } from "../../src/lib/db.ts";
import { newId } from "../../src/lib/ids.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import type { GuestConsent } from "../../src/public/consent.ts";
import { getWaitingSessions, withWaitingGuests } from "../../src/sessions/lobby.ts";
import { waitingFor, waitingIn } from "../../src/signaling/lobby-count.ts";
import { Rooms } from "../../src/signaling/rooms.ts";
import { LOBBY_MAX } from "../../src/signaling/types.ts";
import { FakeClock, fakePeer, silentLog, TURN } from "../helpers/ws.ts";

const consent: GuestConsent = { textId: "C", version: 1, sha256: "0".repeat(64), at: new Date(), ip: "", userAgent: "" };
/** Bu testlerdeki yollar DB'ye dokunmaz (addGuest/attachGuest/leaveLobby/closeSession bellek içi). */
const noDb = {} as Db;

function setup() {
  const clock = new FakeClock();
  const rooms = new Rooms({ db: noDb, log: silentLog, turn: TURN, metrics: createMetrics(), clock });
  const rowOf = (tenantId: string, technicianId: string, ttlMs = 15 * 60_000) => ({
    id: newId(),
    tenantId,
    technicianId,
    technician: { fullName: "T" },
    expiresAt: new Date(clock.now() + ttlMs),
  });
  type Row = ReturnType<typeof rowOf>;
  /** join (TICKETED) — WS'e bağlanmaz. */
  const ticketed = (row: Row, ip: string) => rooms.addGuest(row, { name: "Ayşe Yılmaz", kind: "BROWSER", ipKey: ip, consent });
  /** join + ticket ile WS → LOBBY. */
  const join = (row: Row, ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`) => {
    const g = ticketed(row, ip);
    const room = rooms.get(row.id);
    const t = rooms.tickets.take(g.wsTicket);
    const entry = t ? room?.lobby.get(t.guestId) : undefined;
    if (!room || !entry) throw new Error("ticket geçersiz");
    const peer = fakePeer();
    rooms.attachGuest(room, entry, peer);
    return { room, entry, peer };
  };
  return { clock, rooms, rowOf, ticketed, join };
}

describe("P13b-L Rooms lobi sayımı", () => {
  it("AC-305: LOBBY_MAX tek kaynak (sözleşme LOBBY_GUEST_MAX = 3)", () => {
    expect(LOBBY_MAX).toBe(LOBBY_GUEST_MAX);
    expect(LOBBY_GUEST_MAX).toBe(3);
  });

  it("AC-305: oda yok → 0; TICKETED sayılmaz; 1 ve 3 LOBBY misafir", () => {
    const { rooms, rowOf, ticketed, join } = setup();
    const row = rowOf("T1", "U1");
    expect(waitingIn(rooms, row.id)).toBe(0);
    expect(waitingFor(rooms, "T1", "U1")).toEqual([]);
    ticketed(row, "198.51.100.1");
    expect(waitingIn(rooms, row.id)).toBe(0);
    expect(waitingFor(rooms, "T1", "U1")).toEqual([]);
    join(row, "198.51.100.2");
    expect(waitingIn(rooms, row.id)).toBe(1);
    const row3 = rowOf("T1", "U1");
    join(row3, "198.51.100.3");
    join(row3, "198.51.100.4");
    join(row3, "198.51.100.5");
    expect(waitingIn(rooms, row3.id)).toBe(3);
    expect(waitingFor(rooms, "T1", "U1").find((s) => s.id === row3.id)).toEqual({ id: row3.id, waiting: 3, arrivals: 3 });
  });

  it("AC-305: ayrılma (detach), ret (rejected) ve 5 dk zaman aşımı sayıyı düşürür", () => {
    const { clock, rooms, rowOf, join } = setup();
    const row = rowOf("T1", "U1", 60 * 60_000);
    const a = join(row, "198.51.100.10");
    const b = join(row, "198.51.100.11");
    const c = join(row, "198.51.100.12");
    expect(waitingIn(rooms, row.id)).toBe(3);
    rooms.detachGuest(a.room, a.entry, a.peer);
    expect(waitingIn(rooms, row.id)).toBe(2);
    rooms.leaveLobby(b.room, b.entry, "rejected", "rejected");
    expect(waitingIn(rooms, row.id)).toBe(1);
    expect(c.entry.state).toBe("LOBBY");
    clock.advance(5 * 60_000);
    expect(waitingIn(rooms, row.id)).toBe(0);
    expect(waitingFor(rooms, "T1", "U1")).toEqual([]);
  });

  it("AC-305: kabul edilmiş oda (admitted) lobide kalan olsa da 0", () => {
    const { rooms, rowOf, join } = setup();
    const row = rowOf("T1", "U1");
    const a = join(row, "198.51.100.20");
    join(row, "198.51.100.21");
    a.room.admitted = a.entry;
    a.room.lobby.delete(a.entry.id);
    expect(waitingIn(rooms, row.id)).toBe(0);
    expect(waitingFor(rooms, "T1", "U1")).toEqual([]);
  });

  it("AC-305: iptal (RoomNotifier.closeSession) ve kapanmakta olan oda (ending) → 0", () => {
    const { rooms, rowOf, join } = setup();
    const r1 = rowOf("T1", "U1");
    const r2 = rowOf("T1", "U1");
    join(r1, "198.51.100.30");
    const x = join(r2, "198.51.100.31");
    rooms.closeSession(r1.id, "cancelled");
    expect(waitingIn(rooms, r1.id)).toBe(0);
    x.room.ending = true;
    expect(waitingIn(rooms, r2.id)).toBe(0);
    expect(waitingFor(rooms, "T1", "U1")).toEqual([]);
  });

  it("AC-305: expiresAt geçmiş (süpürücü henüz kapatmamış) oda sayılmaz", () => {
    const { clock, rooms, rowOf, join } = setup();
    const row = rowOf("T1", "U1", 60_000);
    join(row, "198.51.100.40");
    expect(waitingIn(rooms, row.id)).toBe(1);
    clock.advance(60_000);
    expect(rooms.get(row.id)).toBeDefined();
    expect(waitingIn(rooms, row.id)).toBe(0);
    expect(waitingFor(rooms, "T1", "U1")).toEqual([]);
  });

  it("AC-307 (sunucu yüzü): arrivals monoton — çık + gir → waiting aynı, arrivals +1", () => {
    const { rooms, rowOf, join } = setup();
    const row = rowOf("T1", "U1");
    const keep = join(row, "198.51.100.50");
    const a = join(row, "198.51.100.51");
    expect(waitingFor(rooms, "T1", "U1")).toEqual([{ id: row.id, waiting: 2, arrivals: 2 }]);
    rooms.detachGuest(a.room, a.entry, a.peer);
    join(row, "198.51.100.52");
    expect(waitingFor(rooms, "T1", "U1")).toEqual([{ id: row.id, waiting: 2, arrivals: 3 }]);
    expect(keep.entry.state).toBe("LOBBY");
  });

  it("AC-305: talepten doğan ön-kabullü misafir (TICKETED, requestId) sayılmaz", () => {
    const { rooms, rowOf } = setup();
    const row = rowOf("T1", "U1");
    rooms.preAdmitGuest(row, { requestId: newId(), kind: "AGENT", name: "Ayşe Yılmaz", clientVersion: "1.0.0", consent });
    expect(rooms.get(row.id)?.lobby.size).toBe(1);
    expect(waitingIn(rooms, row.id)).toBe(0);
    expect(waitingFor(rooms, "T1", "U1")).toEqual([]);
  });

  it("AC-309: waitingFor yalnız tenant + teknisyen eşleşen odalar, id'ye göre sıralı", () => {
    const { rooms, rowOf, join } = setup();
    const mine = [rowOf("T1", "U1"), rowOf("T1", "U1"), rowOf("T1", "U1")];
    for (const [i, r] of mine.entries()) join(r, `198.51.100.${60 + i}`);
    join(rowOf("T1", "U2"), "198.51.100.70"); // aynı tenant, başka teknisyen
    join(rowOf("T2", "U1"), "198.51.100.71"); // aynı kullanıcı id'si, başka tenant (savunma)
    const got = waitingFor(rooms, "T1", "U1");
    expect(got.map((s) => s.id)).toEqual(mine.map((r) => r.id).sort());
    expect(waitingFor(rooms, "T1", "U2")).toHaveLength(1);
    expect(waitingFor(rooms, "T2", "U2")).toEqual([]);
  });

  it("AC-315: yeni Rooms örneği (sunucu yeniden başladı) → 0", () => {
    const first = setup();
    const row = first.rowOf("T1", "U1");
    first.join(row, "198.51.100.80");
    expect(waitingIn(first.rooms, row.id)).toBe(1);
    const restarted = setup();
    expect(waitingIn(restarted.rooms, row.id)).toBe(0);
    expect(waitingFor(restarted.rooms, "T1", "U1")).toEqual([]);
  });
});

describe("P13b-L getWaitingSessions", () => {
  const auth = { user: { id: "U1" } } as AuthContext;

  it("AC-306/311: count = Σ waiting; yanıt strict şemaya uyar, ad yok", () => {
    const { rooms, rowOf, join } = setup();
    const r1 = rowOf("T1", "U1");
    const r2 = rowOf("T1", "U1");
    join(r1, "198.51.100.90");
    join(r2, "198.51.100.91");
    join(r2, "198.51.100.92");
    const out = getWaitingSessions(rooms, auth, "T1");
    expect(out.count).toBe(3);
    expect(waitingSessionsResponseSchema.parse(out)).toEqual(out);
    expect(JSON.stringify(out)).not.toContain("Ayşe");
  });

  it("AC-306: hiç bekleyen yok → { count: 0, sessions: [] }", () => {
    const { rooms } = setup();
    expect(getWaitingSessions(rooms, auth, "T1")).toEqual({ count: 0, sessions: [] });
  });

  it("AC-311: şema ek alanı (ad/e-posta) reddeder", () => {
    const id = newId();
    expect(waitingSessionsResponseSchema.safeParse({ count: 1, sessions: [{ id, waiting: 1, arrivals: 1, name: "X" }] }).success).toBe(
      false,
    );
    expect(waitingSessionsResponseSchema.safeParse({ count: 1, sessions: [{ id, waiting: 1, arrivals: 1 }], email: "a@b" }).success).toBe(
      false,
    );
    expect(waitingSessionsResponseSchema.safeParse({ count: 4, sessions: [{ id, waiting: 4, arrivals: 4 }] }).success).toBe(false);
  });

  it("AC-305/S13L-1: withWaitingGuests — PENDING satırda lobiden, diğerlerinde 0; sessions.view yoksa hep 0", () => {
    const { rooms, rowOf, join } = setup();
    const row = rowOf("T1", "U1");
    join(row, "198.51.100.95");
    const res = {
      items: [
        { id: row.id, status: "PENDING" as const },
        { id: newId(), status: "ENDED" as const },
      ],
      page: 1,
    };
    type Base = Parameters<typeof withWaitingGuests>[0]["items"][number];
    const asBase = res as unknown as { items: Base[]; page: number };
    const withView = { user: { id: "U1" }, permissions: new Set(["sessions.view"]) } as unknown as AuthContext;
    const histOnly = { user: { id: "U1" }, permissions: new Set(["session_history.view"]) } as unknown as AuthContext;
    expect(withWaitingGuests(asBase, rooms, withView).items.map((i) => i.waitingGuests)).toEqual([1, 0]);
    expect(withWaitingGuests(asBase, rooms, histOnly).items.map((i) => i.waitingGuests)).toEqual([0, 0]);
    expect(withWaitingGuests(asBase, rooms, withView).page).toBe(1);
  });
});
