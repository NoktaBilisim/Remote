// P28f K6 sunucu tarafı (mimari-p28f §4.1–4.2, §8.1, §13 S-P28f-3/-15; AC-390, AC-391, AC-396, AC-27): resolve `clientOs`,
// join audit `os`, indirme `os`, availability, platform başına agent-ready, MAC_AGENT_* env, control.state OS_PERMISSION.
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import { controlStateSchema } from "@remote/contracts/ws";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AGENT_BINARY_PATH_FIXED, loadEnv, MAC_AGENT_PATH_FIXED } from "../../src/env.ts";
import { admitGuest } from "../../src/signaling/admit.ts";
import { handleControlRequest, handleControlState } from "../../src/signaling/control.ts";
import type { Rooms } from "../../src/signaling/rooms.ts";
import { sessionRef } from "../../src/sessions/codes.ts";
import { createSupportSessionRow, createTenant, createUser, makeApp, ORIGIN, testDb } from "../helpers/app.ts";
import { startLive, techSession, type Live } from "../helpers/signal-flow.ts";
import { connect, makeRooms, roomFixture } from "../helpers/ws.ts";

const REF_KEY = "r".repeat(40);
const EXE = Buffer.from("MZ test ikilisi — NoktaDestek");
const ZIP = Buffer.from("PK test zip — NoktaDestek-macOS");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let dir: string;
let exePath: string;
let zipPath: string;
let app: FastifyInstance;
const bothEnv = () => ({
  SESSION_REF_KEY: REF_KEY,
  AGENT_BINARY_PATH: exePath,
  AGENT_SHA256: sha(EXE),
  MAC_AGENT_PATH: zipPath,
  MAC_AGENT_SHA256: sha(ZIP),
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rs-p28f-k6-"));
  exePath = join(dir, "NoktaDestek.exe");
  zipPath = join(dir, "NoktaDestek-macOS.zip");
  await writeFile(exePath, EXE);
  await writeFile(zipPath, ZIP);
  app = makeApp({ env: bothEnv() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const errCode = (r: LightMyRequestResponse) => r.json<{ error: { code: string } }>().error.code;

async function session() {
  const t = await createTenant();
  const tech = await createUser({ tenantId: t.id, role: "ADMIN" });
  const row = await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id, status: "PENDING" });
  return { ...row, ref: sessionRef(REF_KEY, row.id) };
}

async function withApp<T>(env: Record<string, string>, fn: (a: FastifyInstance) => Promise<T>): Promise<T> {
  const a = makeApp({ env });
  await a.ready();
  try {
    return await fn(a);
  } finally {
    await a.close();
  }
}

// --- resolve + join -------------------------------------------------------------------------------------------------

type ResolveBody = { clientKind: "AGENT" | "BROWSER"; clientOs?: string; clientVersion?: string };
const resolve = (code: string, body: ResolveBody, ip: string) =>
  app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers: body.clientKind === "BROWSER" ? { origin: ORIGIN } : {},
    payload: { code, ...body },
    remoteAddress: ip,
  });

/** resolve → join; `guest.pending` audit satırının newValue'su. */
async function joinedOs(body: ResolveBody, ip: string): Promise<Record<string, unknown>> {
  const s = await session();
  const r = await resolve(s.code ?? "", body, ip);
  expect(r.statusCode).toBe(200);
  const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
  const j = await app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/join",
    headers: body.clientKind === "BROWSER" ? { origin: ORIGIN } : {},
    payload: { joinNonce, customerName: "Deniz Müşteri", consentAccepted: true, consentTextId: consentText.id },
    remoteAddress: ip,
  });
  expect(j.statusCode).toBe(200);
  const row = await testDb().auditLog.findFirstOrThrow({ where: { entityId: s.id, action: "guest.pending" } });
  return row.newValue as Record<string, unknown>;
}

