import { describe, expect, it, vi } from "vitest";
import type { VoiceStateMessage } from "@remote/contracts/ws-voice";
import { VOICE_AUDIT } from "@remote/contracts/audit";
import { permissionsPolicyFor } from "@/proxy";
import { actionLabel, groupLabel } from "@/lib/audit/actions";
import { consoleVoiceReducer, consoleVoiceView, initialConsoleVoice, micLive, micWanted, shouldListen, type VoiceCtx } from "./console";
import { CONFIRM_MS, GuestVoice, type VoiceGraph } from "./guest";
import { mixPlan } from "./mix";
import { browserRecorder } from "../rec/recorder";

const CID = "AbCdEfGhIjKlMnOpQrSt_-";
const A = "AAAAAAAAAAA";
const B = "BBBBBBBBBBB";
const C = "Ccccccccc-_";
const st = (p: Partial<VoiceStateMessage>): VoiceStateMessage => ({ t: "voice.state", phase: "idle", talkers: [], listeners: [], ...p });
const ctx = (p: Partial<VoiceCtx> = {}): VoiceCtx => ({
  me: A,
  observer: false,
  canVoice: true,
  guestVoice: true,
  unattended: false,
  live: true,
  now: 1000,
  ...p,
});

describe("D-PD-1 permissionsPolicyFor", () => {
  it("/r ve alt yolları microphone=(); diğerleri (self); camera/geolocation sabit", () => {
    for (const p of ["/r", "/r/abc", "/r/abc/def"]) expect(permissionsPolicyFor(p)).toContain("microphone=()");
    for (const p of ["/login", "/sessions/01J/console", "/session/tok", "/requests", "/request-blocks", "/reset-password", "/"])
      expect(permissionsPolicyFor(p)).toContain("microphone=(self)");
    expect(permissionsPolicyFor("/login")).toBe("camera=(), microphone=(self), geolocation=(), display-capture=(self)");
    expect(permissionsPolicyFor("/r/x")).toBe("camera=(), microphone=(), geolocation=(), display-capture=(self)");
  });
});

describe("AC-379 audit etiketleri", () => {
  it("voice.* Türkçe etiket ve grup", () => {
    expect(actionLabel(VOICE_AUDIT.END)).toBe("Sesli görüşme bitti");
    expect(actionLabel(VOICE_AUDIT.JOIN)).toBe("Teknisyen sesli görüşmeye katıldı");
    expect(groupLabel("voice")).toBe("Sesli görüşme");
  });
});

