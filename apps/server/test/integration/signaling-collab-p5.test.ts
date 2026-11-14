// P5 konsol işbirliği sinyalleri (gerçek MySQL): file.meta → session_files + audit (AC-55, AC-117, AC-119),
// quality.summary → support_sessions.quality_summary (AC-46), hello.maxFileMb (AC-53). mimari-protokol §3, db-notlari P5.
import type { FileMeta } from "@remote/contracts/ws";
import { afterEach, describe, expect, it } from "vitest";
import { admitGuest } from "../../src/signaling/admit.ts";
import { FILE_META_ACCEPTED_PER_MIN, FILE_META_PER_MIN, FILE_META_SENDER_PER_MIN, FILE_META_SENDER_PER_SESSION, handleFileMeta, handleQualitySummary } from "../../src/signaling/collab.ts";
import { TokenBucket, onGuestMessage, onTechMessage } from "../../src/signaling/handlers.ts";
import type { Rooms } from "../../src/signaling/rooms.ts";
import { testDb } from "../helpers/app.ts";
import { admitted, startLive, techSession, type Live } from "../helpers/signal-flow.ts";
import { FakeClock, makeRooms, roomFixture } from "../helpers/ws.ts";

const SHA = "ab".repeat(32);
const meta = (o: Partial<FileMeta> = {}): FileMeta => ({ t: "file.meta", direction: "TO_CUSTOMER", fileName: "rapor.pdf", sizeBytes: 2048, sha256: SHA, result: "OK", ...o });
const files = (sessionId: string) => testDb().sessionFile.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
const QS = { fps: { avg: 24, min: 10, max: 30 }, kbps: { avg: 2000, min: 500, max: 4000 }, rttMs: { avg: 40, min: 20, max: 90 }, connType: "relay" as const };

async function active(rooms: Rooms, perms: Parameters<typeof roomFixture>[1] = ["sessions.create", "remote_control.use", "file_transfer.use"]) {
  const fx = await roomFixture(rooms, perms);
  const g = fx.guest();
  expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
  return { ...fx, g };
}

let live: Live | undefined;
afterEach(async () => live?.close());