describe("P28f resolve clientOs → join audit os (§4.1)", () => {
  it("AC-396: AGENT clientOs=macos → nonce'a yazılır, join audit guest.pending os=macos (yeniden beyan alınmaz)", async () => {
    expect(await joinedOs({ clientKind: "AGENT", clientOs: "macos" }, "192.0.2.10")).toMatchObject({ guestKind: "AGENT", os: "macos" });
    expect(await joinedOs({ clientKind: "AGENT", clientOs: "linux" }, "192.0.2.11")).toMatchObject({ os: "linux" });
  });

  it("AC-396: eski istemci (AGENT, clientOs yok) → os=windows; BROWSER'da clientOs yok sayılır → os=browser", async () => {
    expect(await joinedOs({ clientKind: "AGENT" }, "192.0.2.12")).toMatchObject({ os: "windows" });
    expect(await joinedOs({ clientKind: "BROWSER", clientOs: "macos" }, "192.0.2.13")).toMatchObject({ os: "browser" });
  });

  it("S-P28f-15: geçersiz clientOs → 400 VALIDATION; kod yolu kovası tüketilmez (12 deneme sonra geçerli kod 200)", async () => {
    const ip = "192.0.2.14";
    for (let i = 0; i < 12; i++) {
      const r = await resolve("00000000", { clientKind: "AGENT", clientOs: i % 2 ? "darwin" : "MACOS" }, ip);
      expect(r.statusCode).toBe(400);
      expect(errCode(r)).toBe("VALIDATION");
    }
    const s = await session();
    expect((await resolve(s.code ?? "", { clientKind: "AGENT", clientOs: "macos" }, ip)).statusCode).toBe(200);
  });

  it("AC-396: yanıt şeması değişmez — clientOs'lu ve clientOs'suz resolve aynı anahtarları döner", async () => {
    const a = await session();
    const b = await session();
    const withOs = await resolve(a.code ?? "", { clientKind: "AGENT", clientOs: "macos" }, "192.0.2.15");
    const without = await resolve(b.code ?? "", { clientKind: "AGENT" }, "192.0.2.15");
    expect(Object.keys(withOs.json<object>()).sort()).toEqual(Object.keys(without.json<object>()).sort());
    expect(withOs.body).not.toContain("macos");
  });
});

// --- indirme + availability -----------------------------------------------------------------------------------------

const download = (ref: string, ip: string, os?: string, a: FastifyInstance = app) =>
  a.inject({
    method: "GET",
    url: `/api/v1/public/agent/download?ref=${encodeURIComponent(ref)}${os === undefined ? "" : `&os=${encodeURIComponent(os)}`}`,
    remoteAddress: ip,
  });

describe("P28f GET /public/agent/download?os= (§4.1, S-P28f-15)", () => {
  it("AC-396, AC-27: os=macos → 302 /downloads/Destek-<kod>.zip; os yok / windows → .exe; no-store; metrik os etiketli", async () => {
    const s = await session();
    const mac = await download(s.ref, "198.51.100.10", "macos");
    expect(mac.statusCode).toBe(302);
    expect(mac.headers.location).toBe(`/downloads/Destek-${s.code}.zip`);
    expect(mac.headers["cache-control"]).toBe("no-store");
    expect((await download(s.ref, "198.51.100.10")).headers.location).toBe(`/downloads/Destek-${s.code}.exe`);
    expect((await download(s.ref, "198.51.100.10", "windows")).headers.location).toBe(`/downloads/Destek-${s.code}.exe`);
    const metrics = app.metrics.render();
    expect(metrics).toMatch(/rs_agent_download_total\{os="macos"\} [1-9]/);
    expect(metrics).toMatch(/rs_agent_download_total\{os="windows"\} [2-9]/);
  });

  it("S-P28f-15: geçersiz os → 400 VALIDATION; ref kovası tüketilmez (12 deneme sonra aynı IP'den geçerli ref 302)", async () => {
    const ip = "198.51.100.11";
    const s = await session();
    for (const os of ["linux", "MACOS", "darwin", "", "windows,macos", "x".repeat(300), "macos ", "../exe", "0", "win", "mac", "ios"]) {
      const r = await download(s.ref, ip, os);
      expect(r.statusCode).toBe(400);
      expect(errCode(r)).toBe("VALIDATION");
      expect(r.headers.location).toBeUndefined();
    }
    expect((await download(s.ref, ip, "macos")).statusCode).toBe(302);
  });

  it("S-P28f-15: geçersiz os da ipKey 20/dk kovasına sayılır (21. istek 429)", async () => {
    const ip = "198.51.100.12";
    const s = await session();
    for (let i = 0; i < 20; i++) expect((await download(s.ref, ip, "bsd")).statusCode).toBe(400);
    expect((await download(s.ref, ip, "macos")).statusCode).toBe(429);
  });

  it("AC-390, S-P28f-15: yalnız ilgili kapı uygulanır — mac yapılandırılmamış/uyuşmaz → os=macos 503 NOT_READY, windows 302", async () => {
    const s = await session();
    for (const env of [
      { ...bothEnv(), MAC_AGENT_SHA256: "" },
      { ...bothEnv(), MAC_AGENT_SHA256: "0".repeat(64) },
      { ...bothEnv(), MAC_AGENT_PATH: join(dir, "yok.zip") },
    ]) {
      await withApp(env, async (a) => {
        const mac = await download(s.ref, "198.51.100.13", "macos", a);
        expect(mac.statusCode).toBe(503);
        expect(errCode(mac)).toBe("NOT_READY");
        expect(mac.headers.location).toBeUndefined();
        expect((await download(s.ref, "198.51.100.13", "windows", a)).statusCode).toBe(302);
      });
    }
    // Ters yön: Windows kapısı kapalı, mac açık.
    await withApp({ ...bothEnv(), AGENT_SHA256: "0".repeat(64) }, async (a) => {
      expect((await download(s.ref, "198.51.100.14", undefined, a)).statusCode).toBe(503);
      expect((await download(s.ref, "198.51.100.14", "macos", a)).statusCode).toBe(302);
    });
  });
});

