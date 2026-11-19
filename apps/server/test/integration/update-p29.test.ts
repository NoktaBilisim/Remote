// P29-K4 public uçlar + `/ws/device` güncelleme eki (mimari-p29 §4.2–4.7, r2 §14; AC-473, 477, 479, 485–489, 492, 493).
// Gerçek dinleyen sunucu; manifestler test sürecinde üretilen Ed25519 anahtarıyla imzalanır, ikili dosyaları gerçek (SHA kapısı).
import { DEVICE_CAP_DIRECT, WS_DEVICE_CAP_CONSENT, WS_DEVICE_CAP_UPDATE, WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, testDb } from "../helpers/app.ts";
import { createCustomerRow, createRequestSettings } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { authMsg, connectReq, keyedDevice, onlineDevice, ready, waitUntil, type KeyedDevice } from "../helpers/unattended-device.ts";
import { bindingRow, manifest, newSigner, updateFixture, writeManifest } from "../helpers/update.ts";
import { connect, type WsClient } from "../helpers/ws.ts";

const f = updateFixture();
const signer = newSigner();
const clientBin = f.binary("NoktaDestek.exe");
const serviceBin = f.binary("NoktaDestekServis.exe", 64 * 1024);
const clientBytes = writeManifest(f.dir, signer, manifest({ sha256: clientBin.sha, size: clientBin.bytes.length }));
writeManifest(f.dir, signer, manifest({ sha256: serviceBin.sha, size: serviceBin.bytes.length, component: "service" }));

const ENV = {
  ...UNSIGNED_ENV,
  AGENT_BINARY_PATH: clientBin.path,
  AGENT_SHA256: clientBin.sha,
  UNATTENDED_AGENT_PATH: serviceBin.path,
  UNATTENDED_AGENT_SHA256: serviceBin.sha,
  UPDATE_MANIFEST_DIR: f.dir,
  UPDATE_MANIFEST_PUBKEYS: signer.publicKey,
  // K-P29-19: güncelleme uçları asgari sürüm kapısından muaf (cihazlar 1.0.0/0.22.0 beyan eder).
  MIN_AGENT_VERSION: "0.10.0",
};
let live: Live;
let bare: Live;
beforeAll(async () => {
  live = await startLive({ env: ENV });
  bare = await startLive({ env: { ...UNSIGNED_ENV } });
});
afterAll(async () => {
  await Promise.all([live.close(), bare.close()]);
});

const UA = { "user-agent": "NoktaDestek/0.22.0" };
const get = (l: Live, url: string, headers: Record<string, string> = {}) =>
  l.app.inject({ method: "GET", url, headers: { ...UA, ...headers } });
const CHECK = "/api/v1/public/agent/update?platform=windows&arch=amd64&component=client";
const metric = (l: Live, prefix: string): number =>
  l.app.metrics
    .render()
    .split("\n")
    .filter((x) => x.startsWith(prefix))
    .reduce((n, x) => n + Number(x.split(" ").pop()), 0);
const audits = (entityId: string) =>
  testDb().auditLog.findMany({ where: { entityId, action: { startsWith: "client.update." } }, orderBy: { id: "asc" } });

/** `update1` bildiren servis (0.22.0); `device.ready` ve ilk teklif alınmış. */
async function updDevice(l: Live, dev: KeyedDevice, version = "0.22.0"): Promise<WsClient> {
  const c = await connect(`${l.base}/ws/device`, [WS_DEVICE_SUBPROTOCOL, WS_DEVICE_CAP_CONSENT, DEVICE_CAP_DIRECT, WS_DEVICE_CAP_UPDATE]);
  const hello = (await c.waitFor("device.hello" as never)) as unknown as { nonce: string };
  c.send(authMsg(dev, hello.nonce, { version }));
  await c.waitFor("device.ready" as never);
  await waitUntil(async () => c.msgs.some((m) => ["update.offer", "update.none"].includes((m as { t: string }).t)));
  return c;
}
/** Cihaz soketi 5 msg/sn (WS_DEVICE_RATE_PER_SEC) — testte mesajlar aralıklı gönderilir. */
async function paced(c: WsClient, msgs: object[]): Promise<void> {
  for (const m of msgs) {
    c.send(m);
    await new Promise((r) => setTimeout(r, 220));
  }
}
const lastOf = (c: WsClient, t: string) =>
  [...c.msgs].reverse().find((m) => (m as { t: string }).t === t) as Record<string, unknown> | undefined;
