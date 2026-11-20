// P31-B1 sunucu entegrasyon (mimari-p31 K-P31-2/3/4, §4, §15.1, §15.2, S-P31-1/7; gereksinimler §14 AC-509, AC-510,
// AC-511, AC-521): firma indirmesinde `os`/UA, ayrı iç uç `/internal/agent-ready/macos-firm` (fail-closed), talepten
// misafire `clientOs`. Gerçek MySQL + dinleyen sunucu.
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateRequestResponse, WebFormInfo } from "@remote/contracts/api/requests";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SecretBox } from "../../src/lib/crypto.ts";
import { newSecretToken } from "../../src/lib/ids.ts";
import { FormTokens } from "../../src/requests/form-token.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb } from "../helpers/app.ts";
import { createCustomerRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders, type WsClient } from "../helpers/ws.ts";
import { UA } from "../helpers/user-agents.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
const EXE = Buffer.from("MZ test ikilisi — P31");
const ZIP = Buffer.from("PK test zip — P31 NoktaDestek-macOS");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;
const strip = (b: string) => b.replace(/"requestId":"[0-9A-Z]{26}"/, "");

let dir: string;
let exePath: string;
let zipPath: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rs-p31-b1-"));
  exePath = join(dir, "NoktaDestek.exe");
  zipPath = join(dir, "NoktaDestek-macOS.zip");
  await writeFile(exePath, EXE);
  await writeFile(zipPath, ZIP);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
const bothEnv = (o: Record<string, string> = {}) => ({
  ...PROXY,
  SESSION_REF_KEY: "r".repeat(40),
  AGENT_BINARY_PATH: exePath,
  AGENT_SHA256: sha(EXE),
  MAC_AGENT_PATH: zipPath,
  MAC_AGENT_SHA256: sha(ZIP),
  ...o,
});
const MAC_CLOSED = { MAC_AGENT_SHA256: "0".repeat(64) };

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});
async function boot(env: Record<string, string> = bothEnv()) {
  live = await startLive({ env });
  return live;
}

/** Form token'ı 3 sn geriye tarihli (2 sn bot kapısını beklemeden geçmek için; p19-web-j2 kalıbı). */
function backdatedTokens(): FormTokens {
  let skew = 0;
  const ft = new FormTokens(new SecretBox(null), () => Date.now() + skew);
  const issue = ft.issue.bind(ft);
  ft.issue = (ref: string, tenantId: string) => {
    skew = -3000;
    try {
      return issue(ref, tenantId);
    } finally {
      skew = 0;
    }
  };
  return ft;
}

let ipSeq = 0;
const nextIp = () => `10.31.${Math.floor(++ipSeq / 250) + 1}.${(ipSeq % 250) + 1}`;

const dl = (l: Live, ref: string, o: { ip?: string; ua?: string; os?: string; query?: string } = {}) =>
  l.app.inject({
    method: "GET",
    url: `/api/v1/public/agent/request-download?ref=${ref}${o.os === undefined ? "" : `&os=${encodeURIComponent(o.os)}`}${o.query ?? ""}`,
    headers: { "x-forwarded-for": o.ip ?? nextIp(), ...(o.ua === undefined ? {} : { "user-agent": o.ua }) },
  });

const ready = (l: Live, path: string, uri: string | undefined) =>
  l.app.inject({
    method: "GET",
    url: `/internal/agent-ready/${path}`,
    remoteAddress: "127.0.0.1",
    headers: { "x-forwarded-method": "GET", ...(uri === undefined ? {} : { "x-forwarded-uri": uri }) },
  });

// --- AC-509 / AC-521: request-download os + UA ----------------------------------------------------------------------