const availability = (ip: string, a: FastifyInstance = app) =>
  a.inject({ method: "GET", url: "/api/v1/public/agent/availability", remoteAddress: ip });

describe("P28f GET /public/agent/availability (§4.1, AC-390)", () => {
  it("AC-390: iki kapı ok → {windows:true, macos:true}; Cache-Control public, max-age=60; çerez yok, Origin gerekmez", async () => {
    const r = await availability("203.0.113.50");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ windows: true, macos: true, macosTestBuild: true }); // test env: DEPLOY_ENV yok → production değil
    expect(r.headers["cache-control"]).toBe("public, max-age=60");
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("AC-390: mac yapılandırılmamış / uyuşmaz / dosya yok → macos:false (indirme düğmesi görünmez); windows bağımsız", async () => {
    for (const env of [
      { SESSION_REF_KEY: REF_KEY, AGENT_BINARY_PATH: exePath, AGENT_SHA256: sha(EXE) },
      { ...bothEnv(), MAC_AGENT_SHA256: sha(EXE) },
      { ...bothEnv(), MAC_AGENT_PATH: join(dir, "yok.zip") },
    ]) {
      await withApp(env, async (a) =>
        expect((await availability("203.0.113.51", a)).json()).toEqual({ windows: true, macos: false, macosTestBuild: false }),
      );
    }
    await withApp({ SESSION_REF_KEY: REF_KEY }, async (a) =>
      expect((await availability("203.0.113.52", a)).json()).toEqual({ windows: false, macos: false, macosTestBuild: false }),
    );
  });

  it("S-P28f-8: macosTestBuild yalnız DEPLOY_ENV ≠ production ve macOS indirmesi varken true; production'da her zaman false", async () => {
    await withApp({ ...bothEnv(), DEPLOY_ENV: "staging" }, async (a) =>
      expect((await availability("203.0.113.56", a)).json()).toEqual({ windows: true, macos: true, macosTestBuild: true }),
    );
    await withApp({ ...bothEnv(), DEPLOY_ENV: "production" }, async (a) =>
      expect((await availability("203.0.113.57", a)).json()).toEqual({ windows: true, macos: true, macosTestBuild: false }),
    );
    await withApp({ ...bothEnv(), DEPLOY_ENV: "staging", MAC_AGENT_SHA256: "0".repeat(64) }, async (a) =>
      expect((await availability("203.0.113.58", a)).json()).toEqual({ windows: true, macos: false, macosTestBuild: false }),
    );
  });

  it("AC-390: dosya yayından sonra değişirse (tahrif) yeniden başlatmadan macos:false", async () => {
    const path = join(dir, "degisen.zip");
    await writeFile(path, ZIP);
    await withApp({ ...bothEnv(), MAC_AGENT_PATH: path }, async (a) => {
      expect((await availability("203.0.113.53", a)).json<{ macos: boolean }>().macos).toBe(true);
      await writeFile(path, Buffer.concat([ZIP, Buffer.from("tahrif")]));
      expect((await availability("203.0.113.53", a)).json<{ macos: boolean }>().macos).toBe(false);
    });
  });

  it("AC-390: ipKey 30/dk — 31. istek 429 (+Retry-After), önbelleğe alınabilir başlık yok; başka IP etkilenmez", async () => {
    const ip = "203.0.113.54";
    for (let i = 0; i < 30; i++) expect((await availability(ip)).statusCode).toBe(200);
    const r = await availability(ip);
    expect(r.statusCode).toBe(429);
    expect(errCode(r)).toBe("RATE_LIMITED");
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await availability("203.0.113.55")).statusCode).toBe(200);
  });
});

