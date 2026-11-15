import { describe, expect, it, vi } from "vitest";
import { CLIP_MAX_BYTES, PRINT_MAX_BYTES } from "@remote/contracts/ws-clip-print";
import { clipDataSchema } from "@remote/contracts/dc-clip-print";
import { ClipAssembler, bytesToB64, newCpId, splitClip, utf8 } from "./chunks";
import { ClipJobs, readClipboard, writeClipboard, type ClipNotice } from "./clipboard";
import { featureState, type FeatureInput } from "./feature-state";
import { checkPdf } from "../print/pdf-check";
import { PrintJobs, consentLeftSec, type PrintState } from "../print/print-send";
import type { FileChannelLike } from "../dc/file-model";
import { TransferStore } from "../dc/file-model";

const base: FeatureInput = {
  feature: "clipboard",
  permitted: true,
  ready: true,
  guestPresent: true,
  guestKind: "AGENT",
  unattended: false,
  guestFeatures: ["clipboard", "print"],
  controlGranted: true,
  clipConsent: true,
  busy: false,
};

describe("featureState (AC-343, 348, 352; r2 Y-P28a-1)", () => {
  it("neden önceliği — ilk tutan döner", () => {
    expect(featureState({ ...base, permitted: false })).toEqual({ visible: false, enabled: false, reason: null });
    expect(featureState({ ...base, ready: false }).reason).toBe("loading");
    expect(featureState({ ...base, guestPresent: false, ready: false }).reason).toBe("noGuest");
    expect(featureState({ ...base, guestKind: "BROWSER" }).reason).toBe("browser");
    expect(featureState({ ...base, guestKind: "BROWSER", feature: "print" }).visible).toBe(false);
    expect(featureState({ ...base, unattended: true, guestFeatures: [] }).reason).toBe("unattended");
    expect(featureState({ ...base, guestFeatures: [], controlGranted: false }).reason).toBe("unsupported");
    expect(featureState({ ...base, controlGranted: false, clipConsent: false }).reason).toBe("noControl");
    expect(featureState({ ...base, feature: "print", controlGranted: false }).reason).toBe("noControl");
    expect(featureState({ ...base, clipConsent: false }).reason).toBe("noConsent");
    expect(featureState({ ...base, feature: "print", clipConsent: false }).enabled).toBe(true);
    expect(featureState({ ...base, feature: "print", cooldown: true, busy: true }).reason).toBe("cooldown");
    expect(featureState({ ...base, busy: true }).reason).toBe("busy");
    expect(featureState(base)).toEqual({ visible: true, enabled: true, reason: null });
  });
  it("kısmi: yalnız pano bildiren istemcide yazdırma desteklenmiyor", () => {
    expect(featureState({ ...base, guestFeatures: ["clipboard"], feature: "print" }).reason).toBe("unsupported");
    expect(featureState({ ...base, guestFeatures: ["clipboard"] }).enabled).toBe(true);
  });
});

const TEXTS = ["çğıöşüİ ÇĞIÖŞÜ", "emoji 😀👍🏽 son", "a\r\nb\nc\r\n", "x".repeat(8191) + "ğ" + "y".repeat(9000)];

describe("pano parçalama (AC-345, K-P28a-14)", () => {
  it.each(TEXTS)("gidiş-dönüş birebir %#", (text) => {
    const parts = splitClip(utf8(text))!;
    const asm = new ClipAssembler();
    let out: string | null = null;
    for (const p of parts) {
      expect(clipDataSchema.safeParse({ t: "clip.data", cid: "abcdefgh12", ...p }).success).toBe(true);
      const r = asm.push(p);
      if (r.kind === "done") out = r.text;
      else expect(r.kind).toBe("more");
    }
    expect(out).toBe(text);
  });
  it("64 KB sınırı bayt üzerinden (±1)", () => {
    expect(splitClip(new Uint8Array(CLIP_MAX_BYTES).fill(97))).toHaveLength(8);
    expect(splitClip(new Uint8Array(CLIP_MAX_BYTES + 1).fill(97))).toBeNull();
    expect(splitClip(new Uint8Array(0))).toBeNull();
  });
  it("alıcı: sıra dışı seq, geçersiz UTF-8 ve U+0000 → INVALID", () => {
    expect(new ClipAssembler().push({ seq: 1, last: true, b64: bytesToB64(utf8("a")) })).toEqual({ kind: "error", result: "INVALID" });
    expect(new ClipAssembler().push({ seq: 0, last: true, b64: bytesToB64(new Uint8Array([0xff, 0xfe])) })).toEqual({
      kind: "error",
      result: "INVALID",
    });
    expect(new ClipAssembler().push({ seq: 0, last: true, b64: bytesToB64(utf8("a\u0000b")) })).toEqual({
      kind: "error",
      result: "INVALID",
    });
  });
  it("kimlik 22 karakter base64url", () => expect(newCpId()).toMatch(/^[A-Za-z0-9_-]{22}$/));
});

