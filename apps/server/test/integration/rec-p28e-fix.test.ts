// P28e düzeltme turu (gerçek MySQL + dinleyen sunucu + iki ws istemcisi): rıza teklifi resolve / talep bilgisi yanıtında
// yalnız kayıt açıkken (AC-381/384, §2.1); konsol `rs.cap.rec1` alt protokolünden okunur (K-P28e-9, `unsupported` kapısı);
// `rec.revoke` `share.state`'ten sonra da kabul (§6.2); `consent_rejected` alt kodu audit görünümünde `cause` olarak açık.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECORDING_AUDIT } from "@remote/contracts/audit";
import { REC_CONSENT_LINE_SHA256 } from "@remote/contracts/ws-rec";
import { createRequestSettings } from "../helpers/requests.ts";
import { ORIGIN, createTenant, createUser, loginAs, testDb } from "../helpers/app.ts";
import { TECH_PERMS, startLive, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders, type WsClient } from "../helpers/ws.ts";

let live: Live;
let n = 0;
const nextIp = () => `203.0.113.${100 + (n++ % 100)}`;

beforeAll(async () => {
  live = await startLive({ fsrvTest: { freeRatio: 0.5 } });
});
afterAll(async () => {
  await live.close();
});

const setRecording = (tenantId: string, on: boolean) =>
  testDb().tenantSettings.update({ where: { tenantId }, data: { recordingEnabled: on } });

async function techWith(tenantId: string, protocols: string[]) {
  const tech = await createUser({ tenantId, role: "USER", perms: TECH_PERMS });
  const s = await loginAs(live.app, tech);
  const res = await live.app.inject({ method: "POST", url: "/api/v1/sessions", headers: s.headers, payload: {} });
  const created = res.json<{ id: string; link: string }>();
  const ws = await connect(`${live.base}/ws/tech?sessionId=${created.id}`, protocols, techHeaders(s.token, ORIGIN));
  await ws.waitFor("hello");
  return { tech, sessionId: created.id, token: created.link.split("/").pop() ?? "", ws };
}

const resolve = async (token: string, ip: string) => {
  const r = await live.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers: { origin: ORIGIN, "x-forwarded-for": ip },
    payload: { token, clientKind: "BROWSER" },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ joinNonce: string; consentText: { id: string; recording?: { offered: boolean; lineSha256: string } } }>();
};

