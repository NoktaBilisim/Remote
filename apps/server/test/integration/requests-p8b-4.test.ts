// P8b-1 test turu 4 — hız kovaları, soket sınırları, bilinen kaynak ayrıcalığı ve firma indirme yolu.
// AC-130, AC-132, AC-143, AC-144; mimari-e9 §5.4, §13.6, §13.7 (G-E9-9, G-E9-11, G-E9-15/16).
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REQUEST_BUSY_MESSAGE } from "@remote/contracts/api/requests";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, testDb } from "../helpers/app.ts";
import { createRequestRow, createRequestSettings, hasMsg, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { connect, type WsClient } from "../helpers/ws.ts";

/** 22 karakter base64url cihaz anahtarı (deviceKeySchema); her çağrıda yeni (S8b-4). */
const fakeDeviceKey = (): string => randomBytes(16).toString("base64url").slice(0, 22);

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;
const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));
const strip = (b: string) => b.replace(/"requestId":"[0-9A-Z]{26}"/, "");

const EXE = Buffer.from("MZ test ikilisi — NoktaDestek P8b");
let dir: string;
let exePath: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rs-p8b4-"));
  exePath = join(dir, "NoktaDestek.exe");
  await writeFile(exePath, EXE);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
const agentEnv = () => ({
  SESSION_REF_KEY: "r".repeat(40),
  AGENT_BINARY_PATH: exePath,
  AGENT_SHA256: createHash("sha256").update(EXE).digest("hex"),
});

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});
async function boot(env: Record<string, string> = {}) {
  live = await startLive({ env: { ...PROXY, ...env } });
  return { live, rc: requestClient(live.app, live.base) };
}

const rateAudits = (tenantId: string, bucket: string) =>
  testDb().auditLog.findMany({ where: { tenantId, action: "request.rate_limited", newValue: { path: "$.bucket", equals: bucket } } });