describe("Clipboard API ret dalları (R-P28a-3)", () => {
  it("okuma", async () => {
    expect(await readClipboard(undefined)).toEqual({ kind: "unsupported" });
    const deny = { readText: () => Promise.reject(new Error("x")), writeText: () => Promise.resolve() };
    expect(await readClipboard(deny)).toEqual({ kind: "denied" });
    expect(await readClipboard({ ...deny, readText: () => Promise.resolve("") })).toEqual({ kind: "empty" });
    expect(await readClipboard({ ...deny, readText: () => Promise.resolve("ç".repeat(CLIP_MAX_BYTES / 2 + 1)) })).toEqual({
      kind: "tooLarge",
    });
  });
  it("yazma", async () => {
    expect(await writeClipboard({ readText: async () => "", writeText: () => Promise.reject(new Error("x")) }, "a")).toBe("denied");
  });
});

function clipRig(text = "merhaba ç") {
  const ws: { t: string; cid: string; bytes?: number }[] = [];
  const ctl: { t: string; cid: string }[] = [];
  const notes: ClipNotice[] = [];
  let written: string | null = null;
  const jobs = new ClipJobs({
    sendWs: (m) => ws.push(m),
    sendCtl: (m) => (ctl.push(m), true),
    newId: () => "cid-0000001",
    clipboard: () => ({ readText: async () => text, writeText: async (s) => void (written = s) }),
    onChange: () => undefined,
    notify: (n) => notes.push(n),
  });
  return { jobs, ws, ctl, notes, written: () => written };
}

describe("ClipJobs akışı (AC-346; D-P28a-4)", () => {
  it("gönder: clip.push → yalnız clip.ready sonrası clip.data → status OK", async () => {
    const r = clipRig();
    await r.jobs.push();
    expect(r.ws).toEqual([{ t: "clip.push", cid: "cid-0000001", bytes: utf8("merhaba ç").length }]);
    expect(r.ctl).toHaveLength(0);
    r.jobs.onCtl({ t: "clip.ready", cid: "baska-cid-1" });
    expect(r.ctl).toHaveLength(0);
    r.jobs.onCtl({ t: "clip.ready", cid: "cid-0000001" });
    expect(r.ctl).toHaveLength(1);
    r.jobs.onStatus({ cid: "cid-0000001", result: "OK" });
    expect(r.notes).toEqual([{ kind: "result", dir: "TO_CUSTOMER", result: "OK" }]);
    expect(r.jobs.busy).toBe(false);
  });
  it("al: gelen veri panoya yazılır; SENSITIVE sonucu bildirilir", async () => {
    const r = clipRig();
    r.jobs.pull();
    for (const p of splitClip(utf8("gizli değil"))!) r.jobs.onCtl({ t: "clip.data", cid: "cid-0000001", ...p });
    await vi.waitFor(() => expect(r.written()).toBe("gizli değil"));
    await vi.waitFor(() => expect(r.notes).toEqual([{ kind: "result", dir: "TO_TECH", result: "OK" }]));
    r.jobs.pull();
    r.jobs.onStatus({ cid: "cid-0000001", result: "SENSITIVE" });
    expect(r.notes[1]).toEqual({ kind: "result", dir: "TO_TECH", result: "SENSITIVE" });
  });
  it("sunucu hatası yalnız son istekle eşlenir; push cid'iyle gelen clip.data reddedilir", async () => {
    const r = clipRig();
    await r.jobs.push();
    r.jobs.onCtl({ t: "clip.data", cid: "cid-0000001", seq: 0, last: true, b64: bytesToB64(utf8("x")) });
    expect(r.written()).toBeNull();
    expect(r.jobs.onError("Kontrol izni yok")).toBe(true);
    expect(r.notes.at(-1)).toEqual({ kind: "server", message: "Kontrol izni yok" });
    expect(r.jobs.onError("x")).toBe(false);
  });
});

describe("PDF denetimi (AC-348)", () => {
  const pdf = (n: number) => new Blob([new TextEncoder().encode("%PDF-"), new Uint8Array(Math.max(0, n - 5))]);
  it("önek ve 20 MiB sınırı ±1 bayt", async () => {
    expect(await checkPdf(pdf(PRINT_MAX_BYTES))).toBe("ok");
    expect(await checkPdf(pdf(PRINT_MAX_BYTES + 1))).toBe("tooLarge");
    expect(await checkPdf(new Blob(["%PDF"]))).toBe("notPdf");
    expect(await checkPdf(new Blob(["<html>%PDF-"]))).toBe("notPdf");
  });
});