/** resolve + join + `rs.cap.rec1` misafir soketi → admit → iki tarafta hello. */
async function admittedRec(t: Awaited<ReturnType<typeof techWith>>): Promise<WsClient> {
  const ip = nextIp();
  const { joinNonce, consentText } = await resolve(t.token, ip);
  const j = await live.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/join",
    headers: { origin: ORIGIN, "x-forwarded-for": ip },
    payload: { joinNonce, customerName: "Ayşe Müşteri", consentAccepted: true, consentTextId: consentText.id },
  });
  expect(j.statusCode, j.body).toBe(200);
  const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
  const g = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`, "rs.cap.rec1"], { origin: ORIGIN });
  await g.waitFor("lobby.wait");
  await t.ws.waitFor("peer.pending");
  t.ws.send({ t: "guest.admit", admitCode });
  await g.waitFor("hello");
  await t.ws.waitFor("peer.joined");
  return g;
}

const recOf = (sessionId: string) => testDb().sessionRecording.findFirst({ where: { sessionId } });

describe("AC-381 / AC-384 rıza teklifi yanıtta yalnız kayıt açıkken", () => {
  it("AC-381 resolve: kapalıyken `recording` yok, açıkken offered + SHA", async () => {
    const tenantId = (await createTenant()).id;
    const t = await techWith(tenantId, ["rs.v1"]);
    expect((await resolve(t.token, nextIp())).consentText.recording).toBeUndefined();
    await setRecording(tenantId, true);
    expect((await resolve(t.token, nextIp())).consentText.recording).toMatchObject({
      offered: true,
      lineSha256: REC_CONSENT_LINE_SHA256,
    });
    t.ws.ws.close();
  });

  it("AC-381 talep formu bilgisi (/public/requests/tenant): kapalıyken yok, açıkken teklif var", async () => {
    const tenantId = (await createTenant()).id;
    const ref = await createRequestSettings(tenantId);
    const info = async () => {
      const r = await live.app.inject({
        method: "GET",
        url: `/api/v1/public/requests/tenant?ref=${ref}`,
        headers: { "x-forwarded-for": nextIp() },
      });
      expect(r.statusCode, r.body).toBe(200);
      return r.json<{ consentText: { recording?: { offered: boolean } } }>().consentText;
    };
    expect((await info()).recording).toBeUndefined();
    await setRecording(tenantId, true);
    expect((await info()).recording).toMatchObject({ offered: true });
  });
});

describe("K-P28e-9 konsol `rs.cap.rec1` alt protokolü + §6.2 kapıları", () => {
  it("AC-381 rec1 konsol + rec1 misafir: rıza → kayıt ACTIVE, kaydediciye upload belirteci; share.state sonrası rec.revoke kabul (AC-382)", async () => {
    const tenantId = (await createTenant()).id;
    await setRecording(tenantId, true);
    const t = await techWith(tenantId, ["rs.v1", "rs.cap.rec1"]);
    const g = await admittedRec(t);
    g.send({ t: "rec.consent", lineSha256: REC_CONSENT_LINE_SHA256 });
    const on = (await t.ws.waitFor("rec.state")) as unknown as { on: boolean; rid?: string; upload?: { token: string } };
    expect(on).toMatchObject({ on: true, basis: "consent" });
    expect(on.upload?.token).toBeTruthy();
    expect(await g.waitFor("rec.state")).toMatchObject({ on: true });
    expect(await recOf(t.sessionId)).toMatchObject({ state: "ACTIVE", basis: "CONSENT", recorderUserId: t.tech.id });
    // §6.2 / K7 notu: yeniden bağlanmada `rec.revoke` `share.state`'ten sonra gelebilir — ACTIVE iken her an kabul.
    g.send({ t: "share.state", state: "stopped" });
    await t.ws.waitFor("share.state");
    g.send({ t: "rec.revoke" });
    expect(await g.waitFor("rec.state")).toMatchObject({ on: false, reason: "revoked" });
    await expect.poll(async () => (await recOf(t.sessionId))?.stopReason).toBe("REVOKED");
    g.ws.close();
    t.ws.ws.close();
  });

  it("K-P28e-9 rec1 bildirmeyen konsol: kayıt açılmaz, misafire off{unavailable}, audit recording.start fail unsupported", async () => {
    const tenantId = (await createTenant()).id;
    await setRecording(tenantId, true);
    const t = await techWith(tenantId, ["rs.v1"]);
    const g = await admittedRec(t);
    g.send({ t: "rec.consent", lineSha256: REC_CONSENT_LINE_SHA256 });
    expect(await g.waitFor("rec.state")).toMatchObject({ on: false, reason: "unavailable" });
    expect(await recOf(t.sessionId)).toBeNull();
    await expect
      .poll(async () => (await testDb().auditLog.findFirst({ where: { entityId: t.sessionId, action: RECORDING_AUDIT.START } }))?.newValue)
      .toMatchObject({ reason: "unsupported" });
    g.ws.close();
    t.ws.ws.close();
  });

  it("S-P28e-10 consent_rejected{sha}: audit görünümünde alt kod `cause` olarak okunur (maskelenmez)", async () => {
    const tenantId = (await createTenant()).id;
    await setRecording(tenantId, true);
    const t = await techWith(tenantId, ["rs.v1", "rs.cap.rec1"]);
    const g = await admittedRec(t);
    g.send({ t: "rec.consent", lineSha256: "0".repeat(64) });
    await expect.poll(async () => testDb().auditLog.count({ where: { entityId: t.sessionId, action: RECORDING_AUDIT.START } })).toBe(1);
    const admin = await loginAs(live.app, await createUser({ tenantId, role: "ADMIN" }));
    const res = await live.app.inject({ method: "GET", url: "/api/v1/audit?action=recording.start", headers: admin.headers });
    expect(res.statusCode).toBe(200);
    const item = res
      .json<{ items: { entityId: string | null; result: string; newValue: Record<string, unknown> | null }[] }>()
      .items.find((i) => i.entityId === t.sessionId);
    expect(item).toMatchObject({ result: "fail", newValue: { reason: "consent_rejected", cause: "sha" } });
    g.ws.close();
    t.ws.ws.close();
  });
});
