// P32-K1 entegrasyon (mimari-p32 §4.2, §4.4, §4.5; AC-525, 526, 527a, 528): `UNATTENDED_MODE=unsigned-accepted` (staging =
// prod provası) — kayıt, `device.auth`, bağlantı; TEST öneki yok; audit `gateMode`/`binarySha256`/`signed`; kapı reddinde
// `sha256Prefix` (audit + warn). Gerçek MySQL; cihaz Ed25519 anahtarlı sahte servis istemcisi.
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.ts";
import { newId } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginStepUp, testDb } from "../helpers/app.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { DEVICE_INDICATOR_TEST_PREFIX, deviceIndicatorText } from "@remote/contracts/ws-device";
import { acceptedEnv, contactRow, setSmtp, SHA, UNSIGNED_ENV } from "../helpers/unattended.ts";
import { authMsg, connectReq, rawDevice, ready, type ConnectMsg, type Ready } from "../helpers/unattended-device.ts";
import { directSession, grantControl, readyK4, techConsole } from "../helpers/unattended-k4.ts";

const OTHER = "ef".repeat(32);
const AGENT_SHA = "12".repeat(32);
const logLines: string[] = [];
let live: Live;

beforeAll(async () => {
  const sink = new Writable({
    write(chunk: Buffer, _e, cb) {
      logLines.push(chunk.toString("utf8"));
      cb();
    },
  });
  // Liste: yayınlanan servis (AGENT_SHA) + yardımcı cihazların beyanı (SHA). OTHER listede değil.
  live = await startLive({ env: { ...acceptedEnv(AGENT_SHA, [SHA]), LOG_LEVEL: "info" }, logger: createLogger("info", sink) });
});
afterAll(async () => live.close());

const newValue = (row: { newValue: unknown } | null | undefined) => (row?.newValue ?? {}) as Record<string, unknown>;

