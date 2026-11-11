import { appendFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, CSRF_HEADER } from "@remote/contracts/api/auth";
import { rows } from "./helpers";

// test-operatoru — NAT sonrası TURN ölçümleri (2026-11-11). GERÇEK yerel server + MySQL + standalone web (:3238);
// server'ın TURN_URLS/TURN_SECRET'ı staging coturn'ü (185.126.217.99) gösterir → iki tarayıcı da gerçek internet
// üzerinden staging relay'e bağlanır (Mac → staging relay → Mac). Secret yalnız server süreci ortamında; bu dosyaya
// ve çıktılara girmez (iceServers kaydında credential/username YAZILMAZ).
// Relay zorlaması: addInitScript ile RTCPeerConnection sarmalanır → iceTransportPolicy:"relay"; MODE=udp|tcp|tls
// iceServers URL'lerini süzer (tls = yalnız turns:5349 → UDP kapalı ağ benzetimi, AC-23).
// Ölçümler JSONL'e (TURNOP_OUT) yazılır; AC eşiği burada assert edilmez (ölçüm koşusu), değerlendirme raporda.
const BASE = "http://localhost:3238";
const PASSWORD = process.env.E2E_REAL_PASSWORD ?? "";
const LOGIN = process.env.E2E_REAL_LOGIN ?? "";
const LOGIN2 = process.env.E2E_REAL_LOGIN2 ?? "";
const OUT = process.env.TURNOP_OUT ?? "turnop.jsonl";
const IMG = process.env.TURNOP_IMG ?? "turnimg";
const SAMPLE_SEC = Number(process.env.TURNOP_SEC ?? 65);
const rec = (o: Record<string, unknown>) => appendFileSync(OUT, JSON.stringify({ test: test.info().title, at: Date.now(), ...o }) + "\n");

type Mode = "any" | "udp" | "tcp" | "tls";

/** Tarayıcıda: RTCPeerConnection sarmalayıcısı (relay zorlaması + URL süzgeci + örnek kaydı). */
function forceRelay(mode: Mode) {
  const Orig = window.RTCPeerConnection;
  const keep = (u: string) =>
    mode === "any" ? true
    : mode === "tls" ? u.startsWith("turns:")
    : mode === "tcp" ? u.startsWith("turn:") && u.includes("transport=tcp")
    : u.startsWith("turn:") && u.includes("transport=udp");
  const filt = (c?: RTCConfiguration): RTCConfiguration => {
    const out: RTCConfiguration = { ...(c ?? {}), iceTransportPolicy: "relay" };
    if (c?.iceServers) out.iceServers = c.iceServers.map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter(keep) })).filter((s) => (s.urls as string[]).length > 0);
    (window as unknown as { __rsIceUrls: string[][] }).__rsIceUrls.push((out.iceServers ?? []).flatMap((s) => ([] as string[]).concat(s.urls)));
    return out;
  };
  const w = window as unknown as { __rsPcs: RTCPeerConnection[]; __rsIceUrls: string[][] };
  w.__rsPcs = [];
  w.__rsIceUrls = [];
  class P extends Orig {
    constructor(c?: RTCConfiguration) {
      super(filt(c));
      w.__rsPcs.push(this);
      // Tanı: ICE aday hataları ve toplanan yerel adaylar (URL/kod/metin; kimlik bilgisi yok)
      const d = ((window as unknown as { __rsIceDiag: unknown[] }).__rsIceDiag ??= []);
      this.addEventListener("icecandidateerror", (e) => { const x = e as RTCPeerConnectionIceErrorEvent; d.push({ err: x.errorCode, text: x.errorText, url: x.url }); });
      this.addEventListener("icecandidate", (e) => { if (e.candidate) d.push({ cand: e.candidate.candidate.replace(/ ufrag .*/, "") }); });
      this.addEventListener("icegatheringstatechange", () => d.push({ gathering: this.iceGatheringState }));
      this.addEventListener("iceconnectionstatechange", () => d.push({ ice: this.iceConnectionState }));
    }
    override setConfiguration(c?: RTCConfiguration) {
      return super.setConfiguration(filt(c));
    }
  }
  window.RTCPeerConnection = P as unknown as typeof RTCPeerConnection;
}

/**
 * getDisplayMedia taklidi: WxH canvas, 30 fps. Üst 4 blok satırında "ekran saati" (ms, düşük 32 bit, ikili; 2 satır +
 * 2 satır kopya = sağlama). Alt kısımda her karede değişen içerik + 10 pt benzeri küçük metin (okunurluk gözlemi).
 */
