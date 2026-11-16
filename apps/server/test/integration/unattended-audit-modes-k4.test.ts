// P28u audit görünümü — gerçek REST bağlantı zincirinden (`POST /unattended/devices/:id/connect`) geçen üç kip (AC-445):
// `ask`→asked, `ask`→no_user, `silent`; `GET /audit?consentMode=` her kipi ayrı süzer (silent'ta `unattended.connect` dahil).
// D-P28u-K1-1: audit OKUMA görünümünde (liste + CSV) izinsiz bağlantı gerekçesi yalnız `session_history.view` sahibine ve
// oturum anonimleştirilmemişken açık; aksi `***`. Değiştirilemez satır olduğu gibi kalır.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymizeSessionBatch } from "../../src/jobs/retention-repo.ts";
import { createUser, loginAs, testDb, type Session } from "../helpers/app.ts";
import type { Live } from "../helpers/signal-flow.ts";
import { helperGuest, sessionStatus, waitUntil, type ConnectMsg, type Ready } from "../helpers/unattended-device.ts";
import { connectReq, REASON, setup, startSilentLive } from "../helpers/unattended-silent.ts";

let live: Live;
let env: Awaited<ReturnType<typeof startSilentLive>>;
beforeAll(async () => {
  env = await startSilentLive();
  ({ live } = env);
});
afterAll(async () => env.close());

type Mode = "asked" | "no_user" | "silent";
interface Item {
  action: string;
  entityId: string | null;
  newValue: Record<string, unknown> | null;
}

/** Kip başına ayrı firma/cihaz (aynı çift 60 sn kovası ve DEVICE_BUSY'ye takılmasın); yardımcı kabul edilir. */
async function opened(mode: Mode): Promise<{ r: Ready; sessionId: string }> {
  const r = await setup(live, mode === "silent" ? { silentPerm: true, policy: true } : {});
  const res = await live.app.inject(connectReq(r, mode === "silent" ? { silent: true, reason: REASON } : {}));
  expect(res.statusCode).toBe(200);
  const msg = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
  if (mode === "asked") r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "asked", decision: "granted", ms: 900 });
  if (mode === "no_user") r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "no_user" });
  const h = await helperGuest(live, msg.ticket);
  await h.waitFor("hello");
  await waitUntil(async () => (await sessionStatus(msg.sessionId)).status === "ACTIVE");
  return { r, sessionId: msg.sessionId };
}

const auditItems = async (s: Session, query = ""): Promise<Item[]> => {
  const res = await live.app.inject({ method: "GET", url: `/api/v1/audit${query}`, headers: s.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ items: Item[] }>().items;
};
const actionsOf = (items: Item[], sessionId: string) =>
  items
    .filter((i) => i.entityId === sessionId)
    .map((i) => i.action)
    .sort();
const connectRow = async (s: Session, sessionId: string) =>
  (await auditItems(s, "?action=unattended.connect")).find((i) => i.entityId === sessionId);
const csv = async (s: Session) => (await live.app.inject({ method: "GET", url: "/api/v1/audit/export.csv", headers: s.headers })).body;

describe("P28u audit consentMode filtresi — gerçek bağlantı zinciri (AC-445)", () => {
  it("AC-445: üç kip ayrı süzülür; silent'ta unattended.connect görünür, ask connect satırı kip taşımaz", async () => {
    const asked = await opened("asked");
    const noUser = await opened("no_user");
    const silent = await opened("silent");
    const expected: Record<Mode, { sessionId: string; tenantId: string; actions: string[] }> = {
      asked: { ...asked, tenantId: asked.r.tenantId, actions: ["unattended.consent", "unattended.session.started"] },
      no_user: { ...noUser, tenantId: noUser.r.tenantId, actions: ["unattended.session.started"] },
      silent: { ...silent, tenantId: silent.r.tenantId, actions: ["unattended.connect", "unattended.session.started"] },
    };
    for (const [mode, e] of Object.entries(expected) as [Mode, (typeof expected)[Mode]][]) {
      const admin = await loginAs(live.app, await createUser({ tenantId: e.tenantId, role: "ADMIN" }));
      expect(actionsOf(await auditItems(admin, `?consentMode=${mode}`), e.sessionId)).toEqual(e.actions);
      for (const other of (["asked", "no_user", "silent"] as const).filter((m) => m !== mode))
        expect(actionsOf(await auditItems(admin, `?consentMode=${other}`), e.sessionId)).toEqual([]);
      // filtresiz listede ask connect satırı var ama kip taşımaz (filtrede görünmemesinin nedeni)
      if (mode !== "silent") expect((await connectRow(admin, e.sessionId))?.newValue).toMatchObject({ consentRequested: "ask" });
    }
  });
});

describe("P28u izinsiz gerekçe audit okuma maskesi (D-P28u-K1-1)", () => {
  it("D-P28u-K1-1: session_history.view sahibi gerekçeyi görür; yalnız audit.view olan ***; CSV aynı kural", async () => {
    const { r, sessionId } = await opened("silent");
    const admin = await loginAs(live.app, await createUser({ tenantId: r.tenantId, role: "ADMIN" }));
    expect((await connectRow(admin, sessionId))?.newValue).toMatchObject({ consentMode: "silent", silentReason: REASON });
    expect(await csv(admin)).toContain(REASON);
    const auditor = await loginAs(
      live.app,
      await createUser({ tenantId: r.tenantId, role: "USER", perms: { "audit.view": true, "audit.export": true } }),
    );
    expect((await connectRow(auditor, sessionId))?.newValue).toMatchObject({ consentMode: "silent", silentReason: "***" });
    const body = await csv(auditor);
    expect(body).toContain("unattended.connect");
    expect(body).toContain("silentReason"); // anahtar kalır, değer maskeli
    expect(body).not.toContain(REASON);
    const raw = await testDb().auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: "unattended.connect" } });
    expect(raw.newValue).toMatchObject({ silentReason: REASON });
  });

  it("D-P28u-K1-1: oturum anonimleştirilince yetkili kullanıcıya da *** (liste + CSV)", async () => {
    const { r, sessionId } = await opened("silent");
    r.device.send({ t: "session.closed", sessionId, reason: "helper_failed" });
    await waitUntil(async () => (await sessionStatus(sessionId)).status === "ENDED");
    expect((await anonymizeSessionBatch(testDb(), r.tenantId, new Date(Date.now() + 60_000), 10)).sessions).toBe(1);
    const admin = await loginAs(live.app, await createUser({ tenantId: r.tenantId, role: "ADMIN" }));
    expect((await connectRow(admin, sessionId))?.newValue).toMatchObject({ silentReason: "***" });
    expect(await csv(admin)).not.toContain(REASON);
  });
});
