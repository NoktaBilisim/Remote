// P28g K6 sunucu tarafı (mimari-p28g §4.1–4.2, §8.1, §13 S-P28g-12; AC-399, AC-403, AC-396, AC-27): indirme `os=linux`
// (uzantısız ad), availability `linux`, `/internal/agent-ready/linux` + çapraz kapı, LINUX_AGENT_* env, join audit `os=linux`,
// control.state WAYLAND_NO_CONTROL (yalnız Linux beyanlı AGENT, yalnız REQUESTED).
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import type { ClientOs } from "@remote/contracts/api/sessions";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LINUX_AGENT_PATH_FIXED, loadEnv } from "../../src/env.ts";
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
const ELF = Buffer.from("\x7fELF test ikilisi — NoktaDestek-linux");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const BAD_SHA = "0".repeat(64);

let dir: string;
let app: FastifyInstance;
const allEnv = () => ({
  SESSION_REF_KEY: REF_KEY,
  AGENT_BINARY_PATH: join(dir, "NoktaDestek.exe"),
  AGENT_SHA256: sha(EXE),
  MAC_AGENT_PATH: join(dir, "NoktaDestek-macOS.zip"),
  MAC_AGENT_SHA256: sha(ZIP),
  LINUX_AGENT_PATH: join(dir, "NoktaDestek-linux"),
  LINUX_AGENT_SHA256: sha(ELF),
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rs-p28g-k6-"));
  await writeFile(join(dir, "NoktaDestek.exe"), EXE);
  await writeFile(join(dir, "NoktaDestek-macOS.zip"), ZIP);
  await writeFile(join(dir, "NoktaDestek-linux"), ELF);
  app = makeApp({ env: allEnv() });
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

describe("P28g resolve clientOs=linux → join audit os (§3, §4.1)", () => {
  it("AC-403, AC-396: AGENT clientOs=linux → guest.pending os=linux; BROWSER'da linux beyanı yok sayılır → browser", async () => {
    for (const [clientKind, ip, want] of [
      ["AGENT", "192.0.2.40", "linux"],
      ["BROWSER", "192.0.2.41", "browser"],
    ] as const) {
      const s = await session();
      const headers = clientKind === "BROWSER" ? { origin: ORIGIN } : {};
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/public/sessions/resolve",
        headers,
        payload: { code: s.code, clientKind, clientOs: "linux" },
        remoteAddress: ip,
      });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain("linux"); // yanıt şeması değişmez, beyan geri yansıtılmaz
      const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
      const j = await app.inject({
        method: "POST",
        url: "/api/v1/public/sessions/join",
        headers,
        payload: { joinNonce, customerName: "Linux Müşteri", consentAccepted: true, consentTextId: consentText.id },
        remoteAddress: ip,
      });
      expect(j.statusCode).toBe(200);
      const row = await testDb().auditLog.findFirstOrThrow({ where: { entityId: s.id, action: "guest.pending" } });
      expect(row.newValue).toMatchObject({ guestKind: clientKind, os: want });
    }
  });
});

// --- indirme --------------------------------------------------------------------------------------------------------

const download = (ref: string, ip: string, os?: string, a: FastifyInstance = app) =>
  a.inject({
    method: "GET",
    url: `/api/v1/public/agent/download?ref=${encodeURIComponent(ref)}${os === undefined ? "" : `&os=${encodeURIComponent(os)}`}`,
    remoteAddress: ip,
  });