// --- agent-ready ----------------------------------------------------------------------------------------------------

describe("P28f /internal/agent-ready/{windows,macos} (S-P28f-3)", () => {
  const PROXY = "172.30.0.2";
  const ready = (a: FastifyInstance, path: string, o: { ip?: string; fwd?: boolean } = {}) =>
    a.inject({
      method: "GET",
      url: `/internal/agent-ready${path}`,
      remoteAddress: o.ip ?? PROXY,
      headers: o.fwd === false ? {} : { "x-forwarded-method": "GET", "x-forwarded-uri": "/downloads/***" },
    });
  const proxyEnv = (env: Record<string, string>) => ({ ...env, TRUSTED_PROXY_CIDR: "172.30.0.2/31" });

  it("AC-390, S-P28f-3: iki kapı ok → /windows, /macos ve çıplak /agent-ready (windows takma adı) 204 no-store", async () => {
    await withApp(proxyEnv(bothEnv()), async (a) => {
      for (const p of ["/windows", "/macos", ""]) {
        const r = await ready(a, p);
        expect(r.statusCode).toBe(204);
        expect(r.headers["cache-control"]).toBe("no-store");
      }
    });
  });

  it("S-P28f-3: her uç yalnız kendi kapısını uygular (çapraz) — mac kapalı: /macos 503, /windows 204; windows kapalı: tersi", async () => {
    await withApp(proxyEnv({ ...bothEnv(), MAC_AGENT_SHA256: "0".repeat(64) }), async (a) => {
      const mac = await ready(a, "/macos");
      expect(mac.statusCode).toBe(503);
      expect(errCode(mac)).toBe("NOT_READY");
      expect(mac.body).not.toContain(dir);
      expect((await ready(a, "/windows")).statusCode).toBe(204);
      expect((await ready(a, "")).statusCode).toBe(204);
    });
    await withApp(proxyEnv({ ...bothEnv(), AGENT_SHA256: "0".repeat(64) }), async (a) => {
      expect((await ready(a, "/windows")).statusCode).toBe(503);
      expect((await ready(a, "")).statusCode).toBe(503);
      expect((await ready(a, "/macos")).statusCode).toBe(204);
    });
  });

  it("S-P28f-3: bilinmeyen platform yolu 404 (varsayılan ret); dışarıdan (proxy dışı / forward_auth başlıksız) /macos 404", async () => {
    await withApp(proxyEnv(bothEnv()), async (a) => {
      for (const p of ["/linux", "/MACOS", "/macos/x", "/windows.exe", "/"]) expect((await ready(a, p)).statusCode).toBe(404);
      for (const o of [{ ip: "203.0.113.9" }, { fwd: false }, { ip: "127.0.0.1" }]) {
        const r = await ready(a, "/macos", o);
        expect(r.statusCode).toBe(404);
        expect(errCode(r)).toBe("NOT_FOUND");
      }
    });
  });
});

// --- env ------------------------------------------------------------------------------------------------------------