describe("P8b-1 talep oluşturma hız kovaları (AC-144)", () => {
  it("AC-144: req.create.ip 5/sa — zod 400 de sayılır; 6. istek 429 + Retry-After 900; aşım audit'i dakikada 1; başka IP etkilenmez", async () => {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const bad = (ip: string) =>
      l.app.inject({ method: "POST", url: "/api/v1/public/requests", headers: { "x-forwarded-for": ip }, payload: { ref } });
    const ip = "198.51.100.10";
    for (let i = 0; i < 5; i++) expect((await bad(ip)).statusCode).toBe(400);
    const blocked = await bad(ip);
    expect(blocked.statusCode).toBe(429);
    expect(errCode(blocked)).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBe("900");
    expect((await rc.createReq(ref, ip)).statusCode).toBe(429); // geçerli gövde de kilitte
    expect((await bad(ip)).statusCode).toBe(429);
    expect(await rateAudits(t.id, "req.create.ip")).toHaveLength(1);
    expect((await rc.createReq(ref, "198.51.100.11")).statusCode).toBe(201);
  });

  it("AC-144: req.create.prefix 20/sa (IPv4 /24) — 4 IP × 5 sonrası aynı /24'ten 5. IP 429; komşu /24 serbest", async () => {
    const { live: l } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const bad = (ip: string) =>
      l.app.inject({ method: "POST", url: "/api/v1/public/requests", headers: { "x-forwarded-for": ip }, payload: { ref } });
    for (let h = 1; h <= 4; h++) for (let i = 0; i < 5; i++) expect((await bad(`198.51.101.${h}`)).statusCode).toBe(400);
    const r = await bad("198.51.101.5");
    expect(r.statusCode).toBe(429);
    expect(await rateAudits(t.id, "req.create.prefix")).toHaveLength(1);
    expect((await bad("198.51.102.5")).statusCode).toBe(400);
  });

  it("AC-144: IPv6 — /56 başına 20, /48 başına 40/sa (req.create.net48); 8 × /56 × 5 /64 sonrası aynı /48'ten yeni /56 429", async () => {
    const { live: l } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const bad = (ip: string) =>
      l.app.inject({ method: "POST", url: "/api/v1/public/requests", headers: { "x-forwarded-for": ip }, payload: { ref } });
    const v6 = (p56: number, p64: number) => `2001:db8:4801:${p56.toString(16).padStart(2, "0")}${p64.toString(16).padStart(2, "0")}::1`;
    for (let p = 0; p < 8; p++) for (let i = 0; i < 5; i++) expect((await bad(v6(p, i))).statusCode).toBe(400);
    const r = await bad(v6(9, 0));
    expect(r.statusCode).toBe(429);
    expect(await rateAudits(t.id, "req.create.net48")).toHaveLength(1);
    expect(await rateAudits(t.id, "req.create.prefix")).toHaveLength(0);
    expect((await bad("2001:db8:4802:100::1")).statusCode).toBe(400); // başka /48
  });

  it("AC-144: req.ref_invalid 10/dk — 11. geçersiz ref 429 ve 15 dk kilit tüm ref'li uçlarda (geçerli ref dahil)", async () => {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const ip = "198.51.103.7";
    for (let i = 0; i < 10; i++) expect((await rc.tenantInfo("abcdefghijklmno" + "a", ip)).statusCode).toBe(404);
    const r = await rc.tenantInfo("abcdefghijklmnop", ip);
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(800);
    expect((await rc.tenantInfo(ref, ip)).statusCode).toBe(429);
    expect(
      (await l.app.inject({ method: "GET", url: `/api/v1/public/agent/request-download?ref=${ref}`, headers: { "x-forwarded-for": ip } }))
        .statusCode,
    ).toBe(429);
    expect((await rc.createReq(ref, ip, { consentTextId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).statusCode).toBe(429);
    await expect(rc.reqWs("A".repeat(43), { "x-forwarded-for": ip })).rejects.toThrow("HTTP 429");
    expect((await rc.tenantInfo(ref, "198.51.103.8")).statusCode).toBe(200);
  });

  it("AC-144: tenant 60/sa → bilinmeyen kaynak 429 (genel mesaj) + panele queue.alert (pencere başına 1); güvenilen kaynak geçer, bilinen tavanı 120/sa", async () => {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id, { trustedCidrs: ["192.0.2.0/24"] });
    const x = await loginAs(l.app, await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS }));
    const panel = await rc.panelWs(x.token);
    await waitMsg(panel, "queue.count");
    const consentTextId = await rc.consentId(ref, "198.51.110.1");
    for (let i = 0; i < 60; i++) {
      const ip = `198.${52 + Math.floor(i / 200)}.${i % 200}.9`; // her biri ayrı /24 ve IP
      const r = await rc.createReq(ref, ip, { consentTextId });
      expect(r.statusCode, `talep ${i}`).toBe(201);
      expect((await rc.cancel(r.json<{ requestSecret: string }>().requestSecret, ip)).statusCode).toBe(204); // bekleyen sınırına takılmasın
    }
    const over = await rc.createReq(ref, "198.60.1.9", { consentTextId });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: { code: "RATE_LIMITED", message: REQUEST_BUSY_MESSAGE } });
    const alert = await waitMsg<{ kind: string; until: string }>(panel, "queue.alert");
    expect(alert.kind).toBe("rate_limited");
    expect(Date.parse(alert.until)).toBeGreaterThan(Date.now());
    expect((await rc.createReq(ref, "198.60.2.9", { consentTextId })).statusCode).toBe(429);
    await tick();
    expect(hasMsg(panel, "queue.alert")).toBe(false); // ikinci uyarı yok
    expect(await rateAudits(t.id, "tenant")).toHaveLength(1);

    const trusted = await rc.createReq(ref, "192.0.2.10", { consentTextId });
    expect(trusted.statusCode).toBe(201);
    expect(
      await testDb().supportRequest.findUniqueOrThrow({ where: { id: trusted.json<{ requestId: string }>().requestId } }),
    ).toMatchObject({ networkMatch: "TRUSTED" });
    // bilinen tavanı: 120/sa (sayaç doğrudan doldurulur; 119 ek kabul ile aynı durum)
    for (let i = 0; i < 119; i++) l.app.requests.d.limits.tenantKnown.add(t.id);
    const cap = await rc.createReq(ref, "192.0.2.11", { consentTextId });
    expect(cap.statusCode).toBe(429);
    expect(errCode(cap)).toBe("RATE_LIMITED");
  }, 60_000);
});

