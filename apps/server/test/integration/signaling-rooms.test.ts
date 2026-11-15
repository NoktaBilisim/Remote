// P3 oda/lobi/admit testleri (gerçek MySQL, sahte Peer + sahte saat). mimari-protokol §3.1, §3.2; AC-6, 7, 13, 24, 25, 112, 113.
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../src/auth/session.ts";
import * as repo from "../../src/sessions/repo.ts";
import { cancelSession } from "../../src/sessions/service.ts";
import { admitGuest, rejectGuest } from "../../src/signaling/admit.ts";
import { createSupportSessionRow, createTenant, createUser, testDb } from "../helpers/app.ts";
import { FakeClock, makeRooms, roomFixture } from "../helpers/ws.ts";

const status = async (id: string) => (await testDb().supportSession.findUniqueOrThrow({ where: { id } })).status;
const audits = (id: string, action: string) => testDb().auditLog.count({ where: { entityId: id, action } });
const consents = (sessionId: string) => testDb().sessionConsent.count({ where: { sessionId } });

function authOf(u: { id: string; email: string; username: string }, tenantId: string): AuthContext {
  return {
    sessionId: "s",
    expiresAt: new Date(Date.now() + 3_600_000),
    tenantId,
    tenant: null,
    actingTenant: null,
    mfaStage: "ok" as const,
    mfaRequired: false,
    totpEnabled: false,
    logoPath: null,
    permissions: new Set(["sessions.delete"]),
    user: {
      id: u.id,
      email: u.email,
      username: u.username,
      fullName: "T",
      role: "USER",
      tenantId,
      theme: "SYSTEM",
      avatarUrl: null,
      mustChangePassword: false,
    },
  };
}

describe("P3 lobi + admit (oda katmanı)", () => {
  it("AC-112: admit öncesi misafire hello/iceServers yok; doğru kodla ACTIVE + hello{iceServers, reconnectToken, caps}", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms);
    const g = fx.guest();
    expect(g.peer.of("lobby.wait")).toHaveLength(1);
    expect(g.peer.of("hello")).toHaveLength(0);
    expect(fx.techPeer.of("peer.pending")[0]).toMatchObject({ guestId: g.guestId, name: "Ayşe Müşteri", guestKind: "BROWSER" });
    expect(fx.techPeer.of("hello")[0]).toMatchObject({ role: "tech", iceServers: [], maxEndsAt: null });

    expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
    const hello = g.peer.of("hello")[0];
    expect(hello?.iceServers.some((s) => s.username && s.credential)).toBe(true);
    expect(hello?.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hello?.caps).toEqual(["remote_control"]);
    expect(fx.techPeer.of("peer.joined")[0]).toMatchObject({ role: "guest", guestKind: "BROWSER" });
    expect(fx.techPeer.of("ice.servers")).toHaveLength(1);
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    expect(row).toMatchObject({ status: "ACTIVE", activeCode: null, mode: "BROWSER" });
    expect(await audits(fx.session.id, "guest.admitted")).toBe(1);
  });

  it("AC-112/G-01: teknisyen admit sonrası ice.servers'ı (TURN'lü) peer.joined'dan ÖNCE alır — ilk teklif TURN'süz üretilmez", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms);
    const g = fx.guest();
    expect(fx.techPeer.of("ice.servers")).toHaveLength(0); // G-01: admit öncesi ICE yok
    expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
    const order = fx.techPeer.sent.map((m) => m.t);
    const iceAt = order.indexOf("ice.servers");
    expect(iceAt).toBeGreaterThanOrEqual(0);
    expect(iceAt).toBeLessThan(order.indexOf("peer.joined"));
    expect(fx.techPeer.of("ice.servers")[0]?.iceServers.some((s) => s.username && s.credential)).toBe(true);
  });

  it("AC-112: yanlış kod ADMIT_CODE_INVALID + audit; 5. hatada lobi boşalır", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms);
    const g = fx.guest();
    const wrong = g.admitCode === "0000" ? "1111" : "0000";
    for (let i = 0; i < 4; i++) expect(await admitGuest(rooms, fx.room, fx.tech, wrong)).toBe("invalid");
    expect(g.peer.closed).toBeNull();
    expect(await admitGuest(rooms, fx.room, fx.tech, wrong)).toBe("invalid");
    expect(g.peer.of("session.ended")[0]?.reason).toBe("rejected");
    expect(fx.room.lobby.size).toBe(0);
    expect(await audits(fx.session.id, "guest.admit")).toBe(5);
    expect(await status(fx.session.id)).toBe("PENDING");
  });

  it("AC-112: lobi en çok 3 misafir (4. join LOBBY_FULL); kabul edilmeyenler rejected ile düşer", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms);
    const [g0, g1, g2] = [fx.guest("198.51.100.1"), fx.guest("198.51.100.2"), fx.guest("198.51.100.3")];
    expect(new Set([g0.admitCode, g1.admitCode, g2.admitCode]).size).toBe(3);
    expect(() => rooms.addGuest(fx.row, { name: "X", kind: "BROWSER", ipKey: "198.51.100.4", consent: fx.consent })).toThrow(
      expect.objectContaining({ code: "LOBBY_FULL" }),
    );
    expect(await admitGuest(rooms, fx.room, fx.tech, g1.admitCode)).toBe("admitted");
    expect(g0.peer.of("session.ended")[0]?.reason).toBe("rejected");
    expect(g2.peer.of("session.ended")[0]?.reason).toBe("rejected");
    expect(g1.peer.of("hello")).toHaveLength(1);
  });

  it("AC-113: ret → misafire rejected, ipKey ret listesinde (join 403), kod geçerli, oturum PENDING", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms);
    const g = fx.guest("192.0.2.9");
    await rejectGuest(rooms, fx.room, fx.tech, g.guestId);
    expect(g.peer.of("session.ended")[0]?.reason).toBe("rejected");
    expect(fx.techPeer.of("peer.pending.left")[0]).toMatchObject({ guestId: g.guestId, reason: "rejected" });
    expect(() => rooms.addGuest(fx.row, { name: "Y", kind: "BROWSER", ipKey: "192.0.2.9", consent: fx.consent })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    const other = fx.guest("192.0.2.10");
    expect(await admitGuest(rooms, fx.room, fx.tech, other.admitCode)).toBe("admitted");
    expect(await audits(fx.session.id, "guest.rejected")).toBe(1);
  });

  it("§3.1: lobi misafiri 5 dk sonra lobby_timeout; ticket 60 sn içinde kullanılmazsa lobiden düşer", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await roomFixture(rooms);
    const g = fx.guest();
    rooms.addGuest(fx.row, { name: "Z", kind: "AGENT", ipKey: "203.0.113.50", consent: fx.consent }); // WS'e hiç bağlanmaz
    expect(fx.room.lobby.size).toBe(2);
    clock.advance(61_000);
    expect(fx.room.lobby.size).toBe(1);
    clock.advance(5 * 60_000);
    expect(g.peer.of("session.ended")[0]?.reason).toBe("lobby_timeout");
    expect(fx.techPeer.of("peer.pending.left").at(-1)).toMatchObject({ reason: "timeout" });
  });
});