describe("P28f MAC_AGENT_* env (§8.1)", () => {
  const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote" };
  const prod = {
    ...base,
    NODE_ENV: "production",
    DEPLOY_ENV: "production",
    TRUSTED_PROXY_CIDR: "172.30.0.2/31",
    SESSION_REF_KEY: "k".repeat(40),
    APP_ENCRYPTION_KEYS: `v1:${Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64")}`,
  };

  it("AC-390: MAC_AGENT_SHA256 64 hex (küçük harf), MAC_AGENT_PATH mutlak; boş = tanımsız", () => {
    const env = loadEnv({ ...base, MAC_AGENT_PATH: MAC_AGENT_PATH_FIXED, MAC_AGENT_SHA256: "CD".repeat(32) });
    expect(env.MAC_AGENT_SHA256).toBe("cd".repeat(32));
    expect(() => loadEnv({ ...base, MAC_AGENT_SHA256: "abc" })).toThrow(/MAC_AGENT_SHA256/);
    expect(() => loadEnv({ ...base, MAC_AGENT_PATH: "downloads/x.zip" })).toThrow(/MAC_AGENT_PATH/);
    const blank = loadEnv({ ...base, MAC_AGENT_PATH: "", MAC_AGENT_SHA256: " " });
    expect(blank.MAC_AGENT_PATH).toBeUndefined();
    expect(blank.MAC_AGENT_SHA256).toBeUndefined();
  });

  it("S-P28f-3: production'da MAC_AGENT_PATH ve AGENT_BINARY_PATH yalnız Caddy'nin sunduğu sabit yol; geliştirmede serbest", () => {
    const ok = loadEnv({ ...prod, MAC_AGENT_PATH: MAC_AGENT_PATH_FIXED, AGENT_BINARY_PATH: AGENT_BINARY_PATH_FIXED });
    expect(ok.MAC_AGENT_PATH).toBe("/data/downloads/NoktaDestek-macOS.zip");
    expect(() => loadEnv({ ...prod, MAC_AGENT_PATH: "/srv/downloads/NoktaDestek-macOS.zip" })).toThrow(/MAC_AGENT_PATH/);
    expect(() => loadEnv({ ...prod, MAC_AGENT_PATH: "/data/downloads/NoktaDestek.exe" })).toThrow(/MAC_AGENT_PATH/);
    expect(() => loadEnv({ ...prod, AGENT_BINARY_PATH: "/tmp/NoktaDestek.exe" })).toThrow(/AGENT_BINARY_PATH/);
    expect(loadEnv(prod).MAC_AGENT_PATH).toBeUndefined(); // boş = indirme kapalı (geri alma yolu)
    expect(loadEnv({ ...base, MAC_AGENT_PATH: "/tmp/x.zip" }).MAC_AGENT_PATH).toBe("/tmp/x.zip");
  });
});

// --- control.state OS_PERMISSION ------------------------------------------------------------------------------------

const ALL = ["sessions.create", "remote_control.use", "file_transfer.use"] as const;
const consents = (sessionId: string) => testDb().sessionConsent.findMany({ where: { sessionId, level: "CONTROL" } });
const audits = (sessionId: string, action: string) => testDb().auditLog.findMany({ where: { entityId: sessionId, action } });

async function agentRoom(rooms: Rooms, clientOs: "macos" | "windows" | undefined, kind: "AGENT" | "BROWSER" = "AGENT") {
  const fx = await roomFixture(rooms, [...ALL]);
  const g = fx.guest("203.0.113.7", kind);
  if (clientOs) g.entry.clientOs = clientOs;
  expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
  return { ...fx, g };
}

