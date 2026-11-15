// P27-K3 `/ws/device` kanalı (mimari-p27 §4.4 r2, §7.2–7.3; AC-273, 275, 297, 339; D-P27-1, D-P27-3, K-P27-21). Gerçek
// dinleyen sunucu + Ed25519 anahtarlı sahte servis. Kimliksiz soket tavanı test için küçültülür (`signaling.deviceUnauth`);
// 10 sn auth süresi ve 10 dk 4409 penceresi sahte saatle (`rooms.clock`).
import { DEVICE_AUTH_TIMEOUT_MS, WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, testDb } from "../helpers/app.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { SHA, UNSIGNED_ENV, grantRow } from "../helpers/unattended.ts";
import { authMsg, keyedDevice, onlineDevice, rawDevice, waitUntil } from "../helpers/unattended-device.ts";
import { connect, FakeClock, type WsClient } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
let live: Live;
let capped: Live;
let signed: Live;
let faked: Live;
let raced: Live;
const clock = new FakeClock();
/** D-P27-K1: kimlik doğrulandıktan sonra hub'a eklemeden önce bekletilen cihazlar. */
const holds = new Map<string, { entered: () => void; go: Promise<void> }>();

function hold(deviceId: string): { entered: Promise<void>; release: () => void } {
  let entered = (): void => undefined;
  let release = (): void => undefined;
  const e = new Promise<void>((r) => (entered = r));
  const go = new Promise<void>((r) => (release = r));
  holds.set(deviceId, { entered, go });
  return { entered: e, release };
}
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
  capped = await startLive({ env: { ...UNSIGNED_ENV, ...PROXY }, signaling: { deviceUnauth: { max: 7, perIp: 5 } } });
  signed = await startLive({ env: { UNATTENDED_MODE: "signed", DEPLOY_ENV: "staging", UNATTENDED_SIGNED_SHA256: SHA } });
  faked = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { clock } });
  const deviceBeforeAttach = async (id: string): Promise<void> => {
    const h = holds.get(id);
    if (!h) return;
    h.entered();
    await h.go;
  };
  raced = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { deviceBeforeAttach } });
});
afterAll(async () => {
  await Promise.all([live, capped, signed, faked, raced].map((l) => l.close()));
});

const audits = (entityId: string, action: string) => testDb().auditLog.findMany({ where: { entityId, action }, orderBy: { id: "asc" } });
const metric = (l: Live, series: string): number => {
  const line = l.app.metrics
    .render()
    .split("\n")
    .find((x) => x.startsWith(`${series} `));
  return line ? Number(line.split(" ").pop()) : 0;
};

async function freshDevice(o: { lastIp?: string } = {}) {
  const t = await createTenant();
  const customer = await createCustomerRow(t.id);
  return { tenantId: t.id, customerId: customer.id, dev: await keyedDevice(t.id, customer.id, o) };
}

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => "open",
    (e: Error) => e.message,
  );

describe("P27-K3 /ws/device upgrade öncesi ret", () => {
  it("AC-339 G-10: sorgu dizesi, Origin başlığı, yanlış alt protokol → 403 (soket açılmaz)", async () => {
    const url = `${live.base}/ws/device`;
    expect(await rejection(connect(`${url}?deviceId=x`, [WS_DEVICE_SUBPROTOCOL]))).toBe("HTTP 403");
    expect(await rejection(connect(url, [WS_DEVICE_SUBPROTOCOL], { origin: "https://rs.test:4450" }))).toBe("HTTP 403");
    expect(await rejection(connect(url, ["rs.v1"]))).toBe("HTTP 403");
  });

  it("AC-339 D-P27-1: kimliksiz soket IP başına 5 (6. → 503), süreç geneli tavan (→ 503) + metrik unauth_cap; auth sayaçtan düşürür", async () => {
    const from = (ip: string) => rawDevice(capped, { "x-forwarded-for": ip });
    const open: WsClient[] = [];
    for (let i = 0; i < 5; i++) open.push((await from("203.0.113.1")).c);
    expect(await rejection(from("203.0.113.1"))).toBe("HTTP 503");
    for (let i = 0; i < 2; i++) open.push((await from("203.0.113.2")).c);
    expect(await rejection(from("203.0.113.3"))).toBe("HTTP 503"); // toplam 7 = tavan
    expect(metric(capped, 'rs_unattended_device_auth_total{result="unauth_cap"}')).toBe(2);
    open.shift()?.ws.close(); // bir yer boşalır
    const next = await waitUntilOpen(() => from("203.0.113.4"));
    expect(await rejection(from("203.0.113.5"))).toBe("HTTP 503"); // yine tavanda
    const { dev } = await freshDevice();
    next.c.send(authMsg(dev, next.nonce));
    await next.c.waitFor("device.ready" as never); // kimliği doğrulanan soket kimliksiz sayaçtan düşer
    open.push(next.c, (await from("203.0.113.5")).c);
    for (const c of open) c.ws.close();
  });
});