describe("P5 file.meta", () => {
  it("AC-55: alıcı raporu session_files + audit (aynı TX); içerik yok; gönderen raporu session_files'a yazılmaz", async () => {
    const rooms = makeRooms();
    const fx = await active(rooms);
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, meta())).toBe("recorded");
    expect(await handleFileMeta(rooms, fx.room, { side: "tech", peer: fx.techPeer }, meta())).toBe("sender_reported"); // gönderen
    expect(await handleFileMeta(rooms, fx.room, { side: "tech", peer: fx.techPeer }, meta({ direction: "TO_TECH", result: "CORRUPT", fileName: "log.zip" }))).toBe("recorded");
    const rows = await files(fx.session.id);
    expect(rows.map((r) => [r.direction, r.fileName, Number(r.sizeBytes), r.result, r.tenantId])).toEqual([
      ["TO_CUSTOMER", "rapor.pdf", 2048, "OK", fx.tenant.id],
      ["TO_TECH", "log.zip", 2048, "CORRUPT", fx.tenant.id],
    ]);
    const audits = await testDb().auditLog.findMany({ where: { tenantId: fx.tenant.id, action: "file.transfer" }, orderBy: { id: "asc" } });
    expect(audits.map((a) => [a.entityId, a.username, a.result])).toEqual([
      [rows[0]?.id, "customer", "success"],
      [rows[1]?.id, fx.user.email, "fail"],
    ]);
    // S-P13a-8: ad ve sha256 yalnız session_files'ta (saklama işiyle silinir); audit'te uzantı + boyut + yön
    expect(audits.map((a) => a.newValue)).toEqual([
      { sessionId: fx.session.id, direction: "TO_CUSTOMER", ext: "pdf", sizeBytes: "2048", result: "OK" },
      { sessionId: fx.session.id, direction: "TO_TECH", ext: "zip", sizeBytes: "2048", result: "CORRUPT" },
    ]);
    const text = JSON.stringify(audits.map((a) => a.newValue));
    for (const raw of ["rapor", "log.zip", SHA]) expect(text).not.toContain(raw);
  });

  it("AC-117: kötü ad sunucuda temizlenir (yol, RTLO, ayrılmış ad) — DB CHECK ihlali olmaz", async () => {
    const rooms = makeRooms();
    const fx = await active(rooms);
    for (const fileName of ["..\\..\\Windows\\evil.dll", "fatura‮txt.exe", "CON.txt", "a:b*c?.txt", "...", "x".repeat(255)]) {
      expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, meta({ fileName }))).toBe("recorded");
    }
    expect((await files(fx.session.id)).map((r) => r.fileName)).toEqual(["evil.dll", "faturatxt.exe", "_CON.txt", "abc.txt", "dosya", "x".repeat(255)]);
  });

  it("AC-119: caps.file_transfer kapalı (yetkisiz teknisyen) → FORBIDDEN, kayıt yok; hello.caps file_transfer içermez", async () => {
    const rooms = makeRooms();
    const fx = await active(rooms, ["sessions.create", "remote_control.use"]);
    expect(fx.g.peer.of("hello")[0]?.caps).toEqual(["remote_control"]);
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, meta())).toBe("forbidden");
    expect(fx.g.peer.of("error").at(-1)?.code).toBe("FORBIDDEN");
    expect(await files(fx.session.id)).toHaveLength(0);
  });

  it("AC-53: hello/peer.joined maxFileMb = tenant ayarı; OK raporu sınırı aşarsa reddedilir", async () => {
    const rooms = makeRooms();
    const fx = await active(rooms);
    const mb = (await testDb().tenantSettings.findUniqueOrThrow({ where: { tenantId: fx.tenant.id } })).maxFileMb;
    expect(fx.g.peer.of("hello")[0]?.maxFileMb).toBe(mb);
    expect(fx.techPeer.of("peer.joined")[0]?.maxFileMb).toBe(mb);
    expect(fx.g.peer.of("hello")[0]?.caps).toEqual(["remote_control", "file_transfer"]);
    const over = mb * 1024 * 1024 + 1;
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, meta({ sizeBytes: over }))).toBe("too_large");
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, meta({ sizeBytes: over, result: "CANCELLED" }))).toBe("recorded");
  });

  it("oturum başı hız sınırı: ret/iptal dakikada 20 → RATE_LIMITED; pencere dolunca yeniden kabul", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await active(rooms);
    const rej = meta({ result: "REJECTED" });
    for (let i = 0; i < FILE_META_PER_MIN; i++) expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, rej)).toBe("recorded");
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, rej)).toBe("rate_limited");
    expect(fx.g.peer.of("error").at(-1)?.code).toBe("RATE_LIMITED");
    clock.advance(60_000);
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, rej)).toBe("recorded");
    expect(await files(fx.session.id)).toHaveLength(FILE_META_PER_MIN + 1);
  });

  it("S-P5-1/AC-55: 21 ret (kota dolu) + OK → OK kaydı yazılır; rate_limited audit oda+sınıf başına dakikada 1", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await active(rooms);
    const guest = { side: "guest" as const, peer: fx.g.peer };
    for (let i = 0; i < FILE_META_PER_MIN; i++) await handleFileMeta(rooms, fx.room, guest, meta({ result: "REJECTED", fileName: `sahte${i}.exe` }));
    for (let i = 0; i < 3; i++) expect(await handleFileMeta(rooms, fx.room, guest, meta({ result: "CANCELLED" }))).toBe("rate_limited");
    expect(await handleFileMeta(rooms, fx.room, guest, meta({ fileName: "gercek.exe" }))).toBe("recorded");
    const rows = await files(fx.session.id);
    expect(rows.at(-1)?.fileName).toBe("gercek.exe");
    expect(rows.filter((r) => r.result === "OK")).toHaveLength(1);
    const limited = () => testDb().auditLog.findMany({ where: { tenantId: fx.tenant.id, action: "file.meta.rate_limited" }, orderBy: { id: "asc" } });
    expect((await limited()).map((a) => [a.entityId, a.result, a.newValue])).toEqual([[fx.session.id, "fail", { sessionId: fx.session.id, side: "guest", class: "declined" }]]);
    // kabul sınıfının kendi kotası: 60/dk; aşımında o sınıf için ayrı tek audit satırı
    for (let i = 1; i < FILE_META_ACCEPTED_PER_MIN; i++) expect(await handleFileMeta(rooms, fx.room, guest, meta({ result: "CORRUPT" }))).toBe("recorded");
    expect(await handleFileMeta(rooms, fx.room, guest, meta())).toBe("rate_limited");
    expect(await handleFileMeta(rooms, fx.room, guest, meta())).toBe("rate_limited");
    expect((await limited()).map((a) => (a.newValue as { class: string }).class)).toEqual(["declined", "accepted"]);
    clock.advance(60_000);
    expect(await handleFileMeta(rooms, fx.room, guest, meta())).toBe("recorded");
  });

  it("S-P5-1: teknisyenin (gönderen) rapor seli müşterinin (alıcı) kotasını tüketmez", async () => {
    const rooms = makeRooms();
    const fx = await active(rooms);
    for (let i = 0; i < FILE_META_SENDER_PER_MIN; i++) expect(await handleFileMeta(rooms, fx.room, { side: "tech", peer: fx.techPeer }, meta())).toBe("sender_reported");
    expect(await handleFileMeta(rooms, fx.room, { side: "tech", peer: fx.techPeer }, meta())).toBe("rate_limited");
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, meta())).toBe("recorded");
  });

  it("S-P5-T2-2: teknisyen ve müşteri aynı dakikada aynı sınıfta kota aşarsa iki ayrı rate_limited audit satırı", async () => {
    const rooms = makeRooms(new FakeClock());
    const fx = await active(rooms);
    const tech = { side: "tech" as const, peer: fx.techPeer };
    const guest = { side: "guest" as const, peer: fx.g.peer };
    const techRej = meta({ direction: "TO_TECH", result: "REJECTED" }); // teknisyen alıcı → declined
    const guestRej = meta({ result: "REJECTED" }); // müşteri alıcı → declined
    for (let i = 0; i < FILE_META_PER_MIN; i++) expect(await handleFileMeta(rooms, fx.room, tech, techRej)).toBe("recorded");
    expect(await handleFileMeta(rooms, fx.room, tech, techRej)).toBe("rate_limited");
    expect(await handleFileMeta(rooms, fx.room, tech, techRej)).toBe("rate_limited"); // aynı taraf+sınıf: seyreltilir
    for (let i = 0; i < FILE_META_PER_MIN; i++) expect(await handleFileMeta(rooms, fx.room, guest, guestRej)).toBe("recorded");
    expect(await handleFileMeta(rooms, fx.room, guest, guestRej)).toBe("rate_limited");
    const a = await testDb().auditLog.findMany({ where: { tenantId: fx.tenant.id, action: "file.meta.rate_limited" }, orderBy: { id: "asc" } });
    expect(a.map((x) => [x.username, x.newValue])).toEqual([
      [fx.user.email, { sessionId: fx.session.id, side: "tech", class: "declined" }],
      ["customer", { sessionId: fx.session.id, side: "guest", class: "declined" }],
    ]);
  });

  it("S-P5-T2-3: gönderen raporu ayrı düşük kota (10/dk, 200/oturum); aşım audit'i seyreltilir, metrik sayılır; alıcı kotası etkilenmez", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await active(rooms);
    const tech = { side: "tech" as const, peer: fx.techPeer };
    const guest = { side: "guest" as const, peer: fx.g.peer };
    // sonuçtan bağımsız tek sınıf: OK ve REJECTED gönderen raporları aynı kotayı paylaşır
    for (let i = 0; i < FILE_META_SENDER_PER_MIN; i++) expect(await handleFileMeta(rooms, fx.room, tech, meta({ result: i % 2 ? "OK" : "REJECTED" }))).toBe("sender_reported");
    expect(await handleFileMeta(rooms, fx.room, tech, meta())).toBe("rate_limited");
    expect(await handleFileMeta(rooms, fx.room, tech, meta({ result: "CANCELLED" }))).toBe("rate_limited");
    expect(fx.techPeer.of("error").at(-1)?.code).toBe("RATE_LIMITED");
    // teknisyenin alıcı (TO_TECH) kotası ve müşterinin alıcı/gönderen kotaları ayrı
    expect(await handleFileMeta(rooms, fx.room, tech, meta({ direction: "TO_TECH" }))).toBe("recorded");
    expect(await handleFileMeta(rooms, fx.room, guest, meta())).toBe("recorded");
    expect(await handleFileMeta(rooms, fx.room, guest, meta({ direction: "TO_TECH" }))).toBe("sender_reported");
    const limited = () => testDb().auditLog.findMany({ where: { tenantId: fx.tenant.id, action: "file.meta.rate_limited" }, orderBy: { id: "asc" } });
    expect((await limited()).map((x) => x.newValue)).toEqual([{ sessionId: fx.session.id, side: "tech", class: "sender" }]);
    expect(rooms.metrics.render()).toContain('rs_file_meta_rate_limited_total{class="sender"} 2');
    // oturum tavanı: 200 gönderen raporundan sonra pencere yenilense de reddedilir
    let sent = FILE_META_SENDER_PER_MIN;
    while (sent < FILE_META_SENDER_PER_SESSION) {
      clock.advance(60_000);
      for (let i = 0; i < FILE_META_SENDER_PER_MIN; i++, sent++) expect(await handleFileMeta(rooms, fx.room, tech, meta())).toBe("sender_reported");
    }
    clock.advance(60_000);
    expect(await handleFileMeta(rooms, fx.room, tech, meta())).toBe("rate_limited");
    expect(await testDb().auditLog.count({ where: { tenantId: fx.tenant.id, action: "file.transfer.sender_report", userId: fx.user.id } })).toBe(FILE_META_SENDER_PER_SESSION);
    expect((await limited()).map((x) => (x.newValue as { class: string }).class)).toEqual(["sender", "sender"]);
    expect(await files(fx.session.id)).toHaveLength(2); // yalnız alıcı raporları
  });

  it("S-P5-3: TO_TECH'te müşteri (gönderen) raporu audit'e yazılır, session_files'a yazılmaz; teknisyen raporlamasa da iz kalır", async () => {
    const rooms = makeRooms();
    const fx = await active(rooms);
    const m = meta({ direction: "TO_TECH", fileName: "..\\musteri\\log.zip", sizeBytes: 4096 });
    expect(await handleFileMeta(rooms, fx.room, { side: "guest", peer: fx.g.peer }, m)).toBe("sender_reported");
    expect(await files(fx.session.id)).toHaveLength(0);
    const a = await testDb().auditLog.findMany({ where: { tenantId: fx.tenant.id, action: "file.transfer.sender_report" } });
    expect(a.map((x) => [x.username, x.entity, x.entityId, x.result, x.newValue])).toEqual([
      // S-P13a-8: audit'te dosya adı ve sha256 yok; yalnız uzantı
      ["customer", "support_sessions", fx.session.id, "success", { sessionId: fx.session.id, direction: "TO_TECH", ext: "zip", sizeBytes: "4096", result: "OK" }],
    ]);
  });

  it("tenant izolasyonu: kayıt odanın tenant'ına yazılır; başka tenant'ın oturumu etkilenmez", async () => {
    const rooms = makeRooms();
    const a = await active(rooms);
    const b = await active(rooms);
    await handleFileMeta(rooms, a.room, { side: "guest", peer: a.g.peer }, meta({ fileName: "a.txt" }));
    expect(await files(b.session.id)).toHaveLength(0);
    expect(await testDb().sessionFile.count({ where: { tenantId: b.tenant.id } })).toBe(0);
    expect((await files(a.session.id))[0]?.tenantId).toBe(a.tenant.id);
  });

  it("AC-18: geçersiz file.meta (büyük harf sha, ekstra alan) → 1008; lobi misafiri file.meta → 1008", async () => {
    const rooms = makeRooms();
    const fx = await active(rooms);
    await onTechMessage(rooms, fx.room, fx.techPeer, new TokenBucket(rooms.clock), Buffer.from(JSON.stringify({ ...meta(), sha256: "AB".repeat(32) })), false);
    expect(fx.techPeer.closed?.code).toBe(1008);
    const rooms2 = makeRooms();
    const fx2 = await roomFixture(rooms2, ["sessions.create", "file_transfer.use"]);
    const lobbyGuest = fx2.guest();
    await onGuestMessage(rooms2, fx2.room, lobbyGuest.entry, lobbyGuest.peer, new TokenBucket(rooms2.clock), Buffer.from(JSON.stringify(meta())), false);
    expect(lobbyGuest.peer.closed?.code).toBe(1008);
    expect(await files(fx2.session.id)).toHaveLength(0);
  });
});

