import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import { startFakeAgent } from "./fake-agent";
import { desktopOnly, guardConsole, newSession, noHorizontalOverflow, scanThemes, signIn } from "./helpers";

// P28d K2 (mimari-p28d r2 §9) — AC-373, 374, 375, 376 (@perf), 377 (tarayıcı kısmı), 379; K-PD-2 negatif; D-PD-1
// Permissions-Policy; axe açık/koyu; 1280/375 taşma. Sahte WS e2e/mock-ws.mjs (voice*: K1 durum makinesi taklidi,
// u-p28d* ses odası). Sahte medya bayrakları playwright.config.ts'te zaten genel (yalnız bu spec için ek bayrak gerekmedi).
//
// AC-378 (çoklu teknisyen sesi) e2e KAPSAM DIŞI — koordinatör kararı: sahte WS tek teknisyen bağlar (ikinci konsol 4409 ile
// birincisini atar; çerez başına oturum listesi ikinci/üçüncü kullanıcıya oturumu paylaştırmaz) ve çok eşli tarayıcı misafiri
// gerçek sunucu gerektirir. Kapsam: sunucu entegrasyon testi (apps/server test/integration/voice-p28d.test.ts: izleyici
// 403, katılımcı join, listeners/applyPermChange), web birim testi (lib/voice/voice-p28d.test.ts: mix-minus planı, talker ve
// gönderim kapısı, duyuru) ve staging elle doğrulama.
guardConsole();
const MOCK = "http://127.0.0.1:4217";
const TECH = "Mehmet Kaya";

type W = Window & { __gum: number; __mics: MediaStreamTrack[]; __denyMic: boolean };

/**
 * getUserMedia sayacı + dönen ses izleri `window.__mics`; `__denyMic` = izin reddi (NotAllowedError). Ses izi WebAudio
 * osilatöründen üretilir: macOS başsız Chromium'da sahte ses aygıtı (`--use-fake-device-for-media-stream`) izin verilmiş
 * olsa da `getUserMedia({audio})`'yu hiç çözmüyor (gözlendi). Çağrı her iki tarafta da kullanıcı tıklamasından sonra gelir.
 */
function instrumentMic() {
  const w = window as unknown as W;
  w.__gum = 0;
  w.__mics = [];
  w.__denyMic = false;
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (!c?.audio) return orig(c);
    w.__gum++;
    if (w.__denyMic) throw new DOMException("Permission denied", "NotAllowedError");
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    w.__mics.push(...dst.stream.getAudioTracks());
    return dst.stream;
  };
}
const gumCount = (p: Page) => p.evaluate(() => (window as unknown as W).__gum);

/** Sayfa içinde: tüm mikrofon izleri `ended` olduğu duvar saati (5 sn içinde olmazsa -1). */
function micsEndedAt(p: Page) {
  return p.evaluate(
    () =>
      new Promise<number>((res) => {
        const t0 = Date.now();
        const id = setInterval(() => {
          const ms = (window as unknown as W).__mics;
          if (ms.length && ms.every((t) => t.readyState === "ended")) return (clearInterval(id), res(Date.now()));
          if (Date.now() - t0 > 5000) {
            clearInterval(id);
            res(-1);
          }
        }, 5);
      }),
  );
}

/** Misafir diyaloğu: görünme ve "Kabul et"in etkinleşme anları (1,5 sn kilit, sayfa içi ölçüm). */
function watchDialog() {
  const w = window as unknown as { __dlg: { shown: number; armed: number } };
  w.__dlg = { shown: 0, armed: 0 };
  new MutationObserver(() => {
    const d = document.querySelector('[data-testid="voice-request"]');
    if (!d) return void (w.__dlg = { shown: 0, armed: 0 });
    if (!w.__dlg.shown) w.__dlg.shown = performance.now();
    const a = document.querySelector<HTMLButtonElement>('[data-testid="voice-accept"]');
    if (a && !a.disabled && !w.__dlg.armed) w.__dlg.armed = performance.now();
  }).observe(document, { subtree: true, childList: true, attributes: true });
}