describe("P8b-1 bilinen kaynak ayrıcalığı (AC-143, G-E9-15)", () => {
  it("AC-143: bekleyen ≥ 40 iken yalnız TRUSTED/known_device geçer — daha önce oturum yapılmış IP (networkMatch IP) ve önek (PREFIX) 429 QUEUE_FULL", async () => {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const deviceKey = fakeDeviceKey(); // S8b-4: çalışma anında üretilir (gitleaks sabit görmez)
    const knownIp = "198.51.120.15";

    // 1) Bilinen cihaz + ağ: talep → kabul → misafir admit (oturum consumed)
    const c = (await rc.createReq(ref, knownIp, { deviceKey })).json<{ requestId: string; requestSecret: string }>();
    const ws = await rc.reqWs(c.requestSecret, { "x-forwarded-for": knownIp });
    await waitMsg(ws, "request.state");
    const x = await loginAs(l.app, await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS }));
    expect((await rc.accept(x.headers, c.requestId)).statusCode).toBe(200);
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(ws, "request.accepted");
    const g = await connect(`${l.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`], { "x-forwarded-for": knownIp });
    await waitMsg(g, "hello");
    await expect
      .poll(async () => (await testDb().supportSession.findFirstOrThrow({ where: { requestId: c.requestId } })).consumedAt)
      .not.toBeNull();

    // 2) Tenant'ı 40 bekleyene doldur (farklı IP'ler)
    for (let i = 0; i < 40; i++) await createRequestRow(t.id, { ip: `203.0.113.${i + 10}` });

    const consentTextId = await rc.consentId(ref, "198.51.121.1");
    const ipKnown = await rc.createReq(ref, knownIp, { consentTextId });
    expect(ipKnown.statusCode).toBe(429);
    expect(errCode(ipKnown)).toBe("QUEUE_FULL");
    const prefixKnown = await rc.createReq(ref, "198.51.120.99", { consentTextId });
    expect(prefixKnown.statusCode).toBe(429);
    expect(errCode(prefixKnown)).toBe("QUEUE_FULL");

    const dev = await rc.createReq(ref, "198.51.122.5", { consentTextId, deviceKey });
    expect(dev.statusCode).toBe(201);
    expect(await testDb().supportRequest.findUniqueOrThrow({ where: { id: dev.json<{ requestId: string }>().requestId } })).toMatchObject({
      knownDevice: true,
      networkMatch: "NONE",
    });
    // bilinmeyen cihaz anahtarı ayrıcalık getirmez
    const otherDev = await rc.createReq(ref, "198.51.123.5", { consentTextId, deviceKey: fakeDeviceKey() });
    expect(errCode(otherDev)).toBe("QUEUE_FULL");
  });
});

describe("P8b-1 WebSocket soket sınırları (G-E9-9, G-E9-16)", () => {
  async function pendingSecrets(rc: ReturnType<typeof requestClient>, ref: string, n: number, base: number) {
    const out: string[] = [];
    for (let i = 0; i < n; i++)
      out.push((await rc.createReq(ref, `198.51.${base}.${i + 1}`)).json<{ requestSecret: string }>().requestSecret);
    return out;
  }

  it("G-E9-9: /ws/request IP başına 5 eşzamanlı soket — 6. upgrade 429; biri kapanınca yer açılır. Güvenilen CIDR kaynağı muaf ve sayıma girmez", async () => {
    const { rc } = await boot();
    const a = await createTenant();
    const refA = await createRequestSettings(a.id);
    const secrets = await pendingSecrets(rc, refA, 7, 130);
    const shared = { "x-forwarded-for": "198.51.140.1" };
    const open: WsClient[] = [];
    for (const s of secrets.slice(0, 5)) open.push(await rc.reqWs(s, shared));
    await expect(rc.reqWs(secrets[5] ?? "", shared)).rejects.toThrow("HTTP 429");
    const first = open[0];
    if (!first) throw new Error("soket yok");
    first.ws.terminate();
    await first.closed;
    await expect
      .poll(
        async () =>
          rc.reqWs(secrets[5] ?? "", shared).then(
            (w) => (open.push(w), "ok"),
            (e: Error) => e.message,
          ),
        { interval: 50 },
      )
      .toBe("ok");

    const b = await createTenant();
    const refB = await createRequestSettings(b.id, { trustedCidrs: ["192.0.2.0/24"] });
    const trustedSecrets = await pendingSecrets(rc, refB, 7, 131);
    const trustedIp = { "x-forwarded-for": "192.0.2.77" };
    for (const s of trustedSecrets) open.push(await rc.reqWs(s, trustedIp)); // 7 > 5: muaf
    // aynı IP'den güvenilmeyen tenant'ın soketleri ayrı sayılır (güvenilenler sayıma girmedi)
    const more = await pendingSecrets(rc, refA, 6, 132);
    for (const s of more.slice(0, 5)) open.push(await rc.reqWs(s, trustedIp));
    await expect(rc.reqWs(more[5] ?? "", trustedIp)).rejects.toThrow("HTTP 429");
    for (const w of open) w.ws.terminate();
  });

  it("G-E9-9: /ws/panel kullanıcı başına 5 soket — 6. açılır ve 4429 ile kapanır; aynı tenant'taki başka kullanıcı etkilenmez", async () => {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const u1 = await loginAs(l.app, await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS }));
    const u2 = await loginAs(l.app, await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS }));
    const socks: WsClient[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await rc.panelWs(u1.token);
      await waitMsg(p, "queue.count");
      socks.push(p);
    }
    const sixth = await rc.panelWs(u1.token);
    expect((await sixth.closed).code).toBe(4429);
    const other = await rc.panelWs(u2.token);
    expect(await waitMsg(other, "queue.count")).toMatchObject({ pending: 0 });
    expect(socks.every((s) => s.ws.readyState === s.ws.OPEN)).toBe(true);
    // biri kapanınca yeni soket açılabilir
    socks[0]?.ws.close();
    await socks[0]?.closed;
    await expect
      .poll(async () => {
        const p = await rc.panelWs(u1.token);
        const r = await Promise.race([waitMsg(p, "queue.count", 500).then(() => "ok"), p.closed.then((c) => String(c.code))]);
        if (r === "ok") socks.push(p);
        return r;
      })
      .toBe("ok");
    for (const s of [...socks, other]) s.ws.close();
  });
});