describe("P5 quality.summary", () => {
  it("AC-46: ACTIVE oturuma yazılır, periyodik üzerine yazar; 5 sn içinde ikinci özet DB'ye gitmez", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await active(rooms);
    expect(await handleQualitySummary(rooms, fx.room, QS)).toBe("written");
    expect(await handleQualitySummary(rooms, fx.room, { ...QS, connType: "host" })).toBe("throttled");
    clock.advance(60_000);
    expect(await handleQualitySummary(rooms, fx.room, { ...QS, connType: "srflx" })).toBe("written");
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: fx.session.id } });
    expect(row.qualitySummary).toEqual({ ...QS, connType: "srflx" });
  });

  it("AC-46: PENDING (admit öncesi) oturumda yazılmaz", async () => {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms);
    expect(await handleQualitySummary(rooms, fx.room, QS)).toBe("not_active");
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: fx.session.id } })).qualitySummary).toBeNull();
  });
});

describe("P5 gerçek WS", () => {
  it("AC-55/AC-46: misafir file.meta ve teknisyen quality.summary WS üzerinden DB'ye yazılır", async () => {
    live = await startLive();
    const t = await techSession(live);
    const { guest, hello } = await admitted(live, t);
    expect(hello.caps).toContain("file_transfer");
    expect(hello.maxFileMb).toBeGreaterThan(0);
    guest.send(meta({ fileName: "../gizli/ekran.png" }));
    t.ws.send({ t: "quality.summary", ...QS });
    for (let i = 0; i < 50; i++) {
      const [f, s] = await Promise.all([files(t.sessionId), testDb().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })]);
      if (f.length === 1 && s.qualitySummary) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await files(t.sessionId)).map((r) => r.fileName)).toEqual(["ekran.png"]);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })).qualitySummary).toEqual(QS);
    guest.ws.close();
  });
});