async function waitUntilOpen<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const r = await fn().catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("soket açılamadı");
}

describe("P27-K3 /ws/device kimlik doğrulaması", () => {
  it("AC-273: kötü imza → 4401 + audit device.auth{fail, bad_sig} + metrik; bilinmeyen cihaz → 4401", async () => {
    const { dev } = await freshDevice();
    const { c, nonce } = await rawDevice(live);
    c.send(authMsg(dev, nonce, { sig: dev.sig("baska-nonce") }));
    expect((await c.closed).code).toBe(4401);
    expect((await audits(dev.id, "unattended.device.auth"))[0]).toMatchObject({ result: "fail", newValue: { reason: "bad_sig" } });
    expect(metric(live, 'rs_unattended_device_auth_total{result="bad_sig"}')).toBeGreaterThanOrEqual(1);
    const u = await rawDevice(live);
    u.c.send({ ...authMsg(dev, u.nonce), deviceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect((await u.c.closed).code).toBe(4401);
  });

  it("AC-275: iptal edilmiş cihaz → revoked{} + 4401 (servis yeniden bağlanmayı bırakır)", async () => {
    const { dev } = await freshDevice();
    await testDb().unattendedDevice.update({ where: { id: dev.id }, data: { revokedAt: new Date(), revokeReason: "ADMIN", lastIp: null } });
    const { c, nonce } = await rawDevice(live);
    c.send(authMsg(dev, nonce));
    await c.waitFor("revoked" as never);
    expect((await c.closed).code).toBe(4401);
  });

  it("AC-297: imza kapısı (signed mod) — imzasız beyan 4403, imzalı + listedeki SHA → device.ready", async () => {
    const { dev } = await freshDevice();
    const { c, nonce } = await rawDevice(signed);
    c.send(authMsg(dev, nonce));
    expect((await c.closed).code).toBe(4403);
    expect((await audits(dev.id, "unattended.device.auth"))[0]?.newValue).toMatchObject({ reason: "gate" });
    const ok = await onlineDevice(signed, dev, { signed: true, sha256: SHA });
    expect(signed.app.unattendedHub.isOnline(dev.id)).toBe(true);
    ok.ws.close();
  });

  it("AC-339 D-P27-3: IP değiştiyse audit device.auth{success, ipChanged}; aynı IP'de audit yok; beyan alanları yazılır", async () => {
    const moved = await freshDevice({ lastIp: "198.51.100.9" });
    const same = await freshDevice();
    const a = await onlineDevice(live, moved.dev, { version: "1.2.3" });
    const b = await onlineDevice(live, same.dev);
    const rows = await audits(moved.dev.id, "unattended.device.auth");
    expect(rows.map((r) => [r.result, r.newValue])).toEqual([["success", { ipChanged: true, previousIp: "198.51.100.9" }]]);
    expect(await audits(same.dev.id, "unattended.device.auth")).toHaveLength(0);
    const row = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: moved.dev.id } });
    expect(row.agentVersion).toBe("1.2.3");
    expect(row.lastIp).not.toBe("198.51.100.9");
    a.ws.close();
    b.ws.close();
  });

  it("AC-339: 10 sn içinde device.auth gelmezse 4401 auth_timeout (sahte saat)", async () => {
    const { c } = await rawDevice(faked);
    clock.advance(DEVICE_AUTH_TIMEOUT_MS - 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(c.ws.readyState).toBe(c.ws.OPEN);
    clock.advance(1);
    expect(await c.closed).toEqual({ code: 4401, reason: "auth_timeout" });
  });

  it("AC-273 §5.3: device.unregister → iptal UNINSTALLED (grant'lar silinir) + revoked{} + 4401 + audit", async () => {
    const f = await freshDevice();
    const tech = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "unattended.connect": true } });
    await grantRow(f.tenantId, f.dev.id, tech.id);
    const c = await onlineDevice(live, f.dev);
    c.send({ t: "device.unregister" });
    await c.waitFor("revoked" as never);
    expect((await c.closed).code).toBe(4401);
    const row = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: f.dev.id } });
    expect(row).toMatchObject({ revokeReason: "UNINSTALLED", revokedBy: null, lastIp: null });
    expect(row.revokedAt).not.toBeNull();
    expect(await testDb().unattendedDeviceGrant.count({ where: { deviceId: f.dev.id } })).toBe(0);
    expect((await audits(f.dev.id, "unattended.device.revoked"))[0]?.newValue).toMatchObject({ reason: "UNINSTALLED", removedGrants: 1 });
    expect(live.app.unattendedHub.isOnline(f.dev.id)).toBe(false);
  });
});