describe("P8b-1 firma indirme yolu (AC-130, AC-132, G-E9-11)", () => {
  const ready = (app: Live["app"], uri: string) =>
    app.inject({
      method: "GET",
      url: "/internal/agent-ready",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-method": "GET", "x-forwarded-uri": uri },
    });

  it("G-E9-11: forward_auth — aktif ref + güncel label 204; yanlış label, yenilenmiş ref, pasif tenant, bilinmeyen ref → aynı 404 gövdesi", async () => {
    const { live: l } = await boot(agentEnv());
    const t = await createTenant();
    const ref = await createRequestSettings(t.id); // fileLabel "TestFirma"
    const ok = await ready(l.app, `/downloads/NoktaDestek-TestFirma-${ref}.exe`);
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe("");
    expect((await ready(l.app, `/downloads/NoktaDestek-TestFirma-${ref}.exe?x=1`)).statusCode).toBe(204);
    expect((await ready(l.app, "/downloads/Destek-12345678.exe")).statusCode).toBe(204); // P6 yolu yalnız ikili kapısı

    const unknown = await ready(l.app, "/downloads/NoktaDestek-TestFirma-abcdefghijklmnop.exe");
    expect(unknown.statusCode).toBe(404);
    const bodies = [unknown.body];
    for (const uri of [
      `/downloads/NoktaDestek-BaskaFirma-${ref}.exe`,
      `/downloads/NoktaDestek-TestFirma-${ref}.exe.bak`,
      `/downloads/NoktaDestek--${ref}.exe`,
      "/downloads/NoktaDestek-x",
    ]) {
      const r = await ready(l.app, uri);
      expect(r.statusCode, uri).toBe(404);
      bodies.push(r.body);
    }
    await testDb().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { requestRef: "zzzzzzzzzzzzzzz2" } });
    const rotated = await ready(l.app, `/downloads/NoktaDestek-TestFirma-${ref}.exe`);
    expect(rotated.statusCode).toBe(404);
    bodies.push(rotated.body);
    await testDb().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { requestRef: ref } });
    await testDb().tenant.update({ where: { id: t.id }, data: { status: "PASSIVE" } });
    const passive = await ready(l.app, `/downloads/NoktaDestek-TestFirma-${ref}.exe`);
    expect(passive.statusCode).toBe(404);
    bodies.push(passive.body);
    expect(new Set(bodies.map(strip)).size).toBe(1);
  });

  it("AC-130/132: request-download başarılı yol 302 → /downloads/NoktaDestek-<label>-<ref>.exe (no-store, çerez yok); ikili hazır değilse 503; IP başına 30/sa", async () => {
    const { live: l } = await boot(agentEnv());
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const dl = (ip: string) =>
      l.app.inject({ method: "GET", url: `/api/v1/public/agent/request-download?ref=${ref}`, headers: { "x-forwarded-for": ip } });
    const r = await dl("198.51.150.1");
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`/downloads/NoktaDestek-TestFirma-${ref}.exe`);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect((await ready(l.app, String(r.headers.location))).statusCode).toBe(204); // Caddy'nin sonraki sorusu
    for (let i = 0; i < 29; i++) expect((await dl("198.51.150.1")).statusCode).toBe(302);
    expect((await dl("198.51.150.1")).statusCode).toBe(429);
    expect((await dl("198.51.150.2")).statusCode).toBe(302);
    await l.close();

    live = await startLive({ env: PROXY }); // ikili yapılandırılmamış
    const nr = await live.app.inject({
      method: "GET",
      url: `/api/v1/public/agent/request-download?ref=${ref}`,
      headers: { "x-forwarded-for": "198.51.150.3" },
    });
    expect(nr.statusCode).toBe(503);
    expect(errCode(nr)).toBe("NOT_READY");
  });
});