describe("P28g GET /public/agent/download?os=linux (§4.1, S-P28g-12)", () => {
  it("AC-403, AC-27: os=linux → 302 /downloads/Destek-<kod> (uzantısız); no-store; metrik os=linux; windows/macos değişmez", async () => {
    const s = await session();
    const r = await download(s.ref, "198.51.100.40", "linux");
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`/downloads/Destek-${s.code}`);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await download(s.ref, "198.51.100.40")).headers.location).toBe(`/downloads/Destek-${s.code}.exe`);
    expect((await download(s.ref, "198.51.100.40", "macos")).headers.location).toBe(`/downloads/Destek-${s.code}.zip`);
    expect(app.metrics.render()).toMatch(/rs_agent_download_total\{os="linux"\} [1-9]/);
  });

  it("S-P28g-12: geçersiz linux benzeri os → 400 VALIDATION; ref kovası tüketilmez (sonra geçerli ref 302)", async () => {
    const ip = "198.51.100.41";
    const s = await session();
    for (const os of [
      "LINUX",
      "Linux",
      "linux ",
      "linux64",
      "x86_64",
      "ubuntu",
      "gnu/linux",
      "linux,windows",
      "elf",
      "android",
      "cros",
      "deb",
    ]) {
      const r = await download(s.ref, ip, os);
      expect(r.statusCode).toBe(400);
      expect(errCode(r)).toBe("VALIDATION");
      expect(r.headers.location).toBeUndefined();
    }
    expect((await download(s.ref, ip, "linux")).statusCode).toBe(302);
  });

  it("AC-403: geçersiz/biten ref os=linux'ta da 404/410 (kod sızmaz)", async () => {
    const r = await download("A".repeat(43) + "0".repeat(26), "198.51.100.42", "linux");
    expect(r.statusCode).toBe(404);
    expect(r.headers.location).toBeUndefined();
    const t = await createTenant();
    const tech = await createUser({ tenantId: t.id, role: "ADMIN" });
    const row = await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id, status: "CANCELLED" });
    const gone = await download(sessionRef(REF_KEY, row.id), "198.51.100.42", "linux");
    expect(gone.statusCode).toBe(410);
    expect(gone.body).not.toContain(row.code ?? "yok");
  });

  it("AC-403, S-P28g-12: yalnız linux kapısı uygulanır — yapılandırılmamış/uyuşmaz/dosya yok → linux 503 NOT_READY, windows/macos 302", async () => {
    const s = await session();
    for (const env of [
      { ...allEnv(), LINUX_AGENT_SHA256: "" },
      { ...allEnv(), LINUX_AGENT_SHA256: BAD_SHA },
      { ...allEnv(), LINUX_AGENT_PATH: join(dir, "yok") },
    ]) {
      await withApp(env, async (a) => {
        const r = await download(s.ref, "198.51.100.43", "linux", a);
        expect(r.statusCode).toBe(503);
        expect(errCode(r)).toBe("NOT_READY");
        expect(r.headers.location).toBeUndefined();
        expect(r.body).not.toContain(dir);
        expect((await download(s.ref, "198.51.100.43", "windows", a)).statusCode).toBe(302);
        expect((await download(s.ref, "198.51.100.43", "macos", a)).statusCode).toBe(302);
      });
    }
    // Ters yön: Windows ve macOS kapalı, Linux açık.
    await withApp({ ...allEnv(), AGENT_SHA256: BAD_SHA, MAC_AGENT_SHA256: "" }, async (a) => {
      expect((await download(s.ref, "198.51.100.44", undefined, a)).statusCode).toBe(503);
      expect((await download(s.ref, "198.51.100.44", "macos", a)).statusCode).toBe(503);
      expect((await download(s.ref, "198.51.100.44", "linux", a)).statusCode).toBe(302);
    });
  });
});

// --- availability ---------------------------------------------------------------------------------------------------

const availability = (ip: string, a: FastifyInstance = app) =>
  a.inject({ method: "GET", url: "/api/v1/public/agent/availability", remoteAddress: ip });