async function join(browser: Browser, link: string, rec = false) {
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.addInitScript(instrumentMic);
  await g.addInitScript(watchDialog);
  await g.goto(new URL(link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  if (rec) await g.getByTestId("rec-consent").check();
  await g.getByTestId("join-browser").click();
  await expect(g.getByTestId("guest-lobby")).toBeVisible();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  return { g, code };
}

async function live(page: Page, context: BrowserContext, browser: Browser, scenario = "p28d", rec = false) {
  await signIn(context, scenario);
  await page.addInitScript(instrumentMic);
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  const { g, code } = await join(browser, s.link, rec);
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
  return { s, g };
}

const wsLog = async (page: Page, id: string) =>
  (await (await page.request.get(`${MOCK}/__e2e/ws-log/${id}`)).json()) as { from: string; m: Record<string, unknown> }[];
const voiceHook = (page: Page, id: string, q: string) => page.request.get(`${MOCK}/__e2e/voice/${id}?${q}`);

/** İstek → misafir diyaloğu; kilit açılınca döner. */
async function ask(page: Page, g: Page) {
  await page.getByTestId("voice-call").click();
  await expect(page.getByTestId("voice-waiting")).toContainText("Yanıt bekleniyor");
  const dlg = g.getByTestId("voice-request");
  await expect(dlg).toBeVisible();
  await expect(g.getByTestId("voice-accept")).toBeEnabled({ timeout: 4000 });
  return dlg;
}

async function accept(page: Page, g: Page) {
  await ask(page, g);
  await g.getByTestId("voice-accept").click();
  await expect(g.getByTestId("voice-bar")).toHaveAttribute("data-mic", "on");
  await expect(page.getByTestId("voice-mic-state")).toHaveText("Mikrofon açık");
}

test.describe("P28d sesli görüşme (tarayıcı misafir)", () => {
  test("AC-373: izin reddinde istek gitmez; istek → müşteri diyaloğu (odak Reddet, Kabul 1,5 sn kilitli); ret → konsol bildirimi; 60 sn zaman aşımı", async ({
    page,
    context,
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    test.setTimeout(90_000);
    const { s, g } = await live(page, context, browser);

    // İzin reddi: istek GİTMEZ, tarayıcı ayarı yönergesi
    await page.evaluate(() => ((window as unknown as W).__denyMic = true));
    await page.getByTestId("voice-call").click();
    await expect(page.getByTestId("voice-notice")).toHaveAttribute("data-kind", "micDenied");
    expect((await wsLog(page, s.id)).filter((x) => x.m.t === "voice.request")).toHaveLength(0);
    await page.evaluate(() => ((window as unknown as W).__denyMic = false));

    const dlg = await ask(page, g);
    await expect(dlg).toHaveAttribute("role", "alertdialog");
    await expect(dlg).toContainText(`${TECH} sesli görüşme istiyor`);
    await expect(g.getByTestId("voice-headset")).toBeVisible();
    await expect(g.getByTestId("voice-reject")).toBeFocused();
    const lock = await g.evaluate(() => {
      const d = (window as unknown as { __dlg: { shown: number; armed: number } }).__dlg;
      return d.armed - d.shown;
    });
    expect(lock).toBeGreaterThanOrEqual(1400);
    expect(lock).toBeLessThanOrEqual(2500);
    test.info().annotations.push({ type: "AC-373 kilit", description: `${Math.round(lock)} ms` });
    expect(await gumCount(g), "diyalog mikrofon açmaz (K-PD-2)").toBe(0);
    await scanThemes(g, '[data-testid="voice-request"]', "müşteri ses diyaloğu");

    await g.getByTestId("voice-reject").click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText("Müşteri sesli görüşmeyi reddetti")).toBeVisible();
    const notice = page.getByTestId("voice-notice");
    await expect(notice).toHaveAttribute("data-kind", "rejected");
    await expect(notice).toHaveText("Müşteri reddetti — 30 sn sonra tekrar deneyebilirsiniz");
    await expect(page.getByTestId("voice-call")).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__mics.every((t) => t.readyState === "ended"))).toBe(true);
    expect(await gumCount(g)).toBe(0);
    await scanThemes(page, '[data-testid="voice-controls"]', "konsol ses bildirimi");

    // Zaman aşımı (sahte saat: sunucu 60 sn zamanlayıcısını kanca doldurur); bekleme kancayla sıfırlanır
    await voiceHook(page, s.id, "cool");
    await page.reload();
    await expect(page.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
    await ask(page, g);
    expect((await (await voiceHook(page, s.id, "timeout")).json()).phase).toBe("idle");
    await expect(g.getByTestId("voice-request")).toBeHidden();
    await expect(page.getByText("Müşteri yanıt vermedi", { exact: true })).toBeVisible();
    await expect(page.getByTestId("voice-notice")).toHaveAttribute("data-kind", "timeout");
    await g.context().close();
  });

  test("AC-374 / AC-377 (tarayıcı): kabul → iki tarafta 'Mikrofon açık', Sessize al; bitir → mikrofon izi ≤ 1 sn ended; müşteri bitirince bildirim; SDP Opus + DTLS", async ({
    page,
    context,
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    test.setTimeout(90_000);
    const offers: string[] = [];
    page.on("websocket", (ws) =>
      ws.on("framesent", (f) => {
        const m = typeof f.payload === "string" && f.payload.includes('"sdp.offer"') ? (JSON.parse(f.payload) as { sdp: string }) : null;
        if (m) offers.push(m.sdp);
      }),
    );
    const { s, g } = await live(page, context, browser);
    await accept(page, g);
    await expect(g.getByTestId("voice-bar-mic")).toHaveText("Mikrofon açık");
    await expect(g.getByTestId("voice-bar-talkers")).toHaveText(`Konuşan: ${TECH}`);
    expect(await gumCount(g)).toBe(1);
    // AC-376 (§9): görüşme sürerken konsol kalite panelinde "Ses kaybı %x" satırı
    await page.getByTestId("collab-side").getByRole("button", { name: "Kalite" }).click();
    await expect(page.getByTestId("quality-panel")).toContainText(/Ses kaybı\s*%\d/, { timeout: 10_000 });
    // AC-375: ses WebRTC Opus + DTLS-SRTP
    expect(offers.some((x) => /a=rtpmap:\d+ opus\/48000\/2/.test(x) && /a=fingerprint:/.test(x))).toBe(true);

    // Sessize al (konsol + müşteri): gösterge ve iz `enabled=false`
    await page.getByTestId("voice-mute").click();
    await expect(page.getByTestId("voice-mic-state")).toHaveAttribute("data-muted", "true");
    await expect(page.getByTestId("voice-mic-state")).toHaveText("Sessizde");
    expect(await page.evaluate(() => (window as unknown as W).__mics.at(-1)!.enabled)).toBe(false);
    await page.getByTestId("voice-mute").click();
    await expect(page.getByTestId("voice-mic-state")).toHaveText("Mikrofon açık");
    await g.getByTestId("voice-bar-mute").click();
    await expect(g.getByTestId("voice-bar")).toHaveAttribute("data-muted", "true");
    expect(await g.evaluate(() => (window as unknown as W).__mics.at(-1)!.enabled)).toBe(false);
    await g.getByTestId("voice-bar-mute").click();

    await scanThemes(page, '[data-testid="voice-controls"]', "konsol görüşme");
    await scanThemes(g, '[data-testid="voice-bar"]', "müşteri görüşme çubuğu");
    for (const [p, w] of [
      [page, 1280],
      [page, 375],
      [g, 1280],
      [g, 375],
    ] as const) {
      await p.setViewportSize({ width: w, height: 800 });
      await noHorizontalOverflow(p);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Konsol bitirir: iki taraf mikrofonu ≤ 1 sn
    const guestEnded = micsEndedAt(g);
    const consoleEnded = micsEndedAt(page);
    const at = Date.now();
    await page.getByTestId("voice-end").click();
    const [ce, ge] = await Promise.all([consoleEnded, guestEnded]);
    expect(ce).toBeGreaterThan(0);
    expect(ge).toBeGreaterThan(0);
    expect(ce - at).toBeLessThanOrEqual(1000);
    expect(ge - at).toBeLessThanOrEqual(1000);
    test.info().annotations.push({ type: "AC-374", description: `konsol ${ce - at} ms, müşteri ${ge - at} ms` });
    await expect(page.getByText(/^Sesli görüşme bitti/)).toBeVisible();
    await expect(g.getByTestId("voice-bar")).toHaveCount(0);
    await expect(page.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");

    // İkinci görüşme (teknisyen bitişi bekleme başlatmaz); müşteri bitirir
    await accept(page, g);
    const consoleEnded2 = micsEndedAt(page);
    const at2 = Date.now();
    await g.getByTestId("voice-bar-end").click();
    const ce2 = await consoleEnded2;
    expect(ce2 - at2).toBeLessThanOrEqual(1000);
    await expect(page.getByTestId("voice-notice")).toHaveAttribute("data-kind", "customerEnded");
    const ends = (await wsLog(page, s.id)).filter((x) => x.m.t === "voice.end");
    expect(ends.map((x) => [x.from, x.m.reason ?? null])).toEqual([
      ["tech", null],
      ["guest", "customer"],
    ]);
    await g.context().close();
  });

  test("K-PD-2 negatif: rızasız voice.state{active} mikrofonu açmaz, voice.end{customer} gider", async ({
    page,
    context,
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    const { s, g } = await live(page, context, browser);
    const { callId } = (await (await voiceHook(page, s.id, "stray")).json()) as { callId: string };
    await expect
      .poll(async () => (await wsLog(page, s.id)).filter((x) => x.from === "guest" && x.m.t === "voice.end").map((x) => x.m))
      .toEqual([{ t: "voice.end", callId, reason: "customer" }]);
    expect(await gumCount(g)).toBe(0);
    await expect(g.getByTestId("voice-bar")).toHaveCount(0);
    await g.context().close();
  });

  test("AC-375: görüşme sürerken kayıt parçasının WebM Tracks'inde ses izi 0 (video 1)", async ({ page, context, browser }, info) => {
    desktopOnly(info.project.name);
    test.setTimeout(90_000);
    const { s, g } = await live(page, context, browser, "p28drec", true);
    await g.getByTestId("share-start").click();
    await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
    await accept(page, g);
    // Görüşme etkinken yeni bölüm: kaydedici yeni başlıkla (EBML + Tracks) yeniden kurulur
    await page.request.get(`${MOCK}/__e2e/rec/${s.id}?series=1`);
    const rid = ((await (await page.request.get(`${MOCK}/__e2e/rec/${s.id}`)).json()) as { rid: string }).rid;
    const head = async () =>
      ((await (await page.request.get(`${MOCK}/__e2e/rec-parts/${rid}?full=1`)).json()) as { k: string; b64?: string }[]).find(
        (x) => x.k === "1:0",
      )?.b64;
    await expect.poll(head, { timeout: 20_000 }).toBeTruthy();
    const types = trackTypes(Buffer.from((await head())!, "base64"));
    test.info().annotations.push({ type: "AC-375 TrackType", description: types.join(",") });
    expect(types.filter((x) => x === 1)).toHaveLength(1);
    expect(types.filter((x) => x === 2)).toHaveLength(0);
    await g.context().close();
  });

  test("AC-379: eski istemci (voice1 yok) → 'Sesli görüşme' pasif + AC-352 metni", async ({ page, context, browser }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "p28dold");
    const s = await newSession(page);
    await page.goto(`/sessions/${s.id}/console`);
    await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting"); // teknisyen WS hello aldı
    const a = await startFakeAgent(browser, s.id);
    await expect(page.getByTestId("console-status")).toHaveText("Aktif");
    await expect(page.getByTestId("voice-controls")).toHaveAttribute("data-view", "unsupported");
    await expect(page.getByTestId("voice-call")).toBeDisabled();
    await expect(page.getByTestId("voice-notice")).toHaveText(MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED);
    await expect(page.getByTestId("voice-call")).toHaveAccessibleDescription(MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED);
    await scanThemes(page, '[data-testid="voice-controls"]', "konsol eski istemci");
    await a.context().close();
  });

  test("D-PD-1 Permissions-Policy: /r/* microphone=(), konsol ve müşteri sayfası microphone=(self)", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "p28d");
    const s = await newSession(page);
    const pp = async (path: string) => (await page.request.get(path, { maxRedirects: 0 })).headers()["permissions-policy"] ?? "";
    for (const path of ["/r/ornek-firma", "/r"]) {
      const v = await pp(path);
      expect(v, path).toContain("microphone=()");
      expect(v).toContain("camera=()");
    }
    for (const path of [`/sessions/${s.id}/console`, new URL(s.link).pathname]) expect(await pp(path), path).toContain("microphone=(self)");
  });

  test("AC-376 @perf: müşteri → konsol ağızdan kulağa gecikme p95 < 325 ms (osilatör darbesi + analizör)", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { g } = await live(page, context, browser);
    // Misafir mikrofonu: 1 kHz osilatör, saniyede 1 darbe (100 ms); darbe başlangıcı performance.timeOrigin + now
    await g.evaluate(() => {
      const w = window as unknown as W & { __sent: number[] };
      w.__sent = [];
      navigator.mediaDevices.getUserMedia = async () => {
        w.__gum++;
        const ctx = new AudioContext();
        await ctx.resume();
        const osc = ctx.createOscillator();
        osc.frequency.value = 1000;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const dst = ctx.createMediaStreamDestination();
        osc.connect(gain).connect(dst);
        osc.start();
        let n = 0;
        const id = setInterval(() => {
          if (++n > 22) return clearInterval(id);
          gain.gain.setValueAtTime(1, ctx.currentTime);
          w.__sent.push(performance.timeOrigin + performance.now());
          setTimeout(() => gain.gain.setValueAtTime(0, ctx.currentTime), 100);
        }, 1000);
        const tr = dst.stream.getAudioTracks()[0]!;
        w.__mics.push(tr);
        return dst.stream;
      };
    });
    await accept(page, g);
    // Konsol: uzak iz (`voice-audio`) → AnalyserNode; eşik aşımının yükselen kenarı
    const recv = await page.evaluate(async () => {
      const el = document.querySelector<HTMLAudioElement>('[data-testid="voice-audio"]')!;
      const t0 = Date.now();
      while (!(el.srcObject instanceof MediaStream) && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 50));
      const ctx = new AudioContext();
      await ctx.resume();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(el.srcObject as MediaStream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const out: number[] = [];
      let quietSince = performance.now();
      return new Promise<number[]>((res) => {
        const id = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          const now = performance.now();
          if (peak > 0.05) {
            if (now - quietSince > 300) out.push(performance.timeOrigin + now);
            quietSince = Infinity;
          } else if (quietSince === Infinity) quietSince = now;
          if (out.length >= 20) {
            clearInterval(id);
            res(out);
          }
        }, 2);
        setTimeout(() => (clearInterval(id), res(out)), 35_000);
      });
    });
    const sent = await g.evaluate(() => (window as unknown as { __sent: number[] }).__sent);
    const lat = recv
      .map((r) => {
        const s = sent.filter((x) => x <= r).at(-1);
        return s === undefined ? null : r - s;
      })
      .filter((x): x is number => x !== null && x < 1000)
      .sort((a, b) => a - b);
    expect(lat.length, "en az 15 darbe eşleşmeli").toBeGreaterThanOrEqual(15);
    const p95 = lat[Math.ceil(lat.length * 0.95) - 1]!;
    test
      .info()
      .annotations.push({ type: "AC-376 p95", description: `${Math.round(p95)} ms (n=${lat.length}, min ${Math.round(lat[0]!)})` });
    expect(p95).toBeLessThan(325);
    await g.context().close();
  });
});