describe("P28f control.state OS_PERMISSION (§4.2, S-P28f-15)", () => {
  it("AC-391: şema — OS_PERMISSION yalnız VIEW ile geçerli; GRANTED ile 1008 (şema hatası)", () => {
    expect(controlStateSchema.safeParse({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" }).success).toBe(true);
    expect(controlStateSchema.safeParse({ t: "control.state", state: "GRANTED", source: "OS_PERMISSION" }).success).toBe(false);
  });

  it("AC-391: macOS AGENT, REQUESTED → iptal: VIEW, teknisyene {VIEW, OS_PERMISSION}; consent yok, bekleme yok, sayaç iade yok; audit control.cancelled{by:agent, source:os_permission}", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, "macos");
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "OS_PERMISSION" });
    expect(fx.room.control.state).toBe("VIEW");
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" });
    expect(fx.room.control.deniedAt).toBeUndefined();
    expect(fx.room.control.requests).toBe(1);
    await expect
      .poll(() => audits(fx.session.id, CONTROL_AUDIT.CANCELLED))
      .toMatchObject([{ username: "customer", result: "success", newValue: { by: "agent", source: "os_permission" } }]);
    expect(await consents(fx.session.id)).toHaveLength(0);
    expect(await audits(fx.session.id, CONTROL_AUDIT.DENIED)).toHaveLength(0);
    // Bekleme yok: izin verildikten sonra teknisyen hemen yeniden isteyebilir.
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    expect(rooms.metrics.render()).toContain('rs_control_total{event="cancelled_os_permission"} 1');
  });

  it("S-P28f-15: Windows beyanlı / clientOs'suz (eski) AGENT ve BROWSER misafirden OS_PERMISSION yok sayılır (istek bekler)", async () => {
    for (const [os, kind] of [
      ["windows", "AGENT"],
      [undefined, "AGENT"],
      ["macos", "BROWSER"],
    ] as const) {
      const rooms = makeRooms();
      const fx = await agentRoom(rooms, os, kind);
      if (kind === "AGENT") expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
      const before = fx.room.control.state;
      await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "OS_PERMISSION" });
      expect(fx.room.control.state).toBe(before);
      expect(fx.techPeer.of("control.state")).toHaveLength(0);
      expect(await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).toHaveLength(0);
    }
  });

  it("S-P28f-15: REQUESTED dışındaki fazda yok sayılır — VIEW'da ve GRANTED'de kayıt/iletim yok, kontrol açık kalır", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, "macos");
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "OS_PERMISSION" });
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.room.control.state).toBe("GRANTED");
    const n = fx.techPeer.of("control.state").length;
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "OS_PERMISSION" });
    expect(fx.room.control.state).toBe("GRANTED");
    expect(fx.techPeer.of("control.state")).toHaveLength(n);
    expect((await consents(fx.session.id)).map((c) => c.decision)).toEqual(["GRANTED"]);
    expect(await audits(fx.session.id, CONTROL_AUDIT.REVOKED)).toHaveLength(0);
    expect(await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).toHaveLength(0);
  });
});

describe("P28f OS_PERMISSION uçtan uca (WS)", () => {
  let live: Live | undefined;
  afterEach(async () => {
    await live?.close();
    live = undefined;
  });

  async function agentJoin(l: Live, token: string, clientOs: string | undefined, ip: string) {
    const headers = { "x-forwarded-for": ip };
    const r = await l.app.inject({
      method: "POST",
      url: "/api/v1/public/sessions/resolve",
      headers,
      payload: { token, clientKind: "AGENT", ...(clientOs ? { clientOs } : {}) },
    });
    const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
    const j = await l.app.inject({
      method: "POST",
      url: "/api/v1/public/sessions/join",
      headers,
      payload: { joinNonce, customerName: "Mac Müşteri", consentAccepted: true, consentTextId: consentText.id },
    });
    const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
    const g = await connect(`${l.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`]);
    await g.waitFor("lobby.wait");
    return { g, admitCode };
  }

  it("AC-391: macOS istemci (resolve clientOs=macos) OS_PERMISSION gönderir → teknisyene {VIEW, OS_PERMISSION}; audit os_permission", async () => {
    live = await startLive();
    const t = await techSession(live);
    const { g, admitCode } = await agentJoin(live, t.token, "macos", "203.0.113.31");
    await t.ws.waitFor("peer.pending");
    t.ws.send({ t: "guest.admit", admitCode });
    await g.waitFor("hello");
    await t.ws.waitFor("peer.joined");
    t.ws.send({ t: "control.request" });
    await g.waitFor("control.request");
    g.send({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" });
    expect(await t.ws.waitFor("control.state")).toEqual({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" });
    await expect
      .poll(() => audits(t.sessionId, CONTROL_AUDIT.CANCELLED))
      .toMatchObject([{ newValue: { by: "agent", source: "os_permission" } }]);
    t.ws.send({ t: "control.request" });
    expect(await g.waitFor("control.request")).toEqual({ t: "control.request" });
    g.ws.close();
  });
});