describe("P27 D-P27-K1 kimlik doğrulama ile iptal / firma pasifi yarışı", () => {
  it("AC-275 D-P27-K1: iptal, kimlik okunduktan sonra ama hub'a eklemeden önce commit edilirse revoked{} + 4401; cihaz çevrimdışı", async () => {
    const f = await freshDevice();
    const admin = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const s = await loginAs(raced.app, admin);
    const h = hold(f.dev.id);
    const { c, nonce } = await rawDevice(raced);
    c.send(authMsg(f.dev, nonce));
    await h.entered;
    const r = await raced.app.inject({ method: "POST", url: `/api/v1/unattended/devices/${f.dev.id}/revoke`, headers: s.headers });
    expect(r.statusCode).toBe(204);
    h.release();
    await c.waitFor("revoked" as never);
    expect((await c.closed).code).toBe(4401);
    expect(raced.app.unattendedHub.isOnline(f.dev.id)).toBe(false);
    expect(metric(raced, 'rs_unattended_device_auth_total{result="revoked"}')).toBeGreaterThanOrEqual(1);
  });

  it("AC-275 D-P27-K1: aynı pencerede firma pasife alınırsa 4401 tenant_passive (device.ready yok); yarış yoksa normal device.ready", async () => {
    const f = await freshDevice();
    const h = hold(f.dev.id);
    const { c, nonce } = await rawDevice(raced);
    c.send(authMsg(f.dev, nonce));
    await h.entered;
    await testDb().tenant.update({ where: { id: f.tenantId }, data: { status: "PASSIVE" } });
    raced.app.unattendedHub.closeByTenant(f.tenantId); // deactivate.ts commit sonrası çağrısı — soket henüz hub'da değil
    h.release();
    expect(await c.closed).toEqual({ code: 4401, reason: "tenant_passive" });
    expect(raced.app.unattendedHub.isOnline(f.dev.id)).toBe(false);
    const g = await freshDevice();
    const ok = await onlineDevice(raced, g.dev);
    expect(raced.app.unattendedHub.isOnline(g.dev.id)).toBe(true);
    ok.ws.close();
  });
});

describe("P27-K3 aynı cihazın yeniden bağlanması (4409, D-P27-3)", () => {
  it("AC-339: eski soket 4409; 10 dk'da > 3 → replacedAlert rozeti + metrik + audit 10 dk'da en çok 1; pencere geçince rozet söner", async () => {
    const f = await freshDevice();
    const before = metric(faked, "rs_unattended_device_replaced_total");
    let cur = await onlineDevice(faked, f.dev);
    const replaceOnce = async (): Promise<void> => {
      const next = await onlineDevice(faked, f.dev);
      expect((await cur.closed).code).toBe(4409);
      cur = next;
    };
    for (let i = 0; i < 3; i++) await replaceOnce();
    expect(faked.app.unattendedHub.replacedAlert(f.dev.id)).toBe(false);
    await replaceOnce();
    await replaceOnce();
    expect(faked.app.unattendedHub.replacedAlert(f.dev.id)).toBe(true);
    expect(metric(faked, "rs_unattended_device_replaced_total") - before).toBe(5);
    await waitUntil(async () => (await audits(f.dev.id, "unattended.device.replaced")).length === 1);
    const admin = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const s = await loginAs(faked.app, admin);
    const list = await faked.app.inject({ method: "GET", url: "/api/v1/unattended/devices", headers: s.headers });
    const item = list.json<{ items: { id: string; replacedAlert: boolean }[] }>().items.find((d) => d.id === f.dev.id);
    expect(item?.replacedAlert).toBe(true);
    clock.advance(10 * 60_000 + 1);
    expect(faked.app.unattendedHub.replacedAlert(f.dev.id)).toBe(false);
    for (let i = 0; i < 4; i++) await replaceOnce();
    await waitUntil(async () => (await audits(f.dev.id, "unattended.device.replaced")).length === 2);
    cur.ws.close();
  });
});