async function adminFirm() {
  const t = await createTenant();
  await setSmtp(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const customer = await createCustomerRow(t.id);
  await contactRow(t.id, customer.id);
  return { tenantId: t.id, customerId: customer.id, s: await loginStepUp(live.app, admin) };
}

/** Gösterge parçaları DB'den (teknisyen adı + firma adı). */
async function indicatorParts(r: Ready): Promise<[string, string]> {
  const user = await testDb().user.findUniqueOrThrow({ where: { id: r.tech.id }, select: { fullName: true } });
  const tenant = await testDb().tenant.findUniqueOrThrow({ where: { id: r.tenantId }, select: { name: true } });
  return [user.fullName, tenant.name];
}
const signedIndicator = async (r: Ready) => deviceIndicatorText(...(await indicatorParts(r)), false);

/** Kontrol açık onaysız oda → logoff ok → cihaza giden `rejoin.indicatorText` (intervene.ts:126 `test` bayrağı). */
async function rejoinIndicator(l: Live): Promise<{ r: Ready; text: string }> {
  const r = await readyK4(l);
  const { sessionId, helper } = await directSession(l, r);
  const { ws } = await techConsole(l, r, sessionId);
  await grantControl(ws, helper);
  const p = l.app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/unattended/logoff`,
    headers: r.s.headers,
    payload: { confirm: true },
  });
  const m = (await r.device.waitFor("intervene" as never)) as unknown as { id: string };
  r.device.send({ t: "intervene.result", sessionId, id: m.id, cmd: "logoff", ok: true });
  expect((await p).json()).toEqual({ ok: true, rejoin: true });
  const rj = (await r.device.waitFor("rejoin" as never)) as unknown as { indicatorText: string };
  return { r, text: rj.indicatorText };
}

let ipSeq = 0;
const register = (code: string, sha256: string, signed = false) =>
  live.app.inject({
    method: "POST",
    url: "/api/v1/unattended/register",
    remoteAddress: `203.0.113.${++ipSeq}`,
    payload: {
      code,
      publicKey: randomBytes(32).toString("base64url"),
      name: "MUHASEBE-PC",
      osVersion: "Windows 11 Pro 23H2",
      version: "0.23.0",
      sha256,
      signed,
    },
  });

describe("P32 unsigned-accepted — kapı (AC-525)", () => {
  it("AC-525: status {mode:'unsigned-accepted', available:true}; kayıt listedeki SHA ile (imzasız) 200, listede olmayanla 409", async () => {
    const f = await adminFirm();
    const st = await live.app.inject({ method: "GET", url: "/api/v1/unattended/status", headers: f.s.headers });
    expect(st.json()).toMatchObject({ mode: "unsigned-accepted", available: true });
    const newCode = async () => {
      const r = await live.app.inject({
        method: "POST",
        url: "/api/v1/unattended/registration-codes",
        headers: f.s.headers,
        payload: { customerId: f.customerId },
      });
      expect(r.statusCode, r.body).toBe(201);
      // S-P32-8 / AC-527c: kayıt kodu yanıtı panelden indirilen servisin SHA'sını taşır (Admin kurulum notu).
      expect(r.json<{ agentSha256: string }>().agentSha256).toBe(AGENT_SHA);
      return r.json<{ code: string }>().code;
    };
    const code = await newCode();
    const rejected = await register(code, OTHER, true);
    expect([rejected.statusCode, rejected.json<{ error: { code: string } }>().error.code]).toEqual([409, "UNATTENDED_DISABLED"]);
    // AC-528: kapı reddi aynı eylemle fail satırı yazar; tenant koddan, TX dışında (kod tüketilmez → aynı kodla kayıt 200).
    const gateRows = await testDb().auditLog.findMany({
      where: { tenantId: f.tenantId, action: "unattended.device.registered", result: "fail" },
    });
    expect(gateRows).toHaveLength(1);
    expect(gateRows[0]).toMatchObject({ entity: "unattended_devices", username: "device" });
    expect(newValue(gateRows[0])).toMatchObject({ reason: "gate", gateMode: "unsigned-accepted", binarySha256: OTHER, signed: true });
    const ok = await register(code, SHA, false);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("AC-525 AC-527: listede olmayan SHA ile device.auth → 4403; audit reason=gate + sha256Prefix (12), warn {deviceId, tenantId, sha256Prefix}", async () => {
    const r = await ready(live, { online: false });
    const { c, nonce } = await rawDevice(live);
    c.send(authMsg(r.dev, nonce, { sha256: OTHER, signed: true }));
    expect((await c.closed).code).toBe(4403);
    const row = await testDb().auditLog.findFirst({
      where: { tenantId: r.tenantId, action: "unattended.device.auth", entityId: r.dev.id, result: "fail" },
    });
    expect(newValue(row)).toEqual({ reason: "gate", sha256Prefix: OTHER.slice(0, 12) });
    const warn = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.deviceId === r.dev.id && l.sha256Prefix);
    expect(warn).toMatchObject({ level: 40, deviceId: r.dev.id, tenantId: r.tenantId, sha256Prefix: OTHER.slice(0, 12) });
    expect(JSON.stringify(warn)).not.toContain(OTHER);
    // Aynı dakikada ikinci ret: audit ve log yazılmaz (hız sınırı).
    const again = await rawDevice(live);
    again.c.send(authMsg(r.dev, again.nonce, { sha256: OTHER }));
    expect((await again.c.closed).code).toBe(4403);
    expect(await testDb().auditLog.count({ where: { action: "unattended.device.auth", entityId: r.dev.id, result: "fail" } })).toBe(1);
    expect(logLines.filter((l) => l.includes(r.dev.id) && l.includes("sha256Prefix"))).toHaveLength(1);
  });
});

describe("P32 kayıt kodu yanıtı agentSha256 (AC-527c, S-P32-8)", () => {
  it("AC-527: servis SHA'sı yapılandırılmamış modda (unsigned, staging) agentSha256 boş dize; alan her zaman var", async () => {
    const other = await startLive({ env: { UNATTENDED_MODE: "unsigned", DEPLOY_ENV: "staging" } });
    try {
      const t = await createTenant();
      await setSmtp(t.id);
      const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
      const customer = await createCustomerRow(t.id);
      await contactRow(t.id, customer.id);
      const s = await loginStepUp(other.app, admin);
      const r = await other.app.inject({
        method: "POST",
        url: "/api/v1/unattended/registration-codes",
        headers: s.headers,
        payload: { customerId: customer.id },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json<{ agentSha256: string }>().agentSha256).toBe("");
    } finally {
      await other.close();
    }
  });
});

describe("P32 unsigned-accepted — gösterge (AC-526)", () => {
  it("AC-526: imzasız ama listedeki servis device.ready alır; bağlantı göstergesinde 'TEST' öneki yok", async () => {
    const r = await ready(live);
    expect(live.app.unattendedHub.isOnline(r.dev.id)).toBe(true);
    const res = await live.app.inject(connectReq(r));
    expect(res.statusCode, res.body).toBe(200);
    const msg = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
    // `signed` moddaki metinle birebir aynı (önek yok, başka fark yok).
    expect(msg.indicatorText).toBe(await signedIndicator(r));
    expect(msg.indicatorText).not.toMatch(/TEST/);
  });

  it("AC-526: intervene (logoff → rejoin) göstergesi de `signed` moddaki metinle aynı; staging `unsigned` kipte 'TEST' önekli", async () => {
    const accepted = await rejoinIndicator(live);
    expect(accepted.text).toBe(await signedIndicator(accepted.r));
    const staging = await startLive({ env: { ...UNSIGNED_ENV } });
    try {
      const u = await rejoinIndicator(staging);
      expect(u.text).toBe(deviceIndicatorText(...(await indicatorParts(u.r)), true));
      expect(u.text.startsWith(DEVICE_INDICATOR_TEST_PREFIX)).toBe(true);
    } finally {
      await staging.close();
    }
  });
});

describe("P32 audit gateMode / binarySha256 (AC-528)", () => {
  it("AC-528: unattended.device.registered başarılı ve başarısız satırda gateMode + binarySha256 (tam 64)", async () => {
    const f = await adminFirm();
    const c = await live.app.inject({
      method: "POST",
      url: "/api/v1/unattended/registration-codes",
      headers: f.s.headers,
      payload: { customerId: f.customerId },
    });
    const ok = await register(c.json<{ code: string }>().code, SHA);
    expect(ok.statusCode, ok.body).toBe(200);
    const success = await testDb().auditLog.findFirst({
      where: { tenantId: f.tenantId, action: "unattended.device.registered", result: "success" },
    });
    expect(newValue(success)).toMatchObject({ gateMode: "unsigned-accepted", binarySha256: SHA, signed: false });
    const bad = await register("ABCD-EFGH-JKMN-PQRS", OTHER);
    expect(bad.statusCode).toBe(404);
    const fail = await testDb().auditLog.findFirst({
      where: { action: "unattended.device.registered", result: "fail", ipAddress: `203.0.113.${ipSeq}` },
      orderBy: { id: "desc" },
    });
    expect(newValue(fail)).toMatchObject({ reason: "invalid_code", gateMode: "unsigned-accepted", binarySha256: OTHER });
  });

  it("AC-528: unattended.connect başarılı satırda gateMode + binarySha256 + signed; kapı reddinde beyan dahil; cihaz yoksa yalnız gateMode", async () => {
    const r = await ready(live);
    const okRes = await live.app.inject(connectReq(r));
    expect(okRes.statusCode, okRes.body).toBe(200);
    const sessionId = okRes.json<{ sessionId: string }>().sessionId;
    const success = await testDb().auditLog.findFirst({ where: { action: "unattended.connect", entityId: sessionId, result: "success" } });
    expect(newValue(success)).toMatchObject({ gateMode: "unsigned-accepted", binarySha256: SHA, signed: false, mode: "ask" });

    const r2 = await ready(live);
    await testDb().unattendedDevice.update({ where: { id: r2.dev.id }, data: { binarySha256: OTHER } });
    const refused = await live.app.inject(connectReq(r2));
    expect(refused.json<{ error: { code: string } }>().error.code).toBe("UNATTENDED_DISABLED");
    // AC-525: listede olmayan beyan → cihaz listesinde Bağlan pasif, neden `unsigned` (rozet).
    const list = await live.app.inject({ method: "GET", url: "/api/v1/unattended/devices", headers: r2.s.headers });
    expect(
      list
        .json<{ items: { id: string; canConnect: boolean; connectBlockedReason: string | null }[] }>()
        .items.find((x) => x.id === r2.dev.id),
    ).toMatchObject({
      canConnect: false,
      connectBlockedReason: "unsigned",
    });
    const fail = await testDb().auditLog.findFirst({ where: { action: "unattended.connect", entityId: r2.dev.id, result: "fail" } });
    expect(newValue(fail)).toMatchObject({ failReason: "unsigned", gateMode: "unsigned-accepted", binarySha256: OTHER, signed: false });

    const ghost = newId();
    const nf = await live.app.inject({ ...connectReq(r2), url: `/api/v1/unattended/devices/${ghost}/connect` });
    expect(nf.statusCode).toBe(404);
    const nfRow = newValue(await testDb().auditLog.findFirst({ where: { action: "unattended.connect", entityId: ghost, result: "fail" } }));
    expect(nfRow).toMatchObject({ failReason: "not_found", gateMode: "unsigned-accepted" });
    expect(nfRow).not.toHaveProperty("binarySha256");
    expect(nfRow).not.toHaveProperty("signed");
  });
});