describe("P31 GET /public/agent/request-download?os= (AC-509, AC-521)", () => {
  it("AC-509: UA tablosu — Mac Safari/Chrome → .zip; iPad, iPhone, Windows, Linux, UA yok → .exe; no-store", async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id); // fileLabel TestFirma
    const zip = `/downloads/NoktaDestek-TestFirma-${ref}.zip`;
    const exe = `/downloads/NoktaDestek-TestFirma-${ref}.exe`;
    for (const [ua, loc] of [
      [UA.macSafari, zip],
      [UA.macChrome, zip],
      [UA.iPad, exe],
      [UA.iPhone, exe],
      [UA.windows, exe],
      [UA.linux, exe],
      [undefined, exe],
    ] as const) {
      const r = await dl(l, ref, { ua });
      expect(r.statusCode, String(ua)).toBe(302);
      expect(r.headers.location, String(ua)).toBe(loc);
      expect(r.headers["cache-control"]).toBe("no-store");
    }
  });

  it("AC-509: açık os UA'yı ezer — os=windows + Mac UA → .exe; os=macos + Windows UA → .zip; müşteri ref'i müşteri etiketiyle", async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    expect((await dl(l, ref, { ua: UA.macSafari, os: "windows" })).headers.location).toBe(`/downloads/NoktaDestek-TestFirma-${ref}.exe`);
    expect((await dl(l, ref, { ua: UA.windows, os: "macos" })).headers.location).toBe(`/downloads/NoktaDestek-TestFirma-${ref}.zip`);
    const c = await createCustomerRow(t.id, { name: "Müşteri Firma" });
    const row = await testDb().customer.findUniqueOrThrow({ where: { id: c.id }, select: { requestRef: true, fileLabel: true } });
    expect((await dl(l, row.requestRef, { os: "macos" })).headers.location).toBe(
      `/downloads/NoktaDestek-${row.fileLabel}-${row.requestRef}.zip`,
    );
  });

  it("AC-509: mac kapısı kapalı — örtük (Mac UA) → .exe (gerileme yok); açık os=macos → 503 NOT_READY; windows etkilenmez", async () => {
    const l = await boot(bothEnv(MAC_CLOSED));
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    expect((await dl(l, ref, { ua: UA.macSafari })).headers.location).toBe(`/downloads/NoktaDestek-TestFirma-${ref}.exe`);
    const r = await dl(l, ref, { os: "macos" });
    expect(r.statusCode).toBe(503);
    expect(errCode(r)).toBe("NOT_READY");
    expect(r.headers.location).toBeUndefined();
    expect((await dl(l, ref, { os: "windows" })).statusCode).toBe(302);
  });

  it("AC-509: geçersiz ref + mac kapısı kapalı → 404 REQUEST_REF_INVALID (ref denetimi kapıdan önce, 503 değil)", async () => {
    const l = await boot(bothEnv(MAC_CLOSED));
    const r = await dl(l, "abcdefghijklmnop", { os: "macos" });
    expect(r.statusCode).toBe(404);
    expect(errCode(r)).toBe("REQUEST_REF_INVALID");
  });

  it("AC-521: os=linux ve diğer geçersiz değerler → 400 VALIDATION; 40 geçersiz istekten sonra aynı IP'den geçerli istek 302 (kova tüketilmez)", async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const ip = nextIp();
    const bad = ["linux", "LINUX", "MACOS", "", "darwin", "mac", "ios", "windows,macos"];
    for (let i = 0; i < 40; i++) {
      const r = await dl(l, ref, { ip, os: bad[i % bad.length] });
      expect(r.statusCode).toBe(400);
      expect(errCode(r)).toBe("VALIDATION");
      expect(r.headers.location).toBeUndefined();
    }
    const dup = await dl(l, ref, { ip, query: "&os=macos&os=windows" }); // dizi → 400
    expect(dup.statusCode).toBe(400);
    expect((await dl(l, ref, { ip, os: "macos" })).statusCode).toBe(302);
  });

  it('AC-509: metrik rs_agent_download_total{os, kind="firm"}; ref ve UA loga/metriğe girmez', async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    await dl(l, ref, { os: "macos" });
    await dl(l, ref, { ua: UA.windows });
    const m = l.app.metrics.render();
    expect(m).toMatch(/rs_agent_download_total\{os="macos",kind="firm"\} [1-9]/);
    expect(m).toMatch(/rs_agent_download_total\{os="windows",kind="firm"\} [1-9]/);
    expect(m).not.toContain(ref);
  });
});