describe("P28g GET /public/agent/availability linux (§4.1)", () => {
  it("AC-403: üç kapı ok → {windows, macos, macosTestBuild, linux:true}; linuxTestBuild yok; Cache-Control public, max-age=60", async () => {
    const r = await availability("203.0.113.70");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ windows: true, macos: true, macosTestBuild: true, linux: true });
    expect(r.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("AC-403: linux yapılandırılmamış / uyuşmaz / dosya yok → linux:false; windows ve macos bağımsız; production'da da TEST bayrağı yok", async () => {
    for (const env of [
      { ...allEnv(), LINUX_AGENT_SHA256: "" },
      { ...allEnv(), LINUX_AGENT_SHA256: sha(EXE) },
      { ...allEnv(), LINUX_AGENT_PATH: join(dir, "yok") },
    ]) {
      await withApp(env, async (a) =>
        expect((await availability("203.0.113.71", a)).json()).toEqual({ windows: true, macos: true, macosTestBuild: true, linux: false }),
      );
    }
    await withApp({ ...allEnv(), DEPLOY_ENV: "production", AGENT_SHA256: BAD_SHA, MAC_AGENT_SHA256: "" }, async (a) =>
      expect((await availability("203.0.113.72", a)).json()).toEqual({ windows: false, macos: false, macosTestBuild: false, linux: true }),
    );
  });

  it("AC-403: ELF yayından sonra değişirse (tahrif) yeniden başlatmadan linux:false", async () => {
    const path = join(dir, "degisen-linux");
    await writeFile(path, ELF);
    await withApp({ ...allEnv(), LINUX_AGENT_PATH: path }, async (a) => {
      expect((await availability("203.0.113.73", a)).json<{ linux: boolean }>().linux).toBe(true);
      await writeFile(path, Buffer.concat([ELF, Buffer.from("tahrif")]));
      expect((await availability("203.0.113.73", a)).json<{ linux: boolean }>().linux).toBe(false);
    });
  });
});

// --- agent-ready ----------------------------------------------------------------------------------------------------

describe("P28g /internal/agent-ready/linux (S-P28g-12, S-P28f-3 kalıbı)", () => {
  const PROXY = "172.30.0.2";
  const ready = (a: FastifyInstance, path: string, o: { ip?: string; fwd?: boolean } = {}) =>
    a.inject({
      method: "GET",
      url: `/internal/agent-ready${path}`,
      remoteAddress: o.ip ?? PROXY,
      headers: o.fwd === false ? {} : { "x-forwarded-method": "GET", "x-forwarded-uri": "/downloads/***" },
    });
  const proxyEnv = (env: Record<string, string>) => ({ ...env, TRUSTED_PROXY_CIDR: "172.30.0.2/31" });

  it("AC-403: kapı ok → /linux 204 no-store", async () => {
    await withApp(proxyEnv(allEnv()), async (a) => {
      const r = await ready(a, "/linux");
      expect(r.statusCode).toBe(204);
      expect(r.headers["cache-control"]).toBe("no-store");
    });
  });

  it("S-P28g-12: çapraz kapı — Windows ok + Linux uyuşmaz → /linux 503, /windows 204; macOS ok + Linux yok → /linux 503, /macos 204; tersi", async () => {
    await withApp(proxyEnv({ ...allEnv(), LINUX_AGENT_SHA256: BAD_SHA }), async (a) => {
      const r = await ready(a, "/linux");
      expect(r.statusCode).toBe(503);
      expect(errCode(r)).toBe("NOT_READY");
      expect(r.body).not.toContain(dir);
      expect((await ready(a, "/windows")).statusCode).toBe(204);
      expect((await ready(a, "")).statusCode).toBe(204);
      expect((await ready(a, "/macos")).statusCode).toBe(204);
    });
    await withApp(proxyEnv({ ...allEnv(), LINUX_AGENT_PATH: join(dir, "yok") }), async (a) => {
      expect((await ready(a, "/linux")).statusCode).toBe(503);
      expect((await ready(a, "/macos")).statusCode).toBe(204);
    });
    await withApp(proxyEnv({ ...allEnv(), AGENT_SHA256: BAD_SHA, MAC_AGENT_SHA256: BAD_SHA }), async (a) => {
      expect((await ready(a, "/windows")).statusCode).toBe(503);
      expect((await ready(a, "/macos")).statusCode).toBe(503);
      expect((await ready(a, "/linux")).statusCode).toBe(204);
    });
  });

  it("S-P28g-12: bilinmeyen alt yol 404; dışarıdan (proxy dışı / forward_auth başlıksız / loopback) /linux 404", async () => {
    await withApp(proxyEnv(allEnv()), async (a) => {
      for (const p of ["/LINUX", "/linux/x", "/linux.sh", "/ios"]) expect((await ready(a, p)).statusCode).toBe(404);
      for (const o of [{ ip: "203.0.113.9" }, { fwd: false }, { ip: "127.0.0.1" }]) {
        const r = await ready(a, "/linux", o);
        expect(r.statusCode).toBe(404);
        expect(errCode(r)).toBe("NOT_FOUND");
      }
    });
  });
});

// --- env ------------------------------------------------------------------------------------------------------------

describe("P28g LINUX_AGENT_* env (§8.1)", () => {
  const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote" };
  const prod = {
    ...base,
    NODE_ENV: "production",
    DEPLOY_ENV: "production",
    TRUSTED_PROXY_CIDR: "172.30.0.2/31",
    SESSION_REF_KEY: "k".repeat(40),
    APP_ENCRYPTION_KEYS: `v1:${Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64")}`,
  };

  it("AC-403: LINUX_AGENT_SHA256 64 hex (küçük harfe), LINUX_AGENT_PATH mutlak; boş = tanımsız", () => {
    const env = loadEnv({ ...base, LINUX_AGENT_PATH: LINUX_AGENT_PATH_FIXED, LINUX_AGENT_SHA256: "EF".repeat(32) });
    expect(env.LINUX_AGENT_SHA256).toBe("ef".repeat(32));
    expect(() => loadEnv({ ...base, LINUX_AGENT_SHA256: "abc" })).toThrow(/LINUX_AGENT_SHA256/);
    expect(() => loadEnv({ ...base, LINUX_AGENT_SHA256: "g".repeat(64) })).toThrow(/LINUX_AGENT_SHA256/);
    expect(() => loadEnv({ ...base, LINUX_AGENT_PATH: "downloads/NoktaDestek-linux" })).toThrow(/LINUX_AGENT_PATH/);
    const blank = loadEnv({ ...base, LINUX_AGENT_PATH: "", LINUX_AGENT_SHA256: " " });
    expect(blank.LINUX_AGENT_PATH).toBeUndefined();
    expect(blank.LINUX_AGENT_SHA256).toBeUndefined();
  });

  it("S-P28g-12: production'da LINUX_AGENT_PATH yalnız Caddy'nin sunduğu sabit yol; geliştirmede serbest", () => {
    expect(LINUX_AGENT_PATH_FIXED).toBe("/data/downloads/NoktaDestek-linux");
    expect(loadEnv({ ...prod, LINUX_AGENT_PATH: LINUX_AGENT_PATH_FIXED }).LINUX_AGENT_PATH).toBe(LINUX_AGENT_PATH_FIXED);
    for (const bad of [
      "/srv/downloads/NoktaDestek-linux",
      "/data/downloads/NoktaDestek-macOS.zip",
      "/data/downloads/NoktaDestek-linux.sh",
      "/tmp/x",
    ])
      expect(() => loadEnv({ ...prod, LINUX_AGENT_PATH: bad })).toThrow(/LINUX_AGENT_PATH/);
    expect(loadEnv(prod).LINUX_AGENT_PATH).toBeUndefined(); // boş = indirme kapalı (geri alma yolu)
    expect(loadEnv({ ...base, LINUX_AGENT_PATH: "/tmp/x" }).LINUX_AGENT_PATH).toBe("/tmp/x");
  });
});

// --- control.state WAYLAND_NO_CONTROL -------------------------------------------------------------------------------

const ALL = ["sessions.create", "remote_control.use", "file_transfer.use"] as const;
const consents = (sessionId: string) => testDb().sessionConsent.findMany({ where: { sessionId, level: "CONTROL" } });
const audits = (sessionId: string, action: string) => testDb().auditLog.findMany({ where: { entityId: sessionId, action } });
const WAYLAND = { state: "VIEW", source: "WAYLAND_NO_CONTROL" } as const;

async function agentRoom(rooms: Rooms, clientOs: ClientOs | undefined, kind: "AGENT" | "BROWSER" = "AGENT") {
  const fx = await roomFixture(rooms, [...ALL]);
  const g = fx.guest("203.0.113.7", kind);
  if (clientOs) g.entry.clientOs = clientOs;
  expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
  return { ...fx, g };
}

describe("P28g control.state WAYLAND_NO_CONTROL (§4.2, S-P28g-12)", () => {
  it("AC-399: Linux AGENT, REQUESTED → iptal: VIEW, teknisyene {VIEW, WAYLAND_NO_CONTROL}; consent yok, bekleme yok, sayaç iade yok; audit control.cancelled{by:agent, source:wayland_no_control}", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, "linux");
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    await handleControlState(rooms, fx.room, fx.g.entry, WAYLAND);
    expect(fx.room.control.state).toBe("VIEW");
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", ...WAYLAND });
    expect(fx.room.control.deniedAt).toBeUndefined();
    expect(fx.room.control.requests).toBe(1);
    await expect
      .poll(() => audits(fx.session.id, CONTROL_AUDIT.CANCELLED))
      .toMatchObject([{ username: "customer", result: "success", newValue: { by: "agent", source: "wayland_no_control" } }]);
    expect(await consents(fx.session.id)).toHaveLength(0);
    expect(await audits(fx.session.id, CONTROL_AUDIT.DENIED)).toHaveLength(0);
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded"); // 30 sn bekleme yok
    const m = rooms.metrics.render();
    expect(m).toContain('rs_control_total{event="cancelled_wayland_no_control"} 1');
    expect(m).not.toContain('rs_control_total{event="cancelled_os_permission"}');
  });

  it("S-P28g-12: macOS / Windows / clientOs'suz (eski) AGENT ve BROWSER misafirden WAYLAND_NO_CONTROL yok sayılır (istek bekler)", async () => {
    for (const [os, kind] of [
      ["macos", "AGENT"],
      ["windows", "AGENT"],
      [undefined, "AGENT"],
      ["linux", "BROWSER"],
    ] as const) {
      const rooms = makeRooms();
      const fx = await agentRoom(rooms, os, kind);
      if (kind === "AGENT") expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
      const before = fx.room.control.state;
      await handleControlState(rooms, fx.room, fx.g.entry, WAYLAND);
      expect(fx.room.control.state).toBe(before);
      expect(fx.techPeer.of("control.state")).toHaveLength(0);
      expect(await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).toHaveLength(0);
      if (kind === "AGENT") expect(rooms.metrics.render()).toContain('rs_control_total{event="wayland_no_control_ignored"} 1');
    }
  });

  it("S-P28g-12: OS_PERMISSION Linux AGENT'tan da yok sayılır (macOS'a bağlı kalır)", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, "linux");
    expect(await handleControlRequest(rooms, fx.room, fx.tech)).toBe("forwarded");
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "VIEW", source: "OS_PERMISSION" });
    expect(fx.room.control.state).toBe("REQUESTED");
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
    expect(await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).toHaveLength(0);
  });

  it("S-P28g-12: REQUESTED dışındaki fazda yok sayılır — VIEW'da ve GRANTED'de kayıt/iletim yok, kontrol açık kalır (REVOKED/consent yok)", async () => {
    const rooms = makeRooms();
    const fx = await agentRoom(rooms, "linux");
    await handleControlState(rooms, fx.room, fx.g.entry, WAYLAND);
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, fx.g.entry, { state: "GRANTED", source: "UI" });
    expect(fx.room.control.state).toBe("GRANTED");
    const n = fx.techPeer.of("control.state").length;
    await handleControlState(rooms, fx.room, fx.g.entry, WAYLAND);
    expect(fx.room.control.state).toBe("GRANTED");
    expect(fx.techPeer.of("control.state")).toHaveLength(n);
    expect((await consents(fx.session.id)).map((c) => c.decision)).toEqual(["GRANTED"]);
    expect(await audits(fx.session.id, CONTROL_AUDIT.REVOKED)).toHaveLength(0);
    expect(await audits(fx.session.id, CONTROL_AUDIT.CANCELLED)).toHaveLength(0);
    expect(rooms.metrics.render()).toContain('rs_control_total{event="wayland_no_control_ignored"} 2');
  });
});

