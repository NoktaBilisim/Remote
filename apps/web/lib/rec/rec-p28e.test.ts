// P28e K7 (mimari-p28e r2 §5, §7, §9; S-P28e-2/3/8/11/12; K-P28e-16/17) — saf web mantığı.
import { REC_CONSENT_LINE_SHA256, REC_TITLE_PREFIX, REC_UPLOAD_QUEUE_PARTS } from "@remote/contracts/ws-rec";
import { afterEach, describe, expect, it, vi } from "vitest";
import tr from "@/messages/tr.json";
import { actionLabel, actionOptionGroups, groupLabel } from "../audit/actions";
import { listApiPath, parseFilters } from "../history/query";
import { buildCsp } from "../../proxy";
import { recordingOffered, setRecConsent, takeRecConsent } from "./consent-choice";
import { gapsOf, segmentAt, segmentsOf } from "./player";
import { clampDuration, SeriesRecorder, type RecPart, type RecorderLike } from "./recorder";
import { buildRecordingBody, effectiveUnattended, isDirty } from "./settings";
import { canPlay, canRecord, techProtocols } from "./support";
import { classify, Uploader } from "./upload";
import { Controller, onMsg, type ConsoleRecView } from "./use-console-rec";
import { recTitle } from "./use-guest-rec";

/** Sahte MediaRecorder: `tick()` bir timeslice parçası üretir; requestData/stop gerçek sırayla olay verir. */
class FakeRec implements RecorderLike {
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  n = 0;
  start() {
    this.state = "recording";
  }
  tick(size = 10) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
  }
  requestData() {
    queueMicrotask(() => this.tick(3));
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.tick(2);
      this.onstop?.();
    });
  }
}

const stream = {} as MediaStream;
const flush = () => new Promise((r) => setTimeout(r, 0));

function rig(seriesParts = 4) {
  const recs: FakeRec[] = [];
  const parts: RecPart[] = [];
  let clock = 1_000;
  const r = new SeriesRecorder({
    create: () => {
      const f = new FakeRec();
      recs.push(f);
      return f;
    },
    now: () => clock,
    seriesParts,
    waitMs: 5,
    onPart: (p) => parts.push(p),
    onError: () => undefined,
  });
  return { r, recs, parts, adv: (ms: number) => (clock += ms) };
}

describe("SeriesRecorder (K-P28e-16/17)", () => {
  it("bölüm geçişi N. parçada: requestData + stop kuyruğu son parçaya birleşir, p ≤ N-1, yeni bölüm aynı görevde", async () => {
    const { r, recs, parts, adv } = rig(4);
    r.start(stream, 7);
    for (let i = 0; i < 4; i++) {
      adv(5000);
      recs[0]!.tick(10);
    }
    await flush();
    await new Promise((res) => setTimeout(res, 20));
    expect(recs).toHaveLength(2); // yeni kaydedici açıldı
    const s7 = parts.filter((p) => p.series === 7);
    expect(s7.map((p) => p.part)).toEqual([0, 1, 2, 3]);
    expect(s7[3]!.blob.size).toBe(10 + 3 + 2); // 60. parça + requestData + stop kuyruğu
    expect(s7[0]!.seriesStartMs).toBe(1_000);
    expect(s7[1]!.seriesStartMs).toBeUndefined();
    expect(r.series).toBe(8);
  });

  it("now kapanışı beklemez; kuyruk blobu sonraki parça olur; boş parça atlanır", async () => {
    const { r, recs, parts, adv } = rig(60);
    r.start(stream, 0);
    adv(5000);
    recs[0]!.tick(0);
    adv(5000);
    recs[0]!.tick(9);
    const spy = vi.spyOn(recs[0]!, "requestData");
    await r.close("now");
    expect(spy).not.toHaveBeenCalled();
    expect(parts.map((p) => [p.part, p.blob.size])).toEqual([
      [0, 9],
      [1, 2],
    ]);
    expect(parts[0]!.durationMs).toBe(10_000);
    expect(r.series).toBeNull();
  });

  it("flush kapanışı requestData çağırır; süre 1..15000'e kıstırılır", async () => {
    const { r, recs, parts } = rig(60);
    r.start(stream, 0);
    const spy = vi.spyOn(recs[0]!, "requestData");
    await r.close("flush");
    expect(spy).toHaveBeenCalledOnce();
    expect(parts).toHaveLength(1);
    expect(parts[0]!.blob.size).toBe(5);
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(99_999)).toBe(15_000);
  });
});

const part = (series: number, p: number, size = 10): RecPart => ({
  series,
  part: p,
  blob: new Blob([new Uint8Array(size)]),
  durationMs: 5000,
});
const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