// --- AC-510: /internal/agent-ready/macos-firm (fail-closed) ---------------------------------------------------------

describe("P31 /internal/agent-ready/macos-firm (AC-510, §15.1, S-P31-1)", () => {
  it("AC-510: aktif ref + güncel label + kapı ok → 204 (no-store); müşteri ref'i de", async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const ok = await ready(l, "macos-firm", `/downloads/NoktaDestek-TestFirma-${ref}.zip`);
    expect(ok.statusCode).toBe(204);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const c = await createCustomerRow(t.id, { name: "Müşteri Firma" });
    const row = await testDb().customer.findUniqueOrThrow({ where: { id: c.id }, select: { requestRef: true, fileLabel: true } });
    expect((await ready(l, "macos-firm", `/downloads/NoktaDestek-${row.fileLabel}-${row.requestRef}.zip`)).statusCode).toBe(204);
  });

  it("AC-510: eksik/maskeli/sorgu dizeli/büyük harfli ref/.exe/eski label/yenilenmiş ref/pasif tenant/bilinmeyen ref → aynı 404 gövdesi", async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const bodies: string[] = [];
    const expect404 = async (uri: string | undefined) => {
      const r = await ready(l, "macos-firm", uri);
      expect(r.statusCode, String(uri)).toBe(404);
      bodies.push(r.body);
    };
    for (const uri of [
      undefined,
      "",
      "/downloads/***",
      `/downloads/NoktaDestek-TestFirma-${ref}.zip?x=1`,
      `/downloads/NoktaDestek-TestFirma-${ref.toUpperCase()}.zip`,
      `/downloads/noktadestek-TestFirma-${ref}.zip`,
      `/downloads/NoktaDestek-TestFirma-${ref}.exe`,
      `/downloads/NoktaDestek-BaskaFirma-${ref}.zip`,
      "/downloads/NoktaDestek-TestFirma-abcdefghijklmnop.zip",
      "/downloads/NoktaDestek-macOS.zip",
    ])
      await expect404(uri);
    await testDb().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { requestRef: "zzzzzzzzzzzzzzz2" } });
    await expect404(`/downloads/NoktaDestek-TestFirma-${ref}.zip`);
    await testDb().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { requestRef: ref } });
    await testDb().tenant.update({ where: { id: t.id }, data: { status: "PASSIVE" } });
    await expect404(`/downloads/NoktaDestek-TestFirma-${ref}.zip`);
    expect(new Set(bodies.map(strip)).size).toBe(1);
  });

  it("AC-510: mac kapısı kapalı → geçerli firma zip'i 503; geçersiz ref + kapı kapalı → 404 (ref denetimi kapıdan önce)", async () => {
    const l = await boot(bothEnv(MAC_CLOSED));
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const r = await ready(l, "macos-firm", `/downloads/NoktaDestek-TestFirma-${ref}.zip`);
    expect(r.statusCode).toBe(503);
    expect(errCode(r)).toBe("NOT_READY");
    expect((await ready(l, "macos-firm", "/downloads/NoktaDestek-TestFirma-abcdefghijklmnop.zip")).statusCode).toBe(404);
  });

  it("AC-510: kenar dışı (güvenilmeyen adres ya da X-Forwarded-Method yok) → 404", async () => {
    const l = await boot();
    const t = await createTenant();
    const uri = `/downloads/NoktaDestek-TestFirma-${await createRequestSettings(t.id)}.zip`;
    const noMethod = await l.app.inject({
      method: "GET",
      url: "/internal/agent-ready/macos-firm",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-uri": uri },
    });
    expect(noMethod.statusCode).toBe(404);
    const foreign = await l.app.inject({
      method: "GET",
      url: "/internal/agent-ready/macos-firm",
      remoteAddress: "203.0.113.9",
      headers: { "x-forwarded-method": "GET", "x-forwarded-uri": uri },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("T-P31-3, AC-510: uzantı ↔ kapı çaprazlanamaz — .zip windows kapısında 404; .exe windows'ta 204 (?x=1 dahil, değişmez); /macos URI okumaz", async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    expect((await ready(l, "windows", `/downloads/NoktaDestek-TestFirma-${ref}.zip`)).statusCode).toBe(404);
    expect((await ready(l, "windows", `/downloads/NoktaDestek-TestFirma-${ref}.exe`)).statusCode).toBe(204);
    expect((await ready(l, "windows", `/downloads/NoktaDestek-TestFirma-${ref}.exe?x=1`)).statusCode).toBe(204);
    // /macos (jenerik + kod zip'i) bugünkü onlyGate: geçersiz firma URI'si, maskeli ya da eksik başlıkla da 204.
    for (const uri of ["/downloads/NoktaDestek-Yanlis-abcdefghijklmnop.zip", "/downloads/***", undefined])
      expect((await ready(l, "macos", uri)).statusCode, String(uri)).toBe(204);
  });
});

// --- AC-511: clientOs talep → DB → audit → misafir ------------------------------------------------------------------

async function acceptedGuest(l: Live, clientOs: string | undefined) {
  const rc = requestClient(l.app, l.base);
  const t = await createTenant();
  const ref = await createRequestSettings(t.id);
  const res = await rc.createReq(ref, nextIp(), { version: "0.24.0", extra: clientOs === undefined ? {} : { clientOs } });
  expect(res.statusCode, res.body).toBe(201);
  const c = res.json<CreateRequestResponse>();
  const ws = await rc.reqWs(c.requestSecret);
  await waitMsg(ws, "request.state");
  const s = await loginAs(l.app, await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS }));
  const acc = await rc.accept(s.headers, c.requestId);
  expect(acc.statusCode, acc.body).toBe(200);
  const { sessionId } = acc.json<{ sessionId: string }>();
  const { wsTicket } = await waitMsg<{ wsTicket: string }>(ws, "request.accepted");
  const tech = await connect(`${l.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(s.token, ORIGIN));
  await tech.waitFor("hello");
  const guest = await rc.guestWs(wsTicket);
  await guest.waitFor("hello");
  return { requestId: c.requestId, sessionId, tech, guest, ws };
}

/** Teknisyen kontrol ister → misafir `OS_PERMISSION` ile reddeder (gerçek WS). */
async function sendOsPermission(tech: WsClient, guest: WsClient): Promise<void> {
  tech.send({ t: "control.request" });
  await guest.waitFor("control.request");
  guest.send({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" });
}
const techStates = (tech: WsClient) => tech.msgs.filter((m) => (m as { t: string }).t === "control.state");

describe("P31 POST /public/requests clientOs → misafir (AC-511, K-P31-4, D-2)", () => {
  it("AC-511: clientOs=macos → client_os 'macos', request.created audit clientOs=macos; kabul → /ws/guest misafiri macos, OS_PERMISSION teknisyene iletilir", async () => {
    const l = await boot();
    const x = await acceptedGuest(l, "macos");
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: x.requestId } });
    expect(row.clientOs).toBe("macos");
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: x.requestId, action: "request.created" } });
    expect(audit.newValue).toMatchObject({ clientOs: "macos", source: "AGENT" });
    const room = l.app.rooms.get(x.sessionId);
    expect(room?.admitted?.clientOs).toBe("macos");
    await sendOsPermission(x.tech, x.guest);
    await expect.poll(() => techStates(x.tech)).toContainEqual({ t: "control.state", state: "VIEW", source: "OS_PERMISSION" });
    expect(room?.control.state).toBe("VIEW");
    for (const c of [x.tech, x.guest, x.ws]) c.ws.close();
  });

  it("AC-511 (negatif): clientOs'suz talep (Windows / eski istemci) → client_os NULL, audit'te clientOs yok; misafir clientOs yok, OS_PERMISSION yok sayılır", async () => {
    const l = await boot();
    const x = await acceptedGuest(l, undefined);
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: x.requestId } });
    expect(row.clientOs).toBeNull();
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: x.requestId, action: "request.created" } });
    expect(audit.newValue).not.toHaveProperty("clientOs");
    const room = l.app.rooms.get(x.sessionId);
    expect(room?.admitted?.clientOs).toBeUndefined();
    await sendOsPermission(x.tech, x.guest);
    // Sunucu tarafı kanıt: iletim olsaydı durum VIEW'a dönerdi; yok sayıldı → istek bekler (REQUESTED), teknisyene iletim yok.
    await expect.poll(() => room?.control.state).toBe("REQUESTED");
    await new Promise((r) => setTimeout(r, 200));
    expect(room?.control.state).toBe("REQUESTED");
    expect(techStates(x.tech)).not.toContainEqual(expect.objectContaining({ source: "OS_PERMISSION" }));
    for (const c of [x.tech, x.guest, x.ws]) c.ws.close();
  });

  it("AC-511: clientOs=windows açık beyan saklanır ('windows')", async () => {
    const l = await boot();
    const rc = requestClient(l.app, l.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const res = await rc.createReq(ref, nextIp(), { extra: { clientOs: "windows" } });
    expect(res.statusCode).toBe(201);
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: res.json<CreateRequestResponse>().requestId } });
    expect(row.clientOs).toBe("windows");
  });

  it("AC-511: clientOs linux / büyük harf / boş / sayı → 400 VALIDATION (fields.clientOs), talep yazılmaz", async () => {
    const l = await boot();
    const rc = requestClient(l.app, l.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    for (const clientOs of ["linux", "MACOS", "", 1]) {
      const r = await rc.createReq(ref, nextIp(), { extra: { clientOs } });
      expect(r.statusCode).toBe(400);
      expect(r.json<{ error: { code: string; fields?: Record<string, string> } }>().error).toMatchObject({ code: "VALIDATION" });
      expect(r.json<{ error: { fields?: Record<string, string> } }>().error.fields?.clientOs).toBeTruthy();
    }
    expect(await testDb().supportRequest.count({ where: { tenantId: t.id } })).toBe(0);
  });

  it("AC-511: WEB talebi client_os her zaman NULL; WEB gövdesinde clientOs → 400 (alan yalnız AGENT'ta)", async () => {
    const l = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    await testDb().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { webFormEnabled: true } });
    l.app.requests.formTokens = backdatedTokens();
    const post = async (extra: Record<string, unknown>) => {
      const ip = nextIp();
      const f = await l.app.inject({
        method: "GET",
        url: `/api/v1/public/web-requests/form?ref=${ref}`,
        headers: { "x-forwarded-for": ip },
      });
      const info = f.json<WebFormInfo>();
      return l.app.inject({
        method: "POST",
        url: "/api/v1/public/web-requests",
        headers: { origin: ORIGIN, "x-forwarded-for": ip },
        payload: {
          ref,
          formToken: info.formToken,
          website: "",
          clientInstanceId: newSecretToken().slice(0, 22),
          customerName: "Ayşe Web",
          phone: "0532 111 22 33",
          description: "Tarayıcıdan destek istiyorum lütfen",
          consentTextId: info.consentText.id,
          consentAccepted: true,
          notify: { sms: false, whatsapp: false, email: false },
          ...extra,
        },
      });
    };
    const withOs = await post({ clientOs: "macos" });
    expect(withOs.statusCode).toBe(400);
    const ok = await post({});
    expect(ok.statusCode, ok.body).toBe(201);
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: ok.json<CreateRequestResponse>().requestId } });
    expect(row).toMatchObject({ source: "WEB", clientOs: null });
  });
});