/** QA-P8b-1: 50 turlu DB yarışları yük altında (eşzamanlı e2e) 20 sn varsayılanı aşabiliyor; tur başı ~1 sn pay. */
const LOOP_TIMEOUT = 60_000;

describe("P3 giriş şartı 2 — atomik tüketim yarışları (mimari-protokol §3.2)", () => {
  it(
    "AC-7: repo admit‖admit 50 kez → her turda tam bir kazanan",
    async () => {
      const t = await createTenant();
      const u = await createUser({ tenantId: t.id });
      for (let i = 0; i < 50; i++) {
        const s = await createSupportSessionRow({ tenantId: t.id, technicianId: u.id });
        const now = new Date();
        const counts = await Promise.all([
          repo.consumeForAdmit(testDb(), s.id, now, "BROWSER", { name: "Ayşe", email: null }),
          repo.consumeForAdmit(testDb(), s.id, now, "AGENT", { name: "Ali Veli", email: null }),
        ]);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
      }
    },
    LOOP_TIMEOUT,
  );

  it(
    "AC-7: oda admit‖admit 50 kez → tek admitted, tek guest.admitted audit'i, kaybedene CONFLICT",
    async () => {
      for (let i = 0; i < 50; i++) {
        const rooms = makeRooms();
        const fx = await roomFixture(rooms);
        const g = fx.guest();
        const r = await Promise.all([admitGuest(rooms, fx.room, fx.tech, g.admitCode), admitGuest(rooms, fx.room, fx.tech, g.admitCode)]);
        expect(r.filter((x) => x === "admitted")).toHaveLength(1);
        expect(r.filter((x) => x === "conflict")).toHaveLength(1);
        expect(await audits(fx.session.id, "guest.admitted")).toBe(1);
        expect(fx.techPeer.of("error").map((e) => e.code)).toEqual(["CONFLICT"]);
        expect(await consents(fx.session.id)).toBe(1); // P4 AC-29: kaybeden admit consent yazmaz
      }
    },
    LOOP_TIMEOUT,
  );

  it(
    "AC-6/AC-8: admit‖cancel 50 kez → tek kazanan; iptal kazanırsa misafire cancelled, admit audit'i yok",
    async () => {
      for (let i = 0; i < 50; i++) {
        const rooms = makeRooms();
        const fx = await roomFixture(rooms);
        const g = fx.guest();
        const ctx = { ip: "10.0.0.2", userAgent: "t", requestId: "r" };
        const [a, c] = await Promise.allSettled([
          admitGuest(rooms, fx.room, fx.tech, g.admitCode),
          cancelSession(testDb(), ctx, authOf(fx.user, fx.tenant.id), fx.tenant.id, fx.session.id, rooms),
        ]);
        const st = await status(fx.session.id);
        const adm = a.status === "fulfilled" && a.value === "admitted";
        expect(adm).toBe(st === "ACTIVE");
        expect(c.status === "fulfilled").toBe(st === "CANCELLED");
        expect(await audits(fx.session.id, "guest.admitted")).toBe(adm ? 1 : 0);
        expect(await consents(fx.session.id)).toBe(adm ? 1 : 0); // P4: TX geri alınınca onay kaydı yok
        if (!adm) expect(g.peer.of("session.ended")[0]?.reason).toBe("cancelled");
      }
    },
    LOOP_TIMEOUT,
  );

  it("AC-5/7: süresi dolmuş oturumda admit count=0 → misafire timeout, teknisyene CONFLICT", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms);
    const g = fx.guest();
    await testDb().supportSession.update({
      where: { id: fx.session.id },
      data: { createdAt: new Date(Date.now() - 20 * 60_000), expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("conflict");
    expect(g.peer.of("session.ended")[0]?.reason).toBe("timeout");
    expect(await status(fx.session.id)).toBe("PENDING");
    expect(fx.techPeer.of("error").map((e) => e.code)).toEqual(["CONFLICT"]);
  });
});