/** Asgari EBML: Segment → Tracks → TrackEntry → TrackType (1 video, 2 ses). Yalnız ilk Cluster'dan önceki baytlar. */
function trackTypes(buf: Buffer): number[] {
  const vint = (i: number, keep: boolean) => {
    const b = buf[i]!;
    let len = 1;
    while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
    let v = keep ? b : b & (0xff >> len);
    for (let k = 1; k < len; k++) v = v * 256 + buf[i + k]!;
    const unknown = !keep && v === 2 ** (7 * len) - 1;
    return { v: unknown ? Infinity : v, len };
  };
  const out: number[] = [];
  const CONTAINERS = new Set([0x18538067, 0x1654ae6b, 0xae]); // Segment, Tracks, TrackEntry
  const walk = (start: number, end: number) => {
    let i = start;
    while (i < end && i < buf.length) {
      const id = vint(i, true);
      const size = vint(i + id.len, false);
      const body = i + id.len + size.len;
      if (id.v === 0x1f43b675) return; // Cluster: medya başladı
      if (CONTAINERS.has(id.v)) walk(body, Math.min(end, body + size.v));
      else if (id.v === 0x83) out.push(buf[body]!);
      if (!Number.isFinite(size.v)) return;
      i = body + size.v;
    }
  };
  walk(0, buf.length);
  return out;
}