const countOf = (c: WsClient, t: string) => c.msgs.filter((m) => (m as { t: string }).t === t).length;

async function freshDevice() {
  const t = await createTenant();
  const customer = await createCustomerRow(t.id);
  const dev = await keyedDevice(t.id, customer.id);
  await testDb().unattendedDevice.update({ where: { id: dev.id }, data: { agentVersion: "0.22.0" } });
  return { tenantId: t.id, dev };
}

describe("GET /public/agent/update (AC-473, AC-485, AC-486)", () => {
  it("AC-473: 200 ham manifest baytları + imza + auto; no-store, nosniff; MIN_AGENT_VERSION uygulanmaz", async () => {
    const r = await get(live, CHECK);
    expect(r.statusCode).toBe(200);
    const body = r.json<{ manifest: string; signature: string; policy: string }>();
    expect(Buffer.from(body.manifest, "base64").equals(clientBytes)).toBe(true);
    expect(signer.sign(clientBytes)).toBe(body.signature);
    expect(body.policy).toBe("auto");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("AC-473: yayın yok (macOS / dizin tanımsız) → 204", async () => {
    expect((await get(live, "/api/v1/public/agent/update?platform=macos&arch=universal&component=client")).statusCode).toBe(204);
    expect((await get(bare, CHECK)).statusCode).toBe(204);
  });

  it("AC-473: component=service ve biçim hataları 400 — değer/anahtar yansımaz; Origin → 403 (AGENT kuralı)", async () => {
    expect((await get(live, "/api/v1/public/agent/update?platform=windows&arch=amd64&component=service")).statusCode).toBe(400);
    const r = await get(live, "/api/v1/public/agent/update?platform=CANARYVAL&arch=amd64&component=client&CANARYKEY=1");
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain("CANARY");
    expect((await get(live, CHECK, { origin: "https://rs.test:4450" })).statusCode).toBe(403);
  });

  it("AC-485: politikası kapalı firmanın geçerli ref'i → notify; desen dışı / dizi / bilinmeyen ref → auto (400 değil)", async () => {
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    await testDb().tenantSettings.update({ where: { tenantId: t.id }, data: { clientAutoUpdate: false } });
    const pol = async (q: string) => (await get(live, `${CHECK}${q}`)).json<{ policy: string }>().policy;
    expect(await pol(`&ref=${ref}`)).toBe("notify");
    expect(await pol("&ref=CANARY!!")).toBe("auto");
    expect(await pol(`&ref=${ref}&ref=${ref}`)).toBe("auto");
    expect(await pol("&ref=aaaaaaaaaaaaaaaa")).toBe("auto");
    const c = await createCustomerRow(t.id);
    expect(await pol(`&ref=${c.requestRef}`)).toBe("notify");
  });

  it("AC-473: IP başına 60/sa → 61. istek 429", async () => {
    const l = await startLive({ env: ENV });
    try {
      for (let i = 0; i < 60; i++) expect((await get(l, CHECK)).statusCode).toBe(200);
      const r = await get(l, CHECK);
      expect(r.statusCode).toBe(429);
      expect(r.headers["retry-after"]).toBeDefined();
    } finally {
      await l.close();
    }
  });
});

describe("POST /public/agent/update-events (AC-487, AC-488, AC-489)", () => {
  const post = (l: Live, payload: unknown, headers: Record<string, string> = {}) =>
    l.app.inject({ method: "POST", url: "/api/v1/public/agent/update-events", headers: { ...UA, ...headers }, payload: payload as object });
  const ev = (type = "failed", reason: string | null = "HASH_MISMATCH") => ({
    type,
    version: "0.22.1",
    fromVersion: "0.22.0",
    ...(reason ? { reason } : {}),
    at: new Date().toISOString(),
  });
  const body = (o: Record<string, unknown> = {}) => ({ platform: "windows", arch: "amd64", component: "client", events: [ev()], ...o });

  it("AC-488: kimliksiz olay → 204, audit yok, metrik anonymous; geçersiz anahtar da aynı 204 (oracle yok)", async () => {
    const before = metric(live, 'rs_agent_update_rejected_total{reason="HASH_MISMATCH",source="anonymous"}');
    expect((await post(live, body())).statusCode).toBe(204);
    expect((await post(live, body({ bindingKeys: [`rsb_${"A".repeat(43)}`] }))).statusCode).toBe(204);
    expect(metric(live, 'rs_agent_update_rejected_total{reason="HASH_MISMATCH",source="anonymous"}')).toBe(before + 2);
  });

  it("AC-488/489: iki firmanın kaydı → iki firmanın audit'ine client.update.failed (fail, source binding, ağ öneki IP, UA yok)", async () => {
    const l = await startLive({ env: ENV });
    try {
      const [t1, t2] = [await createTenant(), await createTenant()];
      const [b1, b2] = [await bindingRow(t1.id), await bindingRow(t2.id)];
      expect((await post(l, body({ bindingKeys: [b1.key, b2.key, b1.key] }))).statusCode).toBe(204);
      for (const [b, t] of [
        [b1, t1],
        [b2, t2],
      ] as const) {
        const rows = await audits(b.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          tenantId: t.id,
          action: "client.update.failed",
          entity: "device_bindings",
          result: "fail",
          username: "client",
          userAgent: "",
        });
        expect(rows[0]?.ipAddress).toBe("127.0.0.0/24");
        expect(rows[0]?.newValue).toEqual({
          fromVersion: "0.22.0",
          version: "0.22.1",
          reason: "HASH_MISMATCH",
          platform: "windows",
          component: "client",
          source: "binding",
        });
        expect(JSON.stringify({ ...rows[0], id: 0 })).not.toContain("rsb_");
      }
      expect(metric(l, 'rs_agent_update_rejected_total{reason="HASH_MISMATCH",source="binding"}')).toBe(1);
      const binding = await testDb().deviceBinding.findUniqueOrThrow({ where: { id: b1.id }, select: { lastUsedAt: true } });
      expect(binding.lastUsedAt.getTime()).toBeLessThan(Date.now());
    } finally {
      await l.close();
    }
  });

  it("AC-488: kimlik başına 10 olay/sa — fazlası yazılmaz, yanıt yine 204", async () => {
    const l = await startLive({ env: ENV });
    try {
      const t = await createTenant();
      const b = await bindingRow(t.id);
      const events = Array.from({ length: 12 }, () => ev("skipped", "NOT_WRITABLE"));
      expect((await post(l, body({ bindingKeys: [b.key], events }))).statusCode).toBe(204);
      expect(await audits(b.id)).toHaveLength(10);
      expect(metric(l, 'rs_agent_update_total{platform="windows",component="client",result="rate_limited",source="binding"}')).toBe(2);
    } finally {
      await l.close();
    }
  });

  it("AC-488: IP 30 olay/sa ve 10 istek/sa → 429 (sahte olay seli)", async () => {
    const l = await startLive({ env: ENV });
    try {
      const twenty = Array.from({ length: 20 }, () => ev("available", null));
      expect((await post(l, body({ events: twenty }))).statusCode).toBe(204);
      expect((await post(l, body({ events: twenty }))).statusCode).toBe(204); // 10 kabul, 10 düşer
      expect((await post(l, body())).statusCode).toBe(429);
      for (let i = 0; i < 7; i++) await post(l, body());
      expect((await post(l, body())).statusCode).toBe(429);
    } finally {
      await l.close();
    }
  });

  it("AC-488: biçim 400 — 6 anahtar, olaysız gövde, istemci `source` beyanı; yanıt değer yansıtmaz", async () => {
    const keys = Array.from({ length: 6 }, () => `rsb_${"B".repeat(43)}`);
    expect((await post(live, body({ bindingKeys: keys }))).statusCode).toBe(400);
    expect((await post(live, body({ events: [] }))).statusCode).toBe(400);
    const r = await post(live, body({ events: [{ ...ev(), source: "device" }], CANARYKEY: "CANARYVAL" }));
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain("CANARY");
  });
});

describe("/ws/device update1 (AC-479, 485, 487, 489, 492, 493)", () => {
  it("AC-493: update1 bildirmeyen servis hiçbir update.* almaz; update1'e manifest yokken update.none", async () => {
    const { dev } = await freshDevice();
    const old = await onlineDevice(live, dev);
    await new Promise((r) => setTimeout(r, 200));
    expect(old.msgs.some((m) => (m as { t: string }).t.startsWith("update."))).toBe(false);
    old.ws.close();
    const d2 = await freshDevice();
    const c = await updDevice(bare, d2.dev);
    expect(countOf(c, "update.none")).toBe(1);
    c.ws.close();
  });

  it("AC-473/485: device.ready sonrası update.offer (servis manifesti, policy auto); update.check yeniden teklif; 4/sa sınırı", async () => {
    const { dev } = await freshDevice();
    const c = await updDevice(live, dev);
    const offer = lastOf(c, "update.offer");
    expect(offer?.policy).toBe("auto");
    expect(JSON.parse(Buffer.from(String(offer?.manifest), "base64").toString()).component).toBe("service");
    await paced(
      c,
      Array.from({ length: 5 }, () => ({ t: "update.check" })),
    );
    await waitUntil(async () => countOf(c, "update.offer") === 5);
    await new Promise((r) => setTimeout(r, 200));
    expect(countOf(c, "update.offer")).toBe(5);
    c.ws.close();
  });

  it("AC-477: update.token → Bearer ile servis dosyası (tek kullanım); sorgu dizesi ve ikinci kullanım 404", async () => {
    const { dev } = await freshDevice();
    const c = await updDevice(live, dev);
    c.send({ t: "update.token.request", version: "0.22.1" });
    await waitUntil(async () => lastOf(c, "update.token") !== undefined);
    const token = String(lastOf(c, "update.token")?.token);
    const url = "/api/v1/public/agent/update/service-file";
    expect((await get(live, `${url}?t=${token}`, { authorization: `Bearer ${token}` })).statusCode).toBe(404);
    const r = await get(live, url, { authorization: `Bearer ${token}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/octet-stream");
    expect(r.rawPayload.equals(serviceBin.bytes)).toBe(true);
    expect((await get(live, url, { authorization: `Bearer ${token}` })).statusCode).toBe(404);
    expect(live.app.updates.tokens.activeStreams).toBe(0);
    c.send({ t: "update.token.request", version: "0.22.9" });
    await waitUntil(async () => countOf(c, "update.none") === 1);
    c.ws.close();
  });

  it("AC-477: 8 eşzamanlı akış doluyken 503 + Retry-After 300, belirteç tüketilmez; SHA uyuşmazlığı 503", async () => {
    const url = "/api/v1/public/agent/update/service-file";
    const tk = live.app.updates.tokens;
    const token = tk.issue("01HZZZZZZZZZZZZZZZZZZZZZZZ", serviceBin.sha);
    const held = Array.from({ length: 8 }, () => tk.acquireStream());
    const busy = await get(live, url, { authorization: `Bearer ${token}` });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers["retry-after"]).toBe("300");
    held.forEach((r) => r?.());
    expect((await get(live, url, { authorization: `Bearer ${token}` })).statusCode).toBe(200);
    const stale = tk.issue("01HZZZZZZZZZZZZZZZZZZZZZZY", "0".repeat(64));
    expect((await get(live, url, { authorization: `Bearer ${stale}` })).statusCode).toBe(503);
  });

  it("AC-485: politika kapalıyken token istenmez (update.none); PUT ayar açık sokete yeni teklif (notify)", async () => {
    const { tenantId, dev } = await freshDevice();
    const c = await updDevice(live, dev);
    await testDb().tenantSettings.update({ where: { tenantId }, data: { clientAutoUpdate: false } });
    c.send({ t: "update.token.request", version: "0.22.1" });
    await waitUntil(async () => countOf(c, "update.none") === 1);
    c.send({ t: "update.check" });
    await waitUntil(async () => lastOf(c, "update.offer")?.policy === "notify");
    c.ws.close();
  });

  it("AC-479: update.state{installing} → DB INSTALLING + bağlantı 409 DEVICE_UPDATING, step-up tüketilmez", async () => {
    const r = await ready(live, { online: false });
    await testDb().unattendedDevice.update({ where: { id: r.dev.id }, data: { agentVersion: "0.22.0" } });
    const c = await updDevice(live, r.dev);
    c.send({ t: "update.state", phase: "installing", version: "0.22.1" });
    await waitUntil(async () => live.app.unattendedHub.isUpdating(r.dev.id));
    const row = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: r.dev.id } });
    expect(row).toMatchObject({ updateState: "INSTALLING", updateVersion: "0.22.1", updateReason: null });
    const res = await live.app.inject(connectReq(r));
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("DEVICE_UPDATING");
    const sess = await testDb().authSession.findFirstOrThrow({
      where: { userId: r.tech.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    expect(sess.stepUpAt).not.toBeNull();
    const a = await testDb().auditLog.findFirst({ where: { entityId: r.dev.id, action: "unattended.connect" }, orderBy: { id: "desc" } });
    expect(a?.newValue).toMatchObject({ failReason: "updating" });
    c.ws.close();
  });

  it("AC-487/489: update.event — failed audit (fail, source device) + durum; available tekil; installed ve device.auth temizler", async () => {
    const { tenantId, dev } = await freshDevice();
    const c = await updDevice(live, dev);
    const at = new Date().toISOString();
    const before = metric(live, 'rs_agent_update_rejected_total{reason="MANIFEST_SIGNATURE",source="device"}');
    await paced(c, [
      { t: "update.event", type: "available", version: "0.22.1", fromVersion: "0.22.0", at },
      { t: "update.event", type: "available", version: "0.22.1", fromVersion: "0.22.0", at },
      { t: "update.event", type: "failed", version: "0.22.1", fromVersion: "0.22.0", reason: "MANIFEST_SIGNATURE", at },
    ]);
    await waitUntil(async () => (await audits(dev.id)).length === 2);
    const rows = await audits(dev.id);
    expect(rows.map((x) => x.action)).toEqual(["client.update.available", "client.update.failed"]);
    expect(rows[1]).toMatchObject({ tenantId, entity: "unattended_devices", username: "device", result: "fail" });
    expect(rows[1]?.newValue).toMatchObject({ reason: "MANIFEST_SIGNATURE", source: "device", component: "service" });
    expect(metric(live, 'rs_agent_update_rejected_total{reason="MANIFEST_SIGNATURE",source="device"}')).toBe(before + 1);
    expect(await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: dev.id } })).toMatchObject({
      updateState: "FAILED",
      updateReason: "MANIFEST_SIGNATURE",
    });
    c.ws.close();
    // Yeni sürümle yeniden bağlanma (device.auth 0.22.1 ≥ hedef) → dört alan NULL.
    const c2 = await updDevice(live, dev, "0.22.1");
    expect(await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: dev.id } })).toMatchObject({
      agentVersion: "0.22.1",
      updateState: null,
      updateVersion: null,
      updateReason: null,
      updateAt: null,
    });
    await paced(c2, [
      { t: "update.event", type: "skipped", version: "0.22.2", fromVersion: "0.22.1", reason: "POLICY_OFF", at },
      { t: "update.event", type: "installed", version: "0.22.2", fromVersion: "0.22.1", at },
    ]);
    await waitUntil(async () => (await audits(dev.id)).length === 4);
    expect((await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: dev.id } })).updateState).toBeNull();
    c2.ws.close();
  });

  it("AC-488: cihaz başına 10 olay/sa — fazlası yok sayılır (soket açık kalır)", async () => {
    const { dev } = await freshDevice();
    const c = await updDevice(live, dev);
    const at = new Date().toISOString();
    await paced(
      c,
      Array.from({ length: 12 }, () => ({
        t: "update.event",
        type: "failed",
        version: "0.22.1",
        fromVersion: "0.22.0",
        reason: "DOWNLOAD",
        at,
      })),
    );
    await waitUntil(async () => (await audits(dev.id)).length === 10);
    await new Promise((r) => setTimeout(r, 300));
    expect(await audits(dev.id)).toHaveLength(10);
    expect(c.ws.readyState).toBe(c.ws.OPEN);
    c.ws.close();
  });
});
