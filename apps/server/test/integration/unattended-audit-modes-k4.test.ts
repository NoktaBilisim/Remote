// P28u audit görünümü — r3 (AC-445, AC-451): gerçek REST zinciri yalnız `no_user` üretir; r3 öncesi `asked` / `silent` satırları
// (DB fikstürü) aynı filtreyle ayrı süzülür. D-P28u-K1-1: eski izinsiz gerekçe audit OKUMA görünümünde (liste + CSV) yalnız
// `session_history.view` sahibine ve oturum anonimleştirilmemişken açık; aksi `***`. Değiştirilemez satır olduğu gibi kalır.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymizeSessionBatch } from "../../src/jobs/retention-repo.ts";
import { createUser, loginAs, testDb, type Session } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { type Ready } from "../helpers/unattended-device.ts";
import { directSession, readyK4 } from "../helpers/unattended-k4.ts";
import { LEGACY_REASON, legacySession } from "../helpers/unattended-legacy.ts";

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
});
afterAll(async () => live.close());

type Mode = "asked" | "no_user" | "silent";
interface Item {
  action: string;
  entityId: string | null;
  newValue: Record<string, unknown> | null;
}

/** Kip başına ayrı firma/cihaz; `no_user` gerçek zincirden, eski kipler DB fikstüründen. */
async function opened(mode: Mode): Promise<{ r: Ready; sessionId: string }> {
  const r = await readyK4(live);
  if (mode === "no_user") return { r, sessionId: (await directSession(live, r)).sessionId };
  return { r, sessionId: await legacySession(r, mode) };
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

describe("P28u audit consentMode filtresi (AC-445, AC-451)", () => {
  it("AC-445 AC-451: no_user (gerçek zincir) ile eski asked/silent satırları ayrı süzülür; ask connect satırı kip taşımaz", async () => {
    const asked = await opened("asked");
    const noUser = await opened("no_user");
    const silent = await opened("silent");
    const expected: Record<Mode, { sessionId: string; tenantId: string; actions: string[] }> = {
      asked: { ...asked, tenantId: asked.r.tenantId, actions: ["unattended.consent", "unattended.session.ended", "unattended.session.started"] },
      no_user: { ...noUser, tenantId: noUser.r.tenantId, actions: ["unattended.session.started"] },
      silent: { ...silent, tenantId: silent.r.tenantId, actions: ["unattended.connect", "unattended.session.ended", "unattended.session.started"] },
    };
    for (const [mode, e] of Object.entries(expected) as [Mode, (typeof expected)[Mode]][]) {
      const admin = await loginAs(live.app, await createUser({ tenantId: e.tenantId, role: "ADMIN" }));
      expect(actionsOf(await auditItems(admin, `?consentMode=${mode}`), e.sessionId)).toEqual(e.actions);
      for (const other of (["asked", "no_user", "silent"] as const).filter((m) => m !== mode))
        expect(actionsOf(await auditItems(admin, `?consentMode=${other}`), e.sessionId)).toEqual([]);
      if (mode !== "silent") expect((await connectRow(admin, e.sessionId))?.newValue).toMatchObject({ consentRequested: "ask" });
    }
  });
});

describe("P28u eski izinsiz gerekçe audit okuma maskesi (D-P28u-K1-1, AC-451)", () => {
  it("D-P28u-K1-1: session_history.view sahibi gerekçeyi görür; yalnız audit.view olan ***; CSV aynı kural", async () => {
    const { r, sessionId } = await opened("silent");
    const admin = await loginAs(live.app, await createUser({ tenantId: r.tenantId, role: "ADMIN" }));
    expect((await connectRow(admin, sessionId))?.newValue).toMatchObject({ consentMode: "silent", silentReason: LEGACY_REASON });
    expect(await csv(admin)).toContain(LEGACY_REASON);
    const auditor = await loginAs(
      live.app,
      await createUser({ tenantId: r.tenantId, role: "USER", perms: { "audit.view": true, "audit.export": true } }),
    );
    expect((await connectRow(auditor, sessionId))?.newValue).toMatchObject({ consentMode: "silent", silentReason: "***" });
    const body = await csv(auditor);
    expect(body).toContain("unattended.connect");
    expect(body).toContain("silentReason"); // anahtar kalır, değer maskeli
    expect(body).not.toContain(LEGACY_REASON);
    const raw = await testDb().auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: "unattended.connect" } });
    expect(raw.newValue).toMatchObject({ silentReason: LEGACY_REASON });
  });

  it("D-P28u-K1-1: oturum anonimleştirilince yetkili kullanıcıya da *** (liste + CSV)", async () => {
    const { r, sessionId } = await opened("silent");
    expect((await anonymizeSessionBatch(testDb(), r.tenantId, new Date(Date.now() + 60_000), 10)).sessions).toBeGreaterThanOrEqual(1);
    const admin = await loginAs(live.app, await createUser({ tenantId: r.tenantId, role: "ADMIN" }));
    expect((await connectRow(admin, sessionId))?.newValue).toMatchObject({ silentReason: "***" });
    expect(await csv(admin)).not.toContain(LEGACY_REASON);
  });
});