function fakeDisplayMedia(size: { w: number; h: number }) {
  const md = navigator.mediaDevices;
  if (!md) return;
  md.getDisplayMedia = async () => {
    const { w: W, h: H } = size;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d")!;
    const bw = W / 16;
    const bh = H / 9 / 2;
    let f = 0;
    const draw = () => {
      f++;
      x.fillStyle = `hsl(${(f * 7) % 360} 60% 50%)`;
      x.fillRect(0, 0, W, H);
      const t = Math.floor(performance.timeOrigin + performance.now()) >>> 0;
      for (let r = 0; r < 4; r++)
        for (let i = 0; i < 16; i++) {
          const bit = (t >>> ((r % 2) * 16 + i)) & 1;
          x.fillStyle = bit ? "#fff" : "#000";
          x.fillRect(i * bw, r * bh, bw, bh);
        }
      x.fillStyle = "#fff";
      x.font = `${Math.round(H / 9)}px sans-serif`;
      x.fillText(`kare ${f}`, 100 + ((f * 13) % (W / 2)), H * 0.6);
      x.fillStyle = "#000";
      x.font = "13px sans-serif"; // ~10 pt
      x.fillText("Bu 10 pt metin uzaktan okunur mu? 0123456789 ÇĞİÖŞÜ çğıöşü", 40, H * 0.85);
    };
    draw();
    const timer = setInterval(draw, 33);
    const s = c.captureStream(30);
    for (const tr of s.getVideoTracks()) tr.addEventListener("ended", () => clearInterval(timer));
    return s;
  };
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[name="login"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function cancelLeftovers(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE)?.value ?? "";
  const headers = { [CSRF_HEADER]: csrf, Origin: BASE };
  const list = (await (await page.request.get("/api/v1/sessions?pageSize=100")).json()) as { items: { id: string; status: string }[] };
  for (const s of list.items.filter((i) => i.status === "PENDING" || i.status === "ACTIVE"))
    await page.request.post(`/api/v1/sessions/${s.id}/${s.status === "PENDING" ? "cancel" : "terminate"}`, { headers, data: {} });
}
function track(p: Page, who: string) {
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") rec({ kind: "console", who, type: m.type(), text: m.text().slice(0, 300) }); });
  p.on("pageerror", (e) => rec({ kind: "pageerror", who, text: e.message.slice(0, 300) }));
}

async function live(browser: Browser, mode: Mode, size: { w: number; h: number }, email: string): Promise<{ page: Page; g: Page; tctx: BrowserContext; gctx: BrowserContext; tShare: number }> {
  const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await tctx.addInitScript(forceRelay, mode);
  const page = await tctx.newPage();
  track(page, "tech");
  await login(page, email);
  await cancelLeftovers(page);
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  const link = await dlg.getByTestId("session-link").inputValue();
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await rows(page).first().getByTestId("open-console").click();
  await page.waitForURL(/\/console$/);
  const gctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await gctx.addInitScript(forceRelay, mode);
  await gctx.addInitScript(fakeDisplayMedia, size);
  const g = await gctx.newPage();
  track(g, "guest");
  await g.goto(link);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ölçüm Müşteri");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\D/g, "");
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  // DC (ctl) açık → ICE (relay) kuruldu; paylaşımdan önce bekle ki ilk kare ölçümü ICE süresini içermesin
  const tAdmit = Date.now();
  try {
    await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 30_000 });
  } finally {
    const diag = (p: Page) => p.evaluate(() => (window as unknown as { __rsIceDiag?: unknown[] }).__rsIceDiag ?? []);
    rec({ kind: "iceDiag", mode, ms: Date.now() - tAdmit, tech: await diag(page), guest: await diag(g) });
  }
  await expect(g.getByTestId("chat-input")).toBeEnabled({ timeout: 30_000 });
  const tShare = Date.now();
  await g.getByTestId("share-start").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await expect
    .poll(() => page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0), { timeout: 20_000 })
    .toBe(true);
  return { page, g, tctx, gctx, tShare };
}