describe("Uploader (§5, §7)", () => {
  it("Bearer + başlıklar, çerez yok, p=0'da bölüm başlangıcı; FIFO tek uçuş", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let open = 0;
    let max = 0;
    const f = vi.fn(async (url: string, init: RequestInit) => {
      open++;
      max = Math.max(max, open);
      calls.push({ url, init });
      await flush();
      open--;
      return res(200, { next: 1 });
    });
    const u = new Uploader({ fetch: f as unknown as typeof fetch, onBroken: vi.fn(), onFatal: vi.fn() });
    u.setTarget({ rid: "01JD0000000000000000000001", token: "a".repeat(43) });
    u.enqueue({ ...part(2, 0), seriesStartMs: 1234.7 });
    u.enqueue(part(2, 1));
    await vi.waitFor(() => expect(u.sent).toBe(2));
    expect(max).toBe(1);
    expect(calls[0]!.url).toBe("/api/v1/rec/01JD0000000000000000000001/series/2/parts/0");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${"a".repeat(43)}`);
    expect(h["Content-Type"]).toBe("video/webm");
    expect(h["X-Rec-Series-Start-Ms"]).toBe("1234");
    expect(calls[0]!.init.credentials).toBe("omit");
    expect((calls[1]!.init.headers as Record<string, string>)["X-Rec-Series-Start-Ms"]).toBeUndefined();
    expect(calls[0]!.url).not.toContain("a".repeat(43));
  });

  it("kuyruk taşarsa en eski atılır → bölüm kırılır (yeni bölüm istenir), rec.error gönderilmez", () => {
    const onBroken = vi.fn();
    const u = new Uploader({ fetch: vi.fn(() => new Promise<Response>(() => undefined)), onBroken, onFatal: vi.fn() });
    u.setTarget({ rid: "01JD0000000000000000000001", token: "a".repeat(43) });
    for (let p = 0; p < REC_UPLOAD_QUEUE_PARTS + 2; p++) u.enqueue(part(0, p));
    expect(onBroken).toHaveBeenCalledWith(0);
    expect(u.dropped).toBeGreaterThan(0);
    u.enqueue(part(0, 9)); // kırık bölümün sonraki parçaları kuyruğa girmez
    expect(u.pending).toBeLessThanOrEqual(1);
  });

  it("yanıt sınıfları: 409{next>p} atla, 409{next<p} kır, quota/400/404 ölümcül, 429 Retry-After", async () => {
    const fatal = vi.fn();
    expect((await classify(res(409, { next: 5 }), part(0, 3), fatal)).kind).toBe("skip");
    expect((await classify(res(409, { next: 1 }), part(0, 3), fatal)).kind).toBe("broken");
    expect((await classify(res(409, { error: { code: "CONFLICT" } }), part(0, 0), fatal)).kind).toBe("broken");
    expect((await classify(res(409, { error: { code: "STORAGE_QUOTA" } }), part(0, 0), fatal)).kind).toBe("fatal");
    expect(fatal).toHaveBeenLastCalledWith("quota");
    await classify(res(400, {}), part(0, 0), fatal);
    expect(fatal).toHaveBeenLastCalledWith("invalid");
    await classify(res(404, {}), part(0, 0), fatal);
    expect(fatal).toHaveBeenLastCalledWith("gone");
    expect(await classify(res(429, {}, { "Retry-After": "3" }), part(0, 0), fatal)).toEqual({ kind: "retry", wait: 3000 });
    expect((await classify(res(503, {}), part(0, 0), fatal)).kind).toBe("retry");
  });

  it("ağ hatasında 1/2/4 sn yeniden dener, sonra bölümü kırar", async () => {
    const sleeps: number[] = [];
    const onBroken = vi.fn();
    const u = new Uploader({
      fetch: vi.fn(() => Promise.reject(new Error("ağ"))),
      sleep: async (ms) => void sleeps.push(ms),
      onBroken,
      onFatal: vi.fn(),
    });
    u.setTarget({ rid: "01JD0000000000000000000001", token: "a".repeat(43) });
    u.enqueue(part(1, 0));
    await vi.waitFor(() => expect(onBroken).toHaveBeenCalledWith(1));
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });
});

describe("oynatıcı yardımcıları (§7)", () => {
  const series = [
    {
      s: 0,
      offsetMs: 0,
      parts: [
        { p: 0, offsetMs: 0, durationMs: 5000 },
        { p: 1, offsetMs: 5000, durationMs: 5000 },
      ],
    },
    { s: 1, offsetMs: 30_000, parts: [{ p: 0, offsetMs: 30_000, durationMs: 5000 }] },
    { s: 2, offsetMs: 40_000, parts: [] },
  ];
  it("bölüm aralıkları, boşluk listesi, seek hedefi (boşlukta sonraki bölüm)", () => {
    const segs = segmentsOf(series);
    expect(segs).toEqual([
      { s: 0, start: 0, end: 10 },
      { s: 1, start: 30, end: 35 },
    ]);
    expect(gapsOf(segs, 40)).toEqual([
      { start: 10, end: 30 },
      { start: 35, end: 40 },
    ]);
    expect(segmentAt(segs, 3)).toBe(0);
    expect(segmentAt(segs, 15)).toBe(1);
    expect(segmentAt(segs, 36)).toBe(-1);
  });
});

describe("ayar gövdesi (AC-380, 447)", () => {
  const saved = { enabled: false, retentionDays: 30, unattendedEnabled: false };
  const d = { enabled: true, days: "30", unattended: false, consent: false, notice: false };
  it("açarken aydınlatma onayı zorunlu; true yalnız geçişte gider, false asla", () => {
    expect(buildRecordingBody(d, saved, 90).errors.consentUpdated).toBeTruthy();
    expect(buildRecordingBody({ ...d, consent: true }, saved, 90).body).toEqual({
      enabled: true,
      retentionDays: 30,
      unattendedEnabled: false,
      consentUpdated: true,
    });
    const on = { ...saved, enabled: true };
    expect(buildRecordingBody({ ...d, days: "10" }, on, 90).body).toEqual({ enabled: true, retentionDays: 10, unattendedEnabled: false });
  });
  it("gözetimsiz: kutu zorunlu; ana anahtar kapanınca kapanır; saklama sınırları", () => {
    const on = { ...saved, enabled: true };
    expect(buildRecordingBody({ ...d, unattended: true }, on, 90).errors.employeeNoticeAck).toBeTruthy();
    expect(buildRecordingBody({ ...d, unattended: true, notice: true }, on, 90).body?.employeeNoticeAck).toBe(true);
    expect(effectiveUnattended({ enabled: false, unattended: true })).toBe(false);
    expect(buildRecordingBody({ ...d, enabled: false, unattended: true }, { ...on, unattendedEnabled: true }, 90).body).toEqual({
      enabled: false,
      retentionDays: 30,
      unattendedEnabled: false,
    });
    expect(buildRecordingBody({ ...d, days: "0", consent: true }, saved, 90).errors.retentionDays).toBeTruthy();
    expect(buildRecordingBody({ ...d, days: "60", consent: true }, saved, 45).errors.retentionDays).toMatch(/aşamaz/);
    expect(buildRecordingBody({ ...d, days: "x", consent: true }, saved, 90).errors.retentionDays).toBe("Gün sayısı girin");
    expect(isDirty({ ...d, enabled: false }, saved)).toBe(false);
  });
});

describe("misafir rızası, başlık, yetenek, CSP, audit, süzgeç", () => {
  it("kutu yalnız offered + güncel SHA; seçim bir kez tüketilir", () => {
    expect(recordingOffered({ recording: { offered: true, line: "x", lineSha256: REC_CONSENT_LINE_SHA256 } })).toBe(true);
    expect(recordingOffered({ recording: { offered: true, line: "x", lineSha256: "0".repeat(64) } })).toBe(false);
    expect(recordingOffered({ recording: { offered: false, line: "x", lineSha256: REC_CONSENT_LINE_SHA256 } })).toBe(false);
    expect(recordingOffered({})).toBe(false);
    setRecConsent(true);
    expect(takeRecConsent()).toBe(true);
    expect(takeRecConsent()).toBe(false);
  });
  it("sekme başlığı öneki idempotent (S-P28e-12)", () => {
    expect(recTitle("Destek", true)).toBe(`${REC_TITLE_PREFIX}Destek`);
    expect(recTitle(recTitle("Destek", true), true)).toBe(`${REC_TITLE_PREFIX}Destek`);
    expect(recTitle(`${REC_TITLE_PREFIX}Destek`, false)).toBe("Destek");
  });
  it("rs.cap.rec1 yalnız VP8 kaydedebilen konsolda; destek algısı güvenli", () => {
    expect(techProtocols("rs.v1", true)).toEqual(["rs.v1", "rs.cap.rec1"]);
    expect(techProtocols("rs.v1", false)).toBeUndefined();
    expect(canRecord(undefined)).toBe(false);
    expect(canRecord({ isTypeSupported: (t) => t === "video/webm;codecs=vp8" })).toBe(true);
    expect(canPlay({ isTypeSupported: () => false })).toBe(false);
  });
  it("CSP dizesi sabit: blob: yalnız img-src ve media-src'de (S-P28e-11)", () => {
    const csp = buildCsp("N", "h.example", false, true);
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'nonce-N'; img-src 'self' data: blob:; " +
        "media-src 'self' blob:; connect-src 'self' wss://h.example; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; " +
        "base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
    );
    for (const d of csp.split("; ").filter((x) => /^(default|script|worker)-src/.test(x))) expect(d).not.toContain("blob:");
  });
  it("audit: Kayıt grubu + etiketler", () => {
    expect(groupLabel("recording")).toBe("Kayıt");
    expect(actionLabel("recording.view")).toBe("Oturum kaydı izlendi");
    expect(actionLabel("settings.recording")).toBe("Oturum kaydı ayarı değişti");
    expect(actionOptionGroups().some((g) => g.label === "Kayıt" && g.options[0]!.value === "recording.*")).toBe(true);
  });
  it("geçmiş 'Kayıtlı' süzgeci URL ↔ API", () => {
    const { filters, ignored } = parseFilters({ recorded: "true" });
    expect(filters.recorded).toBe("true");
    expect(listApiPath(filters)).toContain("recorded=true");
    expect(parseFilters({ recorded: "1" }).ignored).toEqual(["recorded"]);
    expect(ignored).toEqual([]);
  });
});

/** Konsol denetçisi: sahte kaydedici + sahte `fetch` + sahte saat (AC-382 ≤ 2 sn, AC-384 kota). */
function consoleRig(put: () => Response) {
  vi.useFakeTimers();
  const recs: FakeRec[] = [];
  const puts: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      puts.push(Date.now());
      return put();
    }),
  );
  const c = new Controller(vi.fn(), () => {
    const f = new FakeRec();
    recs.push(f);
    return f;
  });
  let view: ConsoleRecView = { on: false, basis: null, reason: null, unsupported: false, deviceOutdated: false };
  const msg = (m: Parameters<typeof onMsg>[0]) => onMsg(m, c, (f) => (view = f(view)), true);
  c.setStream({ getVideoTracks: () => [{ muted: false }] } as unknown as MediaStream);
  msg({
    t: "rec.state",
    on: true,
    rid: "01JD0000000000000000000001",
    basis: "consent",
    upload: { token: "a".repeat(43), series: 0, nextPart: 0 },
  });
  return { c, recs, puts, msg, view: () => view };
}

describe("konsol kaydedici durdurma (AC-382, AC-384)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("AC-382: rec.state{off, revoked} → kaydedici 2000 ms sınırı içinde (aynı görevde) durur; sonra yeni parça/yükleme yok", async () => {
    const { recs, puts, msg, view } = consoleRig(() => res(200, { next: 1 }));
    expect(recs).toHaveLength(1);
    expect(recs[0]!.state).toBe("recording");
    await vi.advanceTimersByTimeAsync(5000);
    recs[0]!.tick(10); // 1. parça (5 sn timeslice)
    await vi.advanceTimersByTimeAsync(10);
    expect(puts).toHaveLength(1);

    const t0 = Date.now();
    msg({ t: "rec.state", on: false, reason: "revoked" });
    expect(recs[0]!.state).toBe("inactive"); // stop() eşzamanlı çağrıldı
    const stoppedMs = Date.now() - t0;
    expect(stoppedMs).toBeLessThanOrEqual(2000);
    expect(view()).toMatchObject({ on: false, reason: "revoked" });

    await vi.advanceTimersByTimeAsync(2000);
    const afterStop = puts.length; // yalnız `now` kapanışının kuyruk parçası
    expect(afterStop).toBeLessThanOrEqual(2);
    expect(puts.every((at) => at - t0 <= 2000)).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(recs).toHaveLength(1); // yeniden başlamaz
    expect(puts).toHaveLength(afterStop);
  });

  it("AC-384: parça PUT 409 STORAGE_QUOTA → kaydedici durur, yeniden başlamaz; rec.state{off, quota} uyarı nedenini taşır", async () => {
    const { c, recs, puts, msg, view } = consoleRig(() => res(409, { error: { code: "STORAGE_QUOTA", message: "Kota" } }));
    await vi.advanceTimersByTimeAsync(5000);
    recs[0]!.tick(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(puts.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]!.state).toBe("inactive");
    msg({ t: "rec.state", on: false, reason: "quota" });
    expect(view()).toMatchObject({ on: false, reason: "quota" });
    const n = puts.length;
    c.source(true); // misafir yeniden katılsa da kaydedici açılmaz
    await vi.advanceTimersByTimeAsync(15_000);
    expect(recs).toHaveLength(1);
    expect(puts).toHaveLength(n);
  });
});

describe("KVKK beyanı (D-P28e-K1-4)", () => {
  it("arayüz metinleri mutlak 'indirilemez' iddiası taşımaz; kayıt metinleri indirme ucu yok + izleme kaydı der", () => {
    for (const v of Object.values(tr)) expect(v).not.toMatch(/indirilemez/i);
    expect(tr["hr.noDownload"]).toBe("İndirme düğmesi ve ucu yoktur; her izleme kayıt altına alınır.");
    expect(tr["rset.subtitle"]).toContain("indirme düğmesi ve ucu yoktur, her izleme kayıt altına alınır");
  });
});