describe("AC-373/374/379 konsol sesli görüşme durumu", () => {
  it("eski istemci (guestVoice=false) → pasif; gözetimsiz; izleyici; yetkisiz", () => {
    const s = initialConsoleVoice;
    expect(consoleVoiceView(s, ctx({ guestVoice: false })).kind).toBe("unsupported");
    expect(consoleVoiceView(s, ctx({ unattended: true, guestVoice: false })).kind).toBe("unattended");
    expect(consoleVoiceView(s, ctx({ observer: true })).kind).toBe("hidden");
    expect(consoleVoiceView(s, ctx({ canVoice: false })).kind).toBe("hidden");
    expect(consoleVoiceView(s, ctx({ me: null })).kind).toBe("hidden");
  });

  it("istek → pending (geri sayım) → active (konuşuyor) → bitiş toast'ı", () => {
    let s = consoleVoiceReducer(initialConsoleVoice, { type: "local", local: "sent" });
    expect(micWanted(s, A)).toBe(true);
    s = consoleVoiceReducer(s, { type: "state", m: st({ phase: "pending", callId: CID, by: A, listeners: [A] }), me: A, now: 1000 });
    expect(s.local).toBe("idle");
    expect(consoleVoiceView(s, ctx({ now: 16_000 }))).toEqual({ kind: "waiting", leftMs: 45_000 });
    expect(micLive(s, A)).toBe(false);
    s = consoleVoiceReducer(s, {
      type: "state",
      m: st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A] }),
      me: A,
      now: 2000,
    });
    expect(micLive(s, A)).toBe(true);
    expect(shouldListen(s, A)).toBe(true);
    expect(consoleVoiceView(s, ctx())).toEqual({ kind: "talking", muted: false });
    s = consoleVoiceReducer(s, { type: "state", m: st({ callId: CID, endReason: "tech" }), me: A, now: 194_000 });
    expect(s.ended).toMatchObject({ reason: "tech", wasPhase: "active", durationSec: 192 });
    expect(micWanted(s, A)).toBe(false);
  });

  it("D-PD-2 ret ve müşteri bitişi ayrı metin + 30 sn bekleme", () => {
    const p = consoleVoiceReducer(initialConsoleVoice, {
      type: "state",
      m: st({ phase: "pending", callId: CID, by: A, listeners: [A] }),
      me: A,
      now: 0,
    });
    const rej = consoleVoiceReducer(p, { type: "state", m: st({ callId: CID, endReason: "customer" }), me: A, now: 10 });
    expect(rej.notice).toEqual({ kind: "rejected", until: 30_010 });
    const v = consoleVoiceView(rej, ctx({ now: 20 }));
    expect(v).toMatchObject({ kind: "idle", blocked: true });
    expect(consoleVoiceView(rej, ctx({ now: 30_011 }))).toMatchObject({ kind: "idle", blocked: false, notice: null });
    const a = consoleVoiceReducer(p, {
      type: "state",
      m: st({ phase: "active", callId: CID, talkers: [A], listeners: [A] }),
      me: A,
      now: 5,
    });
    const end = consoleVoiceReducer(a, { type: "state", m: st({ callId: CID, endReason: "customer" }), me: A, now: 50 });
    expect(end.notice?.kind).toBe("customerEnded");
  });

  it("hata yalnız bekleyen istekte sese atfedilir; WS kopunca durum sıfırlanır", () => {
    expect(consoleVoiceReducer(initialConsoleVoice, { type: "error", code: "CONFLICT", now: 0 })).toBe(initialConsoleVoice);
    const s = consoleVoiceReducer(consoleVoiceReducer(initialConsoleVoice, { type: "local", local: "sent" }), {
      type: "error",
      code: "CLIENT_UNSUPPORTED",
      now: 0,
    });
    expect(s).toMatchObject({ local: "idle", notice: { kind: "unsupported" } });
    const a = consoleVoiceReducer(initialConsoleVoice, {
      type: "state",
      m: st({ phase: "active", callId: CID, talkers: [A], listeners: [A] }),
      me: A,
      now: 0,
    });
    expect(micWanted(consoleVoiceReducer(a, { type: "closed" }), A)).toBe(false);
  });

  it("AC-378 katılımcı katılabilir; izleyici yalnız dinler; yetkisiz dinleyemez", () => {
    const a = consoleVoiceReducer(initialConsoleVoice, {
      type: "state",
      m: st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A, B] }),
      me: B,
      now: 0,
    });
    expect(consoleVoiceView(a, ctx({ me: B })).kind).toBe("canJoin");
    expect(consoleVoiceView(a, ctx({ me: C, observer: true })).kind).toBe("listening");
    expect(consoleVoiceView(a, ctx({ me: C, canVoice: false })).kind).toBe("noPerm");
    expect(shouldListen(a, C)).toBe(false);
  });
});

describe("AC-378 / D-PD-3 mix-minus planı", () => {
  it("t'ye mikrofon + diğer talker'lar; kendi sesi yok; hoparlöre Σ talkers; yalnız listeners'a gönderim", () => {
    const p = mixPlan({ talkers: [A, B], listeners: [A, B, C], peers: [A, B, C] });
    expect(p.edges).toEqual(
      [`${A}>${B}`, `${A}>${C}`, `${A}>speaker`, `${B}>${A}`, `${B}>${C}`, `${B}>speaker`, `mic>${A}`, `mic>${B}`, `mic>${C}`].sort(),
    );
    expect(p.edges).not.toContain(`${A}>${A}`);
    const q = mixPlan({ talkers: [A], listeners: [A], peers: [A, C] });
    expect(q.send).toEqual({ [A]: true, [C]: false });
    expect(q.edges.some((e) => e.startsWith(`${C}>`) || e.endsWith(`>${C}`))).toBe(false);
  });
});