/** Seçili aday çifti (transport.selectedCandidatePairId; yoksa nominated+succeeded). values() ile. */
async function pairInfo(p: Page) {
  return p.evaluate(async () => {
    const pc = (window as unknown as { __rsPcs: RTCPeerConnection[] }).__rsPcs.filter((x) => x.connectionState !== "closed").at(-1);
    if (!pc) return null;
    const r = await pc.getStats();
    const all = [...r.values()] as Record<string, unknown>[];
    const byId = (id: unknown) => all.find((s) => s.id === id);
    const tr = all.find((s) => s.type === "transport");
    const pair = (tr?.selectedCandidatePairId ? byId(tr.selectedCandidatePairId) : undefined) ?? all.find((s) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded");
    const l = byId(pair?.localCandidateId);
    const rm = byId(pair?.remoteCandidateId);
    return {
      connectionState: pc.connectionState,
      iceTransportPolicy: pc.getConfiguration().iceTransportPolicy,
      pairState: pair?.state, rttMs: typeof pair?.currentRoundTripTime === "number" ? (pair.currentRoundTripTime as number) * 1000 : null,
      local: { type: l?.candidateType, protocol: l?.protocol, relayProtocol: l?.relayProtocol, address: l?.address, port: l?.port, url: l?.url },
      remote: { type: rm?.candidateType, protocol: rm?.protocol, address: rm?.address, port: rm?.port },
      tlsVersion: tr?.tlsVersion, dtlsState: tr?.dtlsState,
    };
  });
}

/** 1 sn'de bir: teknisyen inbound-rtp (fps, kbps, çözünürlük, kayıp, jitter, decode), aday çifti RTT; misafir outbound-rtp. */
async function sampleLoop(page: Page, g: Page, sec: number, label: string) {
  const inb = () => page.evaluate(async () => {
    const pc = (window as unknown as { __rsPcs: RTCPeerConnection[] }).__rsPcs.filter((x) => x.connectionState !== "closed").at(-1)!;
    const all = [...(await pc.getStats()).values()] as Record<string, number & string>[];
    const v = all.find((s) => s.type === "inbound-rtp" && s.kind === "video");
    const tr = all.find((s) => s.type === "transport");
    const pair = all.find((s) => s.id === tr?.selectedCandidatePairId);
    const codec = all.find((s) => s.id === v?.codecId);
    return { t: performance.timeOrigin + performance.now(), fps: v?.framesPerSecond ?? null, framesDecoded: v?.framesDecoded, framesDropped: v?.framesDropped, bytes: v?.bytesReceived, w: v?.frameWidth, h: v?.frameHeight,
      lost: v?.packetsLost, recv: v?.packetsReceived, jitter: v?.jitter, jbDelay: v?.jitterBufferDelay, jbEmitted: v?.jitterBufferEmittedCount, freeze: v?.freezeCount, totalDecodeTime: v?.totalDecodeTime,
      rttMs: typeof pair?.currentRoundTripTime === "number" ? pair.currentRoundTripTime * 1000 : null, codec: codec?.mimeType, availIn: pair?.availableIncomingBitrate };
  });
  const out = () => g.evaluate(async () => {
    const pc = (window as unknown as { __rsPcs: RTCPeerConnection[] }).__rsPcs.filter((x) => x.connectionState !== "closed").at(-1)!;
    const all = [...(await pc.getStats()).values()] as Record<string, number & string>[];
    const o = all.find((s) => s.type === "outbound-rtp" && s.kind === "video");
    const tr = all.find((s) => s.type === "transport");
    const pair = all.find((s) => s.id === tr?.selectedCandidatePairId);
    const codec = all.find((s) => s.id === o?.codecId);
    return { fps: o?.framesPerSecond, w: o?.frameWidth, h: o?.frameHeight, targetBitrate: o?.targetBitrate, bytes: o?.bytesSent, qlr: o?.qualityLimitationReason, qld: o?.qualityLimitationDurations,
      enc: o?.encoderImplementation, codec: codec?.mimeType, sdpFmtp: codec?.sdpFmtpLine, availOut: pair?.availableOutgoingBitrate, rttMs: typeof pair?.currentRoundTripTime === "number" ? pair.currentRoundTripTime * 1000 : null,
      nack: o?.nackCount, pli: o?.pliCount, retx: o?.retransmittedPacketsSent };
  });
  let prev = await inb();
  let prevO = await out();
  for (let i = 0; i < sec; i++) {
    await page.waitForTimeout(1000);
    const c = await inb();
    const o = await out();
    const dt = (c.t - prev.t) / 1000;
    const kbps = c.bytes != null && prev.bytes != null ? ((c.bytes - prev.bytes) * 8) / dt / 1000 : null;
    const fpsCalc = c.framesDecoded != null && prev.framesDecoded != null ? (c.framesDecoded - prev.framesDecoded) / dt : null;
    const outKbps = o.bytes != null && prevO.bytes != null ? ((o.bytes - prevO.bytes) * 8) / dt / 1000 : null;
    rec({ kind: "sample", label, i, fps: c.fps, fpsCalc, kbps, rttMs: c.rttMs, w: c.w, h: c.h, lost: c.lost, recv: c.recv, jitterMs: c.jitter != null ? c.jitter * 1000 : null,
      jbMs: c.jbDelay != null && c.jbEmitted ? (c.jbDelay / c.jbEmitted) * 1000 : null, freeze: c.freeze, dropped: c.framesDropped, codec: c.codec,
      out: { fps: o.fps, w: o.w, h: o.h, targetKbps: o.targetBitrate != null ? o.targetBitrate / 1000 : null, kbps: outKbps, qlr: o.qlr, enc: o.enc, codec: o.codec, availOutKbps: o.availOut != null ? o.availOut / 1000 : null, nack: o.nack, pli: o.pli } });
    prev = c;
    prevO = o;
  }
}

/** Ekran saati (AC-42): teknisyende her video karesinde (rVFC) üst blokları çöz, gösterim anı − kodlanan zaman. */
async function startClock(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __rsLat: number[]; __rsLatBad: number; __rsLatStop: boolean };
    w.__rsLat = [];
    w.__rsLatBad = 0;
    w.__rsLatStop = false;
    const cv = document.createElement("canvas");
    cv.width = 320;
    cv.height = 180;
    const x = cv.getContext("2d", { willReadFrequently: true })!;
    const v = document.querySelector<HTMLVideoElement>('[data-testid="console-video"]')!;
    const decodeRow = (y: number) => {
      let n = 0;
      const d = x.getImageData(0, Math.round(y), 320, 1).data;
      for (let i = 0; i < 16; i++) {
        const px = Math.round((i + 0.5) * 20) * 4;
        const lum = 0.299 * d[px]! + 0.587 * d[px + 1]! + 0.114 * d[px + 2]!;
        if (lum > 128) n |= 1 << i;
      }
      return n >>> 0;
    };
    const bh = 180 / 9 / 2;
    const cb = (now: number) => {
      if (w.__rsLatStop) return;
      x.drawImage(v, 0, 0, 320, 180);
      const a = (decodeRow(bh * 0.5) | (decodeRow(bh * 1.5) << 16)) >>> 0;
      const b = (decodeRow(bh * 2.5) | (decodeRow(bh * 3.5) << 16)) >>> 0;
      const shown = Math.floor(performance.timeOrigin + now) >>> 0;
      if (a === b) {
        const d = (shown - a) >>> 0;
        if (d < 10_000) w.__rsLat.push(d);
        else w.__rsLatBad++;
      } else w.__rsLatBad++;
      v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  });
}
async function stopClock(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __rsLat: number[]; __rsLatBad: number; __rsLatStop: boolean };
    w.__rsLatStop = true;
    return { lat: w.__rsLat, bad: w.__rsLatBad };
  });
}