function printRig() {
  const ws: { t: string }[] = [];
  const ctl: { t: string; idx?: number }[] = [];
  const sent: Uint8Array[] = [];
  let state: PrintState = { job: null, fieldError: null, cooldownUntil: 0 };
  let now = 1_000;
  const file: FileChannelLike = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (d) => void sent.push(d),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const store = new TransferStore({
    inbound: "TO_TECH",
    sendCtl: () => undefined,
    file,
    sendMeta: () => undefined,
    onChange: () => undefined,
    allowed: () => true,
  });
  store.nextIdx(); // önceki bir dosya teklifi idx 0'ı aldı
  const jobs = new PrintJobs({
    sendWs: (m) => ws.push(m),
    sendCtl: (m) => (ctl.push(m), true),
    file: () => file,
    nextIdx: () => store.nextIdx(),
    fileBusy: () => false,
    sha256: async () => "a".repeat(64),
    newId: () => "pid-0000001",
    onChange: (s) => (state = s),
    now: () => now,
  });
  return { jobs, ws, ctl, sent, state: () => state, tick: (ms: number) => (now += ms) };
}
const pdfFile = () => new File([new TextEncoder().encode("%PDF-1.7 test")], "gizli-ad-1.pdf");

describe("PrintJobs (AC-348..350; O-P28a-2, Y-P28a-1)", () => {
  it("istek → ready → tek offer (ortak idx) + parçalar + done → bekleme → PRINTED", async () => {
    const r = printRig();
    await r.jobs.start(pdfFile());
    expect(r.ws).toEqual([{ t: "print.request", pid: "pid-0000001", sizeBytes: 13 }]);
    expect(JSON.stringify(r.ws)).not.toContain("gizli-ad");
    await r.jobs.onReady("pid-0000001");
    await r.jobs.onReady("pid-0000001");
    expect(r.ctl.map((m) => m.t)).toEqual(["print.offer", "print.done"]);
    expect(r.ctl[0]!.idx).toBe(1);
    expect(r.sent).toHaveLength(1);
    expect(r.state().job?.phase).toBe("waiting");
    expect(consentLeftSec(r.state().job, 1_000 + 59_500)).toBe(1);
    r.jobs.onStatus({ pid: "pid-0000001", result: "PRINTED", pages: 3 });
    expect(r.state().job).toMatchObject({ phase: "done", outcome: "PRINTED", pages: 3 });
  });
  it("Vazgeç → print.cancel; TIMEOUT → 30 sn bekleme", async () => {
    const r = printRig();
    await r.jobs.start(pdfFile());
    r.jobs.cancel();
    expect(r.ws.at(-1)).toEqual({ t: "print.cancel", pid: "pid-0000001" });
    expect(r.state().job?.outcome).toBe("CANCELLED");
    const r2 = printRig();
    await r2.jobs.start(pdfFile());
    r2.jobs.onStatus({ pid: "pid-0000001", result: "TIMEOUT" });
    expect(r2.state().cooldownUntil).toBe(1_000 + 30_000);
  });
  it("kontrol VIEW'a dönünce iptal; geç gelen durum yok sayılır", async () => {
    const r = printRig();
    await r.jobs.start(pdfFile());
    r.jobs.controlClosed();
    r.jobs.onStatus({ pid: "pid-0000001", result: "CANCELLED" });
    expect(r.state().job?.outcome).toBe("VIEW");
  });
  it("sunucu CANCELLED'ı VIEW'dan önce gelirse metin yine kontrol kapanışı", async () => {
    const r = printRig();
    await r.jobs.start(pdfFile());
    r.jobs.onStatus({ pid: "pid-0000001", result: "CANCELLED" });
    r.jobs.controlClosed();
    expect(r.state().job?.outcome).toBe("VIEW");
    const r2 = printRig();
    await r2.jobs.start(pdfFile());
    r2.jobs.cancel();
    r2.jobs.controlClosed();
    expect(r2.state().job?.outcome).toBe("CANCELLED");
  });
  it("PDF olmayan dosya gönderilmez", async () => {
    const r = printRig();
    await r.jobs.start(new File(["merhaba"], "a.pdf"));
    expect(r.state().fieldError).toBe("notPdf");
    expect(r.ws).toHaveLength(0);
  });
});
