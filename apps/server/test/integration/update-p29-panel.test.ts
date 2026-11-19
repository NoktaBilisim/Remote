// P29-K4 panel uçları (mimari-p29 §4.8; AC-485, 486, 490, 491): cihaz listesi sürüm alanları + süzgeç, sürüm dağılımı (tenant
// izolasyonu, `scope=all` yalnız Super Admin), Ayarlar → İstemciler (audit), bindings/status `autoUpdate`, audit geri okuma.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DeviceListResponse, DeviceVersionsResponse } from "@remote/contracts/api/unattended";
import { createTenant, createUser, loginAs, testDb, type Session } from "../helpers/app.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { createDeviceRow, UNSIGNED_ENV } from "../helpers/unattended.ts";
import { bindingRow, manifest, newSigner, updateFixture, writeManifest } from "../helpers/update.ts";

const f = updateFixture();
const signer = newSigner();
const serviceBin = f.binary("NoktaDestekServis.exe");
writeManifest(f.dir, signer, manifest({ sha256: serviceBin.sha, component: "service", version: "0.22.10" }));
let live: Live;
beforeAll(async () => {
  live = await startLive({
    env: {
      ...UNSIGNED_ENV,
      UNATTENDED_AGENT_PATH: serviceBin.path,
      UNATTENDED_AGENT_SHA256: serviceBin.sha,
      UPDATE_MANIFEST_DIR: f.dir,
      UPDATE_MANIFEST_PUBKEYS: signer.publicKey,
      MIN_AGENT_VERSION: "0.20.0",
    },
  });
});
afterAll(async () => live.close());

const get = <T>(s: Session, url: string) =>
  live.app.inject({ method: "GET", url, headers: s.headers }).then((r) => ({ r, body: r.json<T>() }));

async function tenantWithDevices(versions: { v: string; state?: Record<string, unknown> }[]) {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const customer = await createCustomerRow(t.id);
  const ids: string[] = [];
  for (const d of versions) {
    const id = await createDeviceRow({ tenantId: t.id, customerId: customer.id });
    await testDb().unattendedDevice.update({ where: { id }, data: { agentVersion: d.v, ...d.state } });
    ids.push(id);
  }
  return { tenantId: t.id, s: await loginAs(live.app, admin), ids };
}

describe("GET /unattended/devices sürüm alanları (AC-486, AC-490)", () => {
  it("AC-490: agentVersion + rozet (BELOW_MIN, UPDATING, FAILED+neden, PENDING, CURRENT) ve ?version= süzgeci", async () => {
    const now = new Date();
    const { s, ids } = await tenantWithDevices([
      { v: "0.19.9" },
      { v: "0.22.0", state: { updateState: "INSTALLING", updateVersion: "0.22.10", updateAt: now } },
      { v: "0.22.0", state: { updateState: "FAILED", updateVersion: "0.22.10", updateReason: "HASH_MISMATCH", updateAt: now } },
      { v: "0.22.9" },
      { v: "0.22.10" },
    ]);
    const { body } = await get<DeviceListResponse>(s, "/api/v1/unattended/devices?limit=50");
    const by = new Map(body.items.map((i) => [i.id, i]));
    expect(ids.map((id) => by.get(id)?.updateBadge)).toEqual(["BELOW_MIN", "UPDATING", "FAILED", "PENDING", "CURRENT"]);
    expect(by.get(ids[2] ?? "")).toMatchObject({ agentVersion: "0.22.0", updateReason: "HASH_MISMATCH", updateVersion: "0.22.10" });
    expect(by.get(ids[3] ?? "")?.updateReason).toBeNull();
    const filtered = await get<DeviceListResponse>(s, "/api/v1/unattended/devices?version=0.22.0");
    expect(filtered.body.items.map((i) => i.id).sort()).toEqual([ids[1], ids[2]].sort());
    expect((await get(s, "/api/v1/unattended/devices?version=0.22")).r.statusCode).toBe(400);
  });
});