/** Misafir kodlayıcı ayarları (AC-42 / görev: çözünürlük, codec, maxBitrate). */
async function encoderInfo(g: Page) {
  return g.evaluate(async () => {
    const pc = (window as unknown as { __rsPcs: RTCPeerConnection[] }).__rsPcs.filter((x) => x.connectionState !== "closed").at(-1)!;
    const s = pc.getSenders().find((x) => x.track?.kind === "video");
    const p = s?.getParameters();
    const tr = s?.track;
    const local = pc.localDescription?.sdp ?? "";
    const mVideo = local.split("m=").find((x) => x.startsWith("video")) ?? "";
    return {
      encodings: p?.encodings, degradationPreference: (p as { degradationPreference?: string } | undefined)?.degradationPreference, codecs: p?.codecs?.slice(0, 6).map((c) => `${c.mimeType} ${c.sdpFmtpLine ?? ""}`),
      contentHint: tr?.contentHint, trackSettings: tr?.getSettings(), bAS: /b=AS:(\d+)/.exec(mVideo)?.[1] ?? null, bTIAS: /b=TIAS:(\d+)/.exec(mVideo)?.[1] ?? null,
      xGoogle: /x-google-[a-z-]+=\d+/.exec(mVideo)?.[0] ?? null,
    };
  });
}