function fakeGuest() {
  const sent: unknown[] = [];
  const outs = new Map<string, unknown>();
  const links = new Set<string>();
  const remote = new Map([
    [A, { kind: "audio", id: "ra" } as unknown as MediaStreamTrack],
    [B, { kind: "audio", id: "rb" } as unknown as MediaStreamTrack],
  ]);
  const graph: VoiceGraph = {
    setMic: () => undefined,
    addSource: () => undefined,
    removeSource: () => undefined,
    output: (tid) => ({ id: `out-${tid}` }) as unknown as MediaStreamTrack,
    dropOutput: () => undefined,
    link: (e) => void links.add(e),
    unlink: (e) => void links.delete(e),
    close: () => links.clear(),
  };
  const mic = { enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
  const getMic = vi.fn(() => Promise.resolve(mic));
  const v = new GuestVoice({
    send: (m) => void sent.push(m),
    peers: { tids: () => [A, B], remoteAudio: (t) => remote.get(t) ?? null, setAudioOut: (t, tr) => void outs.set(t, tr) },
    getMic,
    createGraph: () => graph,
    onChange: () => undefined,
  });
  v.onRoster([
    { tid: A, name: "Ayşe", role: "controller", owner: true, connected: true },
    { tid: B, name: "Burak", role: "participant", owner: false, connected: true },
  ]);
  return { v, sent, outs, links, mic, getMic };
}

describe("AC-374 / K-PD-2 misafir rıza kuralı", () => {
  it("bayat/sahte voice.state{active} mikrofon açmaz, voice.end{customer} gider", () => {
    const f = fakeGuest();
    f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A] }));
    expect(f.getMic).not.toHaveBeenCalled();
    expect(f.sent).toEqual([{ t: "voice.end", callId: CID, reason: "customer" }]);
    expect(f.outs.get(A)).toBeNull();
  });

  it("voice.request mikrofon açmaz; Kabul et → answer + mikrofon; karışım yalnız listeners'a; WS kopunca bırakılır", async () => {
    const f = fakeGuest();
    f.v.onRequest({ callId: CID, by: A });
    expect(f.v.view().request?.name).toBe("Ayşe");
    expect(f.getMic).not.toHaveBeenCalled();
    f.v.accept();
    expect(f.sent).toEqual([{ t: "voice.answer", callId: CID, accept: true }]);
    await Promise.resolve();
    f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A] }));
    expect(f.outs.get(A)).toMatchObject({ id: `out-${A}` });
    expect(f.outs.get(B)).toBeNull();
    expect(f.links.has(`${A}>speaker`)).toBe(true);
    // B dinlemeye başladı → duyuru; B konuşmaya katıldı → A'nın sesi B'ye, B'nin sesi A'ya
    f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A, B] }));
    expect(f.v.view().announce?.tids).toEqual([B]);
    f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A, B], listeners: [A, B] }));
    expect(f.links.has(`${B}>${A}`) && f.links.has(`${A}>${B}`)).toBe(true);
    // B talkers'tan çıkınca kaynağı aynı tikte kopar
    f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A, B] }));
    expect([...f.links].some((e) => e.startsWith(`${B}>`))).toBe(false);
    f.v.onWsClose();
    expect(f.mic.stop).toHaveBeenCalled();
    expect(f.outs.get(A)).toBeNull();
    // Rıza silindi: aynı callId'nin bayat active'i mikrofonu açmaz
    f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A] }));
    expect(f.getMic).toHaveBeenCalledTimes(1);
  });

  it("mikrofon açılamazsa voice.end{device}", async () => {
    const f = fakeGuest();
    f.getMic.mockImplementationOnce(() => Promise.reject(new Error("NotAllowed")));
    f.v.onRequest({ callId: CID, by: A });
    f.v.accept();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.sent.at(-1)).toEqual({ t: "voice.end", callId: CID, reason: "device" });
    expect(f.v.view().note).toBe("device");
  });

  it("D-PD-K1-2: Kabul sonrası 5 sn içinde active gelmezse mikrofon bırakılır, bilgi notu; geç active rızasız yoldan biter", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeGuest();
      f.v.onRequest({ callId: CID, by: A });
      f.v.accept();
      await Promise.resolve();
      expect(f.v.view().mic).toBe("on");
      // Aynı görüşmenin pending yayını bekçiyi kapatmaz
      f.v.onState(st({ phase: "pending", callId: CID, by: A, listeners: [A] }));
      vi.advanceTimersByTime(CONFIRM_MS - 1);
      expect(f.mic.stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(f.mic.stop).toHaveBeenCalledTimes(1);
      expect(f.v.view()).toMatchObject({ mic: "off", active: null, note: "unconfirmed" });
      expect(f.outs.get(A)).toBeNull();
      expect(f.sent).toEqual([{ t: "voice.answer", callId: CID, accept: true }]);
      // Sunucu geç başlatırsa: rıza silindi → mikrofon açılmaz, voice.end{customer} (K-PD-2)
      f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A] }));
      expect(f.sent.at(-1)).toEqual({ t: "voice.end", callId: CID, reason: "customer" });
      expect(f.getMic).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("D-PD-K1-2: active zamanında gelirse bekçi kapanır; mikrofon 5 sn'yi aşınca açılırsa hemen durdurulur", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeGuest();
      f.v.onRequest({ callId: CID, by: A });
      f.v.accept();
      await Promise.resolve();
      f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A] }));
      vi.advanceTimersByTime(10_000);
      expect(f.mic.stop).not.toHaveBeenCalled();
      expect(f.v.view().active?.callId).toBe(CID);

      // Mikrofon izni 5 sn'den uzun sürer, sunucu onayı yok: geç gelen iz durdurulur
      const g = fakeGuest();
      let resolve: (t: MediaStreamTrack) => void = () => undefined;
      g.getMic.mockImplementationOnce(() => new Promise<MediaStreamTrack>((r) => (resolve = r)));
      g.v.onRequest({ callId: CID, by: A });
      g.v.accept();
      vi.advanceTimersByTime(CONFIRM_MS);
      expect(g.v.view().note).toBe("unconfirmed");
      resolve(g.mic);
      await Promise.resolve();
      expect(g.mic.stop).toHaveBeenCalledTimes(1);
      expect(g.v.view().mic).toBe("off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ses göndericisine iz bağlanamazsa (audioFailed) mikrofon hatasıyla aynı yol: voice.end{device} + bırakma", async () => {
    const f = fakeGuest();
    f.v.audioFailed(); // rıza yokken etkisiz
    expect(f.sent).toEqual([]);
    f.v.onRequest({ callId: CID, by: A });
    f.v.accept();
    await Promise.resolve();
    f.v.onState(st({ phase: "active", callId: CID, by: A, talkers: [A], listeners: [A] }));
    f.v.audioFailed();
    expect(f.sent.at(-1)).toEqual({ t: "voice.end", callId: CID, reason: "device" });
    expect(f.mic.stop).toHaveBeenCalledTimes(1);
    expect(f.outs.get(A)).toBeNull();
    expect(f.v.view()).toMatchObject({ mic: "off", active: null, note: "device" });
  });

  it("roster'da olmayan by yok sayılır; Reddet → answer false", () => {
    const f = fakeGuest();
    f.v.onRequest({ callId: CID, by: C });
    expect(f.v.view().request).toBeNull();
    f.v.onRequest({ callId: CID, by: A });
    f.v.reject();
    expect(f.sent).toEqual([{ t: "voice.answer", callId: CID, accept: false }]);
  });
});

describe("AC-375 browserRecorder: kayda yalnız video izi", () => {
  it("ses + video akışından kaydedici MediaStream'inde ses izi 0, video izi 1", () => {
    const video = { kind: "video", id: "v" };
    const audio = { kind: "audio", id: "a" };
    const made: { tracks: unknown[]; opts: unknown }[] = [];
    class FakeStream {
      constructor(readonly tracks: { kind: string }[]) {}
      getVideoTracks = () => this.tracks.filter((x) => x.kind === "video");
      getAudioTracks = () => this.tracks.filter((x) => x.kind === "audio");
      getTracks = () => this.tracks;
    }
    class FakeRecorder {
      constructor(stream: FakeStream, opts: unknown) {
        made.push({ tracks: stream.getTracks(), opts });
      }
    }
    vi.stubGlobal("MediaStream", FakeStream);
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    try {
      browserRecorder(new FakeStream([audio, video]) as unknown as MediaStream);
      expect(made).toHaveLength(1);
      expect(made[0]!.tracks).toEqual([video]);
      expect(made[0]!.tracks.filter((x) => (x as { kind: string }).kind === "audio")).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
