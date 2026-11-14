// P13a güvenlik turu 1 (S-P13a-1, S-P13a-5; docs/guvenlik-raporu.md "P13a turu"). Müşteri aktörlü audit kayıtları
// (730 gün) müşteri adını, tam IP'yi ve tarayıcı bilgisini taşımaz; zaman çizelgesi adı oturum satırından alır.
// Gerçek MySQL (TEST_DATABASE_URL, app).
import type { SessionHistoryDetail } from "@remote/contracts/api/sessions";
import { afterEach, describe, expect, it } from "vitest";
import { writeAudit } from "../../src/audit/service.ts";
import { newId } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, loginAs, testDb } from "../helpers/app.ts";
import { admitted, joinGuest, startLive, techSession, type Live } from "../helpers/signal-flow.ts";

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };

/** Geçmiş detayı (teknisyen rolünde session_history yetkisi yok → aynı tenant'ın Admin'i). */
async function historyOf(l: Live, tenantId: string, sessionId: string): Promise<SessionHistoryDetail> {
  const s = await loginAs(l.app, await createUser({ tenantId, role: "ADMIN" }));
  const r = await l.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/history`, headers: s.headers });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<SessionHistoryDetail>();
}

describe("S-P13a-1 müşteri audit kayıtlarında ad / tam IP / UA yok", () => {
  it("S-P13a-1: writeAudit — customer aktöründe IPv4 /24, IPv6 /48 öneki ve UA NULL; çalışan kaydı değişmez", async () => {
    const t = await createTenant();
    const write = (username: string, ip: string) =>
      writeAudit(testDb(), { ip, userAgent: "Mozilla/5.0 (Windows NT 10.0)", requestId: newId() }, { tenantId: t.id, username, action: "p13a.customer", entity: "support_sessions", entityId: newId(), result: "success" });
    await write("customer", "203.0.113.77");
    await write("customer", "2001:db8:1234:5678::9");
    await write("customer", "::ffff:198.51.100.9");
    await write("tech@example.test", "198.51.100.5");
    const rows = await testDb().auditLog.findMany({ where: { tenantId: t.id, action: "p13a.customer" }, orderBy: { id: "asc" }, select: { username: true, ipAddress: true, userAgent: true } });
    expect(rows).toEqual([
      { username: "customer", ipAddress: "203.0.113.0/24", userAgent: null },
      { username: "customer", ipAddress: "2001:0db8:1234::/48", userAgent: null },
      { username: "customer", ipAddress: "198.51.100.0/24", userAgent: null },
      { username: "tech@example.test", ipAddress: "198.51.100.5", userAgent: "Mozilla/5.0 (Windows NT 10.0)" },
    ]);
  });

  it("S-P13a-1: gerçek akış (resolve → join → admit) — guest.pending/admitted adı taşımaz, müşteri IP'si önek, UA yok; zaman çizelgesi adı oturumdan gösterir", async () => {
    live = await startLive({ env: PROXY });
    const t = await techSession(live);
    const { guestId } = await admitted(live, t); // joinGuest: x-forwarded-for 203.0.113.20, ad "Ayşe Müşteri"
    const rows = await testDb().auditLog.findMany({ where: { entityId: t.sessionId }, orderBy: { id: "asc" } });
    const pending = rows.find((r) => r.action === "guest.pending");
    const adm = rows.find((r) => r.action === "guest.admitted");
    expect(pending).toMatchObject({ username: "customer", ipAddress: "203.0.113.0/24", userAgent: null });
    expect(pending?.newValue).not.toHaveProperty("name");
    expect(adm?.newValue).not.toHaveProperty("name");
    const text = JSON.stringify(rows, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    expect(text).not.toContain("Ayşe");
    expect(text).not.toContain("203.0.113.20");
    // Oturum satırında ad var (saklama işiyle silinir); zaman çizelgesi oradan
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })).customerName).toBe("Ayşe Müşteri");
    const d = await historyOf(live, t.tenantId, t.sessionId);
    const ev = d.timeline.find((e) => e.action === "guest.pending");
    expect(ev).toMatchObject({ actor: "CUSTOMER", actorName: "Ayşe Müşteri" });
    expect(ev?.details).not.toHaveProperty("name");
    expect(guestId).toBeTruthy();
  });

  it("S-P13a-1: reddedilen misafirin guest.pending satırı kabul edilen müşterinin adını göstermez; guest.rejected adı taşımaz", async () => {
    live = await startLive({ env: PROXY });
    const t = await techSession(live);
    await joinGuest(live, t, "203.0.113.30");
    const first = await t.ws.waitFor("peer.pending");
    t.ws.send({ t: "guest.reject", id: newId(), guestId: first.guestId });
    await expect.poll(() => testDb().auditLog.count({ where: { entityId: t.sessionId, action: "guest.rejected" } })).toBe(1);
    await admitted(live, t);
    const rejected = await testDb().auditLog.findFirstOrThrow({ where: { entityId: t.sessionId, action: "guest.rejected" } });
    expect(rejected.newValue).toEqual({ guestId: first.guestId });
    const d = await historyOf(live, t.tenantId, t.sessionId);
    const pendings = d.timeline.filter((e) => e.action === "guest.pending");
    expect(pendings.map((e) => e.actorName)).toEqual([null, "Ayşe Müşteri"]);
  });
});

describe("S-P13a-5 anonim oturumda sonlandırma gerekçesi", () => {
  it("S-P13a-5: session.terminated.reason anonim oturumda gösterilmez, anonim olmayanda görünür", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const l = await startLive();
    live = l;
    const s = await loginAs(l.app, admin);
    const mk = async (anonymized: boolean) => {
      const { id } = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id, status: "ENDED" });
      if (anonymized) await testDb().supportSession.update({ where: { id }, data: { anonymizedAt: new Date() } });
      await writeAudit(testDb(), { ip: "", userAgent: "", requestId: newId() }, { tenantId: t.id, userId: admin.id, username: admin.email, action: "session.terminated", entity: "support_sessions", entityId: id, result: "success", newValue: { reason: "Ayşe Hanım'ın isteğiyle" } });
      return id;
    };
    const plain = await mk(false);
    const anon = await mk(true);
    const reasonOf = async (id: string) =>
      (await l.app.inject({ method: "GET", url: `/api/v1/sessions/${id}/history`, headers: s.headers })).json<SessionHistoryDetail>().timeline.find((e) => e.action === "session.terminated")?.details;
    expect(await reasonOf(plain)).toMatchObject({ reason: "Ayşe Hanım'ın isteğiyle" });
    const anonDetails = await reasonOf(anon);
    expect(anonDetails).toBeDefined();
    expect(anonDetails).not.toHaveProperty("reason");
  });
});