/** AC-40: paylaşım başlat tıklaması (misafir, capture dinleyici) → teknisyende ilk çözülen kare (framesDecoded artışı, 10 ms yoklama). */
async function firstFrameCycles(page: Page, g: Page, n: number, label: string) {
  const res: number[] = [];
  for (let i = 0; i < n; i++) {
    await g.getByTestId("share-stop").click();
    await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "stopped");
    await page.waitForTimeout(2000);
    await g.evaluate(() => {
      document.querySelector('[data-testid="share-start"]')!.addEventListener("click", () => {
        (window as unknown as { __rsT0: number }).__rsT0 = performance.timeOrigin + performance.now();
      }, { once: true, capture: true });
    });
    // Teknisyende yoklama tıklamadan önce başlar (taban = durdurulmuş akışın son framesDecoded'u); mutlak saat döner.
    const waitFrame = page.evaluate(async () => {
      const pc = (window as unknown as { __rsPcs: RTCPeerConnection[] }).__rsPcs.filter((x) => x.connectionState !== "closed").at(-1)!;
      const dec = async () => ([...(await pc.getStats()).values()] as Record<string, number & string>[]).find((s) => s.type === "inbound-rtp" && s.kind === "video")?.framesDecoded ?? 0;
      const base = await dec();
      (window as unknown as { __rsFFready: boolean }).__rsFFready = true;
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        if ((await dec()) > base) return performance.timeOrigin + performance.now();
        await new Promise((r) => setTimeout(r, 10));
      }
      return -1;
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __rsFFready?: boolean }).__rsFFready === true)).toBe(true);
    await g.getByTestId("share-start").click();
    const tFrame = await waitFrame;
    await page.evaluate(() => { (window as unknown as { __rsFFready?: boolean }).__rsFFready = false; });
    const tClick = await g.evaluate(() => (window as unknown as { __rsT0: number }).__rsT0);
    const ms = tFrame < 0 ? -1 : tFrame - tClick;
    res.push(ms);
    rec({ kind: "firstframe", label, i, ms });
  }
  return res;
}

/** AC-57: N çizgi, gönderim (pointerup) → müşteri data-strokes artışı ve sonraki rAF (boyama). */
async function annotLatency(page: Page, g: Page, n: number, label: string) {
  await page.evaluate(() => {
    const w = window as unknown as { __rsT: number[] };
    w.__rsT = [];
    window.addEventListener("pointerup", (e) => {
      if ((e.target as HTMLElement).dataset?.testid === "annot-layer") w.__rsT.push(performance.timeOrigin + performance.now());
    }, true);
  });
  await g.evaluate(() => {
    const w = window as unknown as { __rsT: number[]; __rsP: number[] };
    w.__rsT = [];
    w.__rsP = [];
    const el = document.querySelector<HTMLElement>('[data-testid="annot-layer"]')!;
    let last = Number(el.dataset.strokes ?? 0);
    new MutationObserver(() => {
      const v = Number(el.dataset.strokes);
      if (v > last) {
        w.__rsT.push(performance.timeOrigin + performance.now());
        requestAnimationFrame(() => w.__rsP.push(performance.timeOrigin + performance.now()));
      }
      last = v;
    }).observe(el, { attributes: true, attributeFilter: ["data-strokes"] });
  });
  const layer = page.getByTestId("annot-layer");
  const box = (await layer.boundingBox())!;
  await page.getByTestId("annot-pen").click();
  const BATCH = 50;
  const lat: number[] = [];
  const paintLat: number[] = [];
  const lost: Record<string, unknown>[] = [];
  const counts = async () => ({ tech: Number(await layer.getAttribute("data-strokes")), guest: Number(await g.getByTestId("annot-layer").getAttribute("data-strokes")) });
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (k === BATCH) {
      await page.getByTestId("annot-clear").click();
      await expect(g.getByTestId("annot-layer")).toHaveAttribute("data-strokes", "0");
      if ((await page.getByTestId("annot-pen").getAttribute("aria-pressed")) !== "true") await page.getByTestId("annot-pen").click();
      k = 0;
    }
    const before = await g.evaluate(() => (window as unknown as { __rsT: number[] }).__rsT.length);
    const sentBefore = await page.evaluate(() => (window as unknown as { __rsT: number[] }).__rsT.length);
    const y = box.y + box.height * (0.3 + (0.4 * k) / BATCH);
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y + 10, { steps: 3 });
    await page.mouse.up();
    let ok = true;
    try {
      await expect(g.getByTestId("annot-layer")).toHaveAttribute("data-strokes", String(k + 1), { timeout: 3000 });
    } catch {
      ok = false;
    }
    const sent = await page.evaluate(() => (window as unknown as { __rsT: number[] }).__rsT);
    const shown = await g.evaluate(() => (window as unknown as { __rsT: number[] }).__rsT);
    const painted = await g.evaluate(() => (window as unknown as { __rsP: number[] }).__rsP);
    if (ok && sent.length === sentBefore + 1 && shown.length === before + 1) {
      lat.push(shown.at(-1)! - sent.at(-1)!);
      paintLat.push(painted.at(-1)! - sent.at(-1)!);
      k++;
    } else {
      lost.push({ i, k, ok, pointerups: sent.length - sentBefore, guestEvents: shown.length - before, ...(await counts()) });
      k = BATCH; // yeniden eşitle: temizle ve yeni parti
    }
  }
  rec({ kind: "annot", label, n, ok: lat.length, lost, lat, paintLat });
}