describe("GET /unattended/versions (AC-490 IDOR)", () => {
  it("AC-490: firma kapsamı — başka firmanın cihazı sayılmaz; yayındaki servis sürümü; belowMin", async () => {
    const a = await tenantWithDevices([{ v: "0.22.9" }, { v: "0.22.9" }, { v: "0.19.0" }]);
    await tenantWithDevices([{ v: "0.22.9" }, { v: "0.21.0" }]);
    const { r, body } = await get<DeviceVersionsResponse>(a.s, "/api/v1/unattended/versions");
    expect(r.statusCode).toBe(200);
    expect(body.rows).toEqual([
      { platform: "windows", component: "service", version: "0.22.9", count: 2 },
      { platform: "windows", component: "service", version: "0.19.0", count: 1 },
    ]);
    expect(body.belowMin).toBe(1);
    expect(body.published.service?.version).toBe("0.22.10");
    expect(body.published.client).toEqual({ windows: null, macos: null, linux: null });
  });

  it("AC-490: scope=all Super Admin dışında 403; Super Admin tüm firmaları görür (firma seçmeden); yetkisiz kullanıcı 403", async () => {
    const a = await tenantWithDevices([{ v: "7.7.7" }]);
    expect((await get(a.s, "/api/v1/unattended/versions?scope=all")).r.statusCode).toBe(403);
    await tenantWithDevices([{ v: "7.7.7" }]);
    const sa = await loginAs(live.app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    expect((await get(sa, "/api/v1/unattended/versions")).r.statusCode).toBe(403);
    const all = await get<DeviceVersionsResponse>(sa, "/api/v1/unattended/versions?scope=all");
    expect(all.r.statusCode).toBe(200);
    expect(all.body.rows.find((x) => x.version === "7.7.7")?.count).toBeGreaterThanOrEqual(2);
    const user = await loginAs(live.app, await createUser({ tenantId: (await createTenant()).id, role: "USER" }));
    expect((await get(user, "/api/v1/unattended/versions")).r.statusCode).toBe(403);
    expect((await get(a.s, "/api/v1/unattended/versions?scope=x")).r.statusCode).toBe(400);
  });

  it("AC-490: rs_unattended_agent_versions göstergesi (sürüm etiketi, desen dışı yok)", async () => {
    await live.app.updateVersions.refreshGauge();
    const lines = live.app.metrics
      .render()
      .split("\n")
      .filter((l) => l.startsWith("rs_unattended_agent_versions{"));
    expect(lines.some((l) => l.startsWith('rs_unattended_agent_versions{version="7.7.7"}'))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(51);
  });
});

describe("Ayarlar → İstemciler (AC-485)", () => {
  const put = (s: Session, autoUpdate: unknown) =>
    live.app.inject({ method: "PUT", url: "/api/v1/settings/client-update", headers: s.headers, payload: { autoUpdate } });

  it("AC-485: varsayılan Açık; PUT step-up'sız, audit settings.client_update {old,new}; değişmeyen PUT audit yazmaz; firma izolasyonu", async () => {
    const a = await tenantWithDevices([]);
    const b = await tenantWithDevices([]);
    expect((await get(a.s, "/api/v1/settings/client-update")).body).toEqual({ autoUpdate: true });
    const r = await put(a.s, false);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ autoUpdate: false });
    await put(a.s, false);
    const rows = await testDb().auditLog.findMany({ where: { tenantId: a.tenantId, action: "settings.client_update" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity: "tenant_settings",
      entityId: a.tenantId,
      oldValue: { autoUpdate: true },
      newValue: { autoUpdate: false },
    });
    expect((await get(b.s, "/api/v1/settings/client-update")).body).toEqual({ autoUpdate: true });
    expect((await put(a.s, "false")).statusCode).toBe(400);
  });

  it("AC-485: settings.edit olmayan kullanıcı 403, settings.view olmayan GET 403", async () => {
    const t = await createTenant();
    const user = await loginAs(live.app, await createUser({ tenantId: t.id, role: "USER" }));
    expect((await get(user, "/api/v1/settings/client-update")).r.statusCode).toBe(403);
    expect((await put(user, false)).statusCode).toBe(403);
  });

  it("AC-485: bindings/status yanıtında firmanın politikası (autoUpdate)", async () => {
    const t = await createTenant();
    const b = await bindingRow(t.id);
    const status = () =>
      live.app.inject({
        method: "POST",
        url: "/api/v1/public/bindings/status",
        headers: { "user-agent": "NoktaDestek/0.22.0" },
        payload: { bindingKey: b.key, clientVersion: "0.22.0" },
      });
    expect((await status()).json<{ autoUpdate: boolean }>().autoUpdate).toBe(true);
    await testDb().tenantSettings.update({ where: { tenantId: t.id }, data: { clientAutoUpdate: false } });
    expect((await status()).json<{ autoUpdate: boolean }>().autoUpdate).toBe(false);
  });
});

describe("Audit geri okuma (AC-491)", () => {
  it("AC-491: GET /audit?action=client.update.* satırları döner; source/reason/version alanları korunur", async () => {
    const a = await tenantWithDevices([{ v: "0.22.0" }]);
    const deviceId = a.ids[0] ?? "";
    await testDb().auditLog.create({
      data: {
        tenantId: a.tenantId,
        username: "device",
        action: "client.update.failed",
        entity: "unattended_devices",
        entityId: deviceId,
        result: "fail",
        newValue: {
          fromVersion: "0.22.0",
          version: "0.22.1",
          reason: "ENV_MISMATCH",
          platform: "windows",
          component: "service",
          source: "device",
        },
        ipAddress: "127.0.0.1",
        correlationId: "x",
      },
    });
    const admin = await createUser({ tenantId: a.tenantId, role: "ADMIN" });
    const s = await loginAs(live.app, admin);
    const { r, body } = await get<{ items: { action: string; newValue: Record<string, unknown> }[] }>(
      s,
      "/api/v1/audit?action=client.update.*",
    );
    expect(r.statusCode).toBe(200);
    expect(body.items[0]).toMatchObject({
      action: "client.update.failed",
      newValue: { reason: "ENV_MISMATCH", version: "0.22.1", source: "device" },
    });
  });
});