describe("P28g WAYLAND_NO_CONTROL uçtan uca (WS)", () => {
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
      payload: { joinNonce, customerName: "Linux Müşteri", consentAccepted: true, consentTextId: consentText.id },
    });
    const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
    const g = await connect(`${l.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`]);
    await g.waitFor("lobby.wait");
    return { g, admitCode };
  }

  async function controlRequested(clientOs: string | undefined, ip: string) {
    live = await startLive();
    const t = await techSession(live);
    const { g, admitCode } = await agentJoin(live, t.token, clientOs, ip);
    await t.ws.waitFor("peer.pending");
    t.ws.send({ t: "guest.admit", admitCode });
    await g.waitFor("hello");
    await t.ws.waitFor("peer.joined");
    t.ws.send({ t: "control.request" });
    await g.waitFor("control.request");
    return { t, g };
  }

  it("AC-399: Linux istemci (resolve clientOs=linux) WAYLAND_NO_CONTROL gönderir → teknisyene {VIEW, WAYLAND_NO_CONTROL}; audit wayland_no_control; yeniden istek hemen iletilir", async () => {
    const { t, g } = await controlRequested("linux", "203.0.113.41");
    g.send({ t: "control.state", ...WAYLAND });
    expect(await t.ws.waitFor("control.state")).toEqual({ t: "control.state", ...WAYLAND });
    await expect
      .poll(() => audits(t.sessionId, CONTROL_AUDIT.CANCELLED))
      .toMatchObject([{ newValue: { by: "agent", source: "wayland_no_control" } }]);
    t.ws.send({ t: "control.request" });
    expect(await g.waitFor("control.request")).toEqual({ t: "control.request" });
    g.ws.close();
  });

  it("S-P28g-12: macOS istemciden (clientOs=macos) WAYLAND_NO_CONTROL yok sayılır — soket açık kalır, audit yok, istek bekler", async () => {
    const { t, g } = await controlRequested("macos", "203.0.113.42");
    g.send({ t: "control.state", ...WAYLAND });
    // Yok sayılan mesajdan sonra gelen geçerli ret işlenir → aradaki mesaj iletilmedi ve soket kapanmadı.
    g.send({ t: "control.state", state: "VIEW", source: "DENIED" });
    expect(await t.ws.waitFor("control.state")).toEqual({ t: "control.state", state: "VIEW", source: "DENIED" });
    await expect.poll(() => audits(t.sessionId, CONTROL_AUDIT.DENIED)).toHaveLength(1);
    expect(await audits(t.sessionId, CONTROL_AUDIT.CANCELLED)).toHaveLength(0);
    g.ws.close();
  });
});