test.describe.configure({ mode: "serial" });

for (const mode of (process.env.TURNOP_MODES ?? "any,tls,udp,tcp").split(",") as Mode[]) {
  test(`TURN relay [${mode}] 1280x720: aday çifti + ${SAMPLE_SEC} sn fps/kbps/RTT + ekran saati + kodlayıcı + ilk kare${mode === "any" || mode === "tls" ? " + işaretleme" : ""}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const email = mode === "tcp" || mode === "tls" ? LOGIN2 : LOGIN;
    const { page, g, tctx, gctx, tShare } = await live(browser, mode, { w: 1280, h: 720 }, email);
    rec({ kind: "iceUrls", mode, tech: await page.evaluate(() => (window as unknown as { __rsIceUrls: string[][] }).__rsIceUrls), guest: await g.evaluate(() => (window as unknown as { __rsIceUrls: string[][] }).__rsIceUrls) });
    rec({ kind: "firstVideoUi", mode, ms: Date.now() - tShare });
    rec({ kind: "pair", who: "tech", mode, ...(await pairInfo(page)) });
    rec({ kind: "pair", who: "guest", mode, ...(await pairInfo(g)) });
    await startClock(page);
    await sampleLoop(page, g, SAMPLE_SEC, `${mode}-720p`);
    const clk = await stopClock(page);
    rec({ kind: "clock", label: `${mode}-720p`, n: clk.lat.length, bad: clk.bad, lat: clk.lat });
    rec({ kind: "encoder", label: `${mode}-720p`, ...(await encoderInfo(g)) });
    await page.getByTestId("collab-side").getByRole("button", { name: "Kalite" }).click().catch(() => undefined);
    await page.screenshot({ path: `${IMG}/turn-${mode}-720p-konsol.png` });
    rec({ kind: "pair-end", who: "tech", mode, ...(await pairInfo(page)) });
    if (mode === "any" || mode === "tls") {
      await firstFrameCycles(page, g, 20, `${mode}-720p`);
      await annotLatency(page, g, 220, `${mode}-720p`);
    }
    await page.getByTestId("console-end").click();
    await page.getByTestId("console-confirm-ok").click();
    await expect(g.getByTestId("guest-finished")).toBeVisible();
    await gctx.close();
    await tctx.close();
  });
}

test("TURN relay [any] 1920x1080 kaynak (AC-41): alıcı fps/çözünürlük + ekran saati", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const { page, g, tctx, gctx } = await live(browser, "any", { w: 1920, h: 1080 }, LOGIN);
  rec({ kind: "pair", who: "tech", mode: "any-1080p", ...(await pairInfo(page)) });
  await startClock(page);
  await sampleLoop(page, g, SAMPLE_SEC + 15, "any-1080p");
  const clk = await stopClock(page);
  rec({ kind: "clock", label: "any-1080p", n: clk.lat.length, bad: clk.bad, lat: clk.lat });
  rec({ kind: "encoder", label: "any-1080p", ...(await encoderInfo(g)) });
  await page.getByTestId("collab-side").getByRole("button", { name: "Kalite" }).click().catch(() => undefined);
  await page.screenshot({ path: `${IMG}/turn-any-1080p-konsol.png` });
  await page.getByTestId("console-video").screenshot({ path: `${IMG}/turn-any-1080p-video.png` });
  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await gctx.close();
  await tctx.close();
});
