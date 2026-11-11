import { describe, expect, it } from "vitest";
import type { ServerOutbound } from "@remote/contracts/ws";
import { canCancel, canRelease, canRequest, canRequestMonitor, controlReducer, cooldownLeft, initialControl, isCapturing, isUnexpectedGrant, MONITOR_BLOCK_MS, monitorBlockLeft, MONITOR_TIMEOUT_MS, requestsLeft, type ControlEvent, type ControlState } from "./machine";

const msg = (m: ServerOutbound, now = 1000): ControlEvent => ({ type: "msg", m, now });
const run = (evs: ControlEvent[], s: ControlState = initialControl) => evs.reduce(controlReducer, s);
const req = (now = 1000): ControlEvent => ({ type: "request", now });
const granted = msg({ t: "control.state", state: "GRANTED", source: "UI" });
const denied = (now = 1000) => msg({ t: "control.state", state: "VIEW", source: "DENIED" }, now);
const monitors = [
  { id: 0, name: "Ekran 1", w: 1920, h: 1080, primary: true },
  { id: 1, name: "", w: 1280, h: 1024, primary: false },
];

describe("P7 kontrol makinesi", () => {
  it("AC-47: istek → bekleniyor; onay gelmeden yakalama yok", () => {
    const s = run([req()]);
    expect(s.phase).toBe("requested");
    expect(isCapturing(s)).toBe(false);
    expect(canRequest(s, 1000)).toBe(false);
  });

  it("S7-1/K1: bırak → yakalama biter, kontrol kapanır; devam yeni istektir (hak düşer)", () => {
    let s = run([req(), granted]);
    expect(s.phase).toBe("granted");
    expect(isCapturing(s)).toBe(true);
    expect(canRelease(s)).toBe(true);
    s = controlReducer(s, { type: "release", now: 2000 });
    expect(isCapturing(s)).toBe(false);
    expect(s.phase).toBe("ended");
    expect(s.endedBy).toBe("tech");
    // Sunucu onayı {VIEW, TECH} sessiz geçer, durum değişmez
    expect(controlReducer(s, msg({ t: "control.state", state: "VIEW", source: "TECH" }, 2100))).toEqual(s);
    // Devam = yeni istek (müşteri yeniden onaylar)
    expect(canRequest(s, 2000)).toBe(true);
    s = controlReducer(s, req(3000));
    expect(s.phase).toBe("requested");
    expect(s.requests).toBe(2);
    expect(requestsLeft(s)).toBe(3);
    expect(isCapturing(controlReducer(s, granted))).toBe(true);
    // Bırakma yalnız izindeyken anlamlı
    expect(controlReducer(initialControl, { type: "release", now: 1 })).toBe(initialControl);
  });

  it("K2: Vazgeç → istek geri çekilir, yakalama yok; hak iade edilmez, bekleme başlamaz", () => {
    const r = run([req()]);
    expect(canCancel(r)).toBe(true);
    const s = controlReducer(r, { type: "cancel", now: 1500 });
    expect(s.phase).toBe("ended");
    expect(s.endedBy).toBe("cancel");
    expect(s.requests).toBe(1);
    expect(cooldownLeft(s, 1500)).toBe(0);
    expect(canRequest(s, 1500)).toBe(true);
    expect(controlReducer(s, msg({ t: "control.state", state: "VIEW", source: "TECH" }))).toEqual(s);
    expect(controlReducer(run([req(), granted]), { type: "cancel", now: 1 }).phase).toBe("granted"); // izindeyken bırak kullanılır
  });

  it("S7-2/K2: beklenmeyen GRANTED yakalama başlatmaz ve bırakma gerektirir", () => {
    const stray = { t: "control.state", state: "GRANTED", source: "UI" } as const;
    const cases: ControlState[] = [
      initialControl,
      run([req(), { type: "cancel", now: 1100 }]),
      run([req(), granted, { type: "release", now: 1200 }]),
      run([req(), denied(1300)]),
      run([req(), granted, msg({ t: "control.state", state: "VIEW", source: "HOTKEY" })]),
      run([req(), granted, msg({ t: "control.revoke", reason: "permission" })]),
    ];
    for (const s of cases) {
      expect(isUnexpectedGrant(s, stray)).toBe(true);
      const after = controlReducer(s, msg(stray, 5000));
      expect(after).toBe(s);
      expect(isCapturing(after)).toBe(false);
    }
    // Bekleyen istekte beklenen; açık kontrolde tekrar GRANTED yalnız yok sayılır (açık kontrolü bozmaz)
    expect(isUnexpectedGrant(run([req()]), stray)).toBe(false);
    const on = run([req(), granted]);
    expect(isUnexpectedGrant(on, stray)).toBe(false);
    expect(controlReducer(on, msg(stray))).toBe(on);
    expect(isUnexpectedGrant(run([req()]), { t: "control.state", state: "VIEW", source: "UI" })).toBe(false);
  });

  it("AC-116: ret sonrası 30 sn bekleme, geri sayım ve sonra yeniden istek", () => {
    const s = run([req(), denied(5000)]);
    expect(s.phase).toBe("denied");
    expect(cooldownLeft(s, 5000)).toBe(30_000);
    expect(cooldownLeft(s, 29_000)).toBe(6000);
    expect(canRequest(s, 34_999)).toBe(false);
    expect(canRequest(s, 35_000)).toBe(true);
    expect(controlReducer(s, req(20_000))).toBe(s); // bekleme sürerken istek yok sayılır
  });

  it("AC-116: oturum başına en çok 5 istek", () => {
    let s = initialControl;
    let now = 0;
    for (let i = 0; i < 5; i++) {
      s = run([req(now), denied(now)], s);
      now += 31_000;
    }
    expect(s.requests).toBe(5);
    expect(requestsLeft(s)).toBe(0);
    expect(canRequest(s, now)).toBe(false);
    expect(controlReducer(s, req(now)).phase).toBe("denied");
  });

  it("AC-50: müşteri kapatırsa / kısayol / sistem → yakalama anında biter, neden yazılır", () => {
    for (const [source, cause] of [["UI", "customer"], ["HOTKEY", "hotkey"], ["SYSTEM", "system"]] as const) {
      const s = run([req(), granted, msg({ t: "control.state", state: "VIEW", source }, 2000)]);
      expect(isCapturing(s)).toBe(false);
      expect(s.phase).toBe("ended");
      expect(s.endedBy).toBe(cause);
      expect(s.endedAt).toBe(2000);
      expect(canRequest(s, 2000)).toBe(true);
    }
  });

  it("AC-115/G-04: control.revoke{permission} ve caps.update yakalamayı kapatır, yeniden isteği engeller", () => {
    const a = run([req(), granted, msg({ t: "control.revoke", reason: "permission" })]);
    expect(isCapturing(a)).toBe(false);
    expect(a.forbidden).toBe(true);
    expect(canRequest(a, 1e9)).toBe(false);
    const b = run([req(), granted, msg({ t: "caps.update", caps: ["file_transfer"] })]);
    expect(isCapturing(b)).toBe(false);
    expect(b.forbidden).toBe(true);
    const c = run([req(), granted, msg({ t: "caps.update", caps: ["remote_control"] })]);
    expect(isCapturing(c)).toBe(true);
    const d = run([req(), granted, msg({ t: "control.revoke", reason: "audit" })]);
    expect(d.forbidden).toBe(false);
    expect(d.endedBy).toBe("system");
    // G-15: audit yazılamadı → teknisyene error{INTERNAL}
    const e = run([req(), granted, msg({ t: "error", code: "INTERNAL", message: "x" }, 1500)]);
    expect(isCapturing(e)).toBe(false);
    expect(e.endedBy).toBe("system");
  });

  it("AC-51: sunucu FORBIDDEN → yetki yok; RATE_LIMITED → sayaç geri alınır", () => {
    const f = run([req(), msg({ t: "error", code: "FORBIDDEN", message: "x" }, 1200)]);
    expect(f.forbidden).toBe(true);
    expect(f.phase).toBe("idle");
    expect(f.requests).toBe(0);
    const r = run([req(), msg({ t: "error", code: "RATE_LIMITED", message: "x" }, 1200)]);
    expect(r.phase).toBe("idle");
    expect(r.error).toBe("rate");
    expect(r.requests).toBe(0);
    // Eski isteğe ait olmayan hata yok sayılır
    const late = run([req(), msg({ t: "error", code: "FORBIDDEN", message: "x" }, 9000)]);
    expect(late.phase).toBe("requested");
  });

  it("kopma / yeniden bağlanma / oturum sonu fail-safe: yakalama kapanır", () => {
    const base = run([req(), granted]);
    expect(controlReducer(base, { type: "closed", now: 3000 }).phase).toBe("idle");
    expect(controlReducer(base, msg({ t: "peer.left", role: "guest", reason: "disconnect" })).endedBy).toBe("peer");
    expect(controlReducer(base, msg({ t: "peer.joined", role: "guest", guestKind: "AGENT" })).phase).toBe("idle");
    expect(isCapturing(controlReducer(base, msg({ t: "session.ended", reason: "tech" })))).toBe(false);
    expect(controlReducer(base, msg({ t: "control.state", state: "VIEW", source: "RECONNECT" })).phase).toBe("idle");
    // K3/K2: sunucu kaynaklı kapatma nedenleri konsola gelirse de kapatma yönünde işlenir
    const rc = controlReducer(base, msg({ t: "control.revoke", reason: "reconnect" }));
    expect(rc.phase).toBe("idle");
    expect(rc.endedBy).toBe("reconnect");
    expect(rc.forbidden).toBe(false);
    const st = controlReducer(base, msg({ t: "control.revoke", reason: "stale" }));
    expect(isCapturing(st)).toBe(false);
    expect(st.forbidden).toBe(false);
    // {VIEW, TECH} açık kontrolde gelirse de kapanır (bildirim yok — neden "tech")
    expect(controlReducer(base, msg({ t: "control.state", state: "VIEW", source: "TECH" })).endedBy).toBe("tech");
  });

  it("AC-105: env.state uyarıları", () => {
    const s = run([msg({ t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: false })]);
    expect(s.env).toEqual({ elevated: true, secure: false, self: false });
    expect(run([msg({ t: "env.state", elevatedForeground: false, secureDesktop: true, selfElevated: false })], s).env.secure).toBe(true);
  });

  it("AC-43: monitör isteği → share.state.activeMonitor eşleşince değişti; yanıtsızsa onaylanmadı", () => {
    const withMon = run([msg({ t: "share.state", state: "sharing", monitors, activeMonitor: 0 })]);
    expect(controlReducer(withMon, { type: "monitor", id: 0, now: 1 })).toBe(withMon); // zaten aktif
    expect(controlReducer(withMon, { type: "monitor", id: 7, now: 1 })).toBe(withMon); // bilinmeyen
    const p = controlReducer(withMon, { type: "monitor", id: 1, now: 1000 });
    expect(p.monitorPending).toEqual({ id: 1, at: 1000 });
    const ok = controlReducer(p, msg({ t: "share.state", state: "sharing", activeMonitor: 1 }));
    expect(ok.monitorPending).toBeNull();
    expect(ok.monitorOutcome).toBe("switched");
    expect(ok.activeMonitor).toBe(1);
    expect(controlReducer(p, { type: "monitorTimeout", now: 1000 + MONITOR_TIMEOUT_MS - 1 }).monitorPending).not.toBeNull();
    expect(controlReducer(p, { type: "monitorTimeout", now: 1000 + MONITOR_TIMEOUT_MS }).monitorOutcome).toBe("noAnswer");
  });

  it("K4: monitor.denied → bekleme hemen biter, 'reddetti'; başka monitörün reddi yok sayılır", () => {
    const withMon = run([msg({ t: "share.state", state: "sharing", monitors, activeMonitor: 0 })]);
    const p = controlReducer(withMon, { type: "monitor", id: 1, now: 1000 });
    const d = controlReducer(p, msg({ t: "monitor.denied", monitorId: 1 }, 1200));
    expect(d.monitorPending).toBeNull();
    expect(d.monitorOutcome).toBe("denied");
    expect(d.activeMonitor).toBe(0);
    expect(controlReducer(d, { type: "monitorTimeout", now: 1000 + MONITOR_TIMEOUT_MS })).toBe(d); // yedek yol etkisiz
    expect(controlReducer(p, msg({ t: "monitor.denied", monitorId: 0 }))).toBe(p);
  });

  it("K6: requested'da {VIEW, SYSTEM} → istek kapanır (ret değil), bekleme yok, hemen yeniden istenebilir", () => {
    const s = run([req(1000), msg({ t: "control.state", state: "VIEW", source: "SYSTEM" }, 2000)]);
    expect(s.phase).toBe("ended");
    expect(s.endedBy).toBe("agent");
    expect(s.deniedAt).toBeNull();
    expect(cooldownLeft(s, 2000)).toBe(0);
    expect(canRequest(s, 2000)).toBe(true);
    expect(s.requests).toBe(1); // sunucu sayacı düşmez
    // Açık kontrolde SYSTEM önceki gibi sistem kapanışı
    expect(run([req(), granted, msg({ t: "control.state", state: "VIEW", source: "SYSTEM" })]).endedBy).toBe("system");
  });

  it("K7: monitör reddi / yanıtsızlık → 30 sn + 1 sn bekleme; bekleme ve bekleyen istek varken yeni istek yok", () => {
    const withMon = run([msg({ t: "share.state", state: "sharing", monitors, activeMonitor: 0 })]);
    const p = controlReducer(withMon, { type: "monitor", id: 1, now: 1000 });
    expect(canRequestMonitor(p, 1000)).toBe(false); // bekleyen var
    const d = controlReducer(p, msg({ t: "monitor.denied", monitorId: 1 }, 2000));
    expect(d.monitorBlockedUntil).toBe(2000 + MONITOR_BLOCK_MS);
    expect(MONITOR_BLOCK_MS).toBe(31_000);
    expect(monitorBlockLeft(d, 12_000)).toBe(21_000);
    expect(canRequestMonitor(d, 2000 + MONITOR_BLOCK_MS - 1)).toBe(false);
    expect(controlReducer(d, { type: "monitor", id: 1, now: 20_000 })).toBe(d);
    expect(canRequestMonitor(d, 2000 + MONITOR_BLOCK_MS)).toBe(true);
    const t = controlReducer(p, { type: "monitorTimeout", now: 1000 + MONITOR_TIMEOUT_MS });
    expect(t.monitorBlockedUntil).toBe(1000 + MONITOR_TIMEOUT_MS + MONITOR_BLOCK_MS);
    expect(canRequestMonitor(t, 1000 + MONITOR_TIMEOUT_MS + 5000)).toBe(false);
  });

  it("K7: monitör isteğine CONFLICT/RATE_LIMITED → bekleme kapanır, sayaç geri alınır, bekleme uzar", () => {
    const withMon = run([msg({ t: "share.state", state: "sharing", monitors, activeMonitor: 0 })]);
    for (const code of ["CONFLICT", "RATE_LIMITED"] as const) {
      const p = controlReducer(withMon, { type: "monitor", id: 1, now: 1000 });
      const e = controlReducer(p, msg({ t: "error", code, message: "x" }, 1500));
      expect(e.monitorPending).toBeNull();
      expect(e.monitorRequests).toBe(0);
      expect(e.monitorOutcome).toBe("rate");
      expect(e.monitorBlockedUntil).toBe(1500 + MONITOR_BLOCK_MS);
      expect(canRequestMonitor(e, 20_000)).toBe(false);
    }
  });

  it("S7-15: zaten paylaşılan monitör (VALIDATION) → bekleme kapanır, sayaç geri alınır, ek bekleme yok", () => {
    const withMon = run([msg({ t: "share.state", state: "sharing", monitors, activeMonitor: 0 })]);
    const p = controlReducer(withMon, { type: "monitor", id: 1, now: 1000 });
    const e = controlReducer(p, msg({ t: "error", code: "VALIDATION", message: "Bu monitör zaten paylaşılıyor." }, 1200));
    expect(e.monitorPending).toBeNull();
    expect(e.monitorRequests).toBe(0);
    expect(e.monitorOutcome).toBe("already");
    expect(e.monitorBlockedUntil).toBeNull();
    expect(canRequestMonitor(e, 1200)).toBe(true);
  });

  it("misafir koparsa (peer.left{guest}) bekleyen monitör ve kontrol göstergesi kapanır", () => {
    const withMon = run([msg({ t: "share.state", state: "sharing", monitors, activeMonitor: 0 })]);
    const p = run([req(1000), { type: "monitor", id: 1, now: 1000 }], withMon);
    const l = controlReducer(p, msg({ t: "peer.left", role: "guest", reason: "disconnect" }, 1500));
    expect(l.monitorPending).toBeNull();
    expect(l.phase).toBe("idle");
    expect(l.endedBy).toBe("peer");
  });

  it("K7: kontrol isteğine CONFLICT → faz değişmez, yalnız sunucunun metni", () => {
    const s = run([req(1000), msg({ t: "error", code: "CONFLICT", message: "Bekleyen istek var." }, 1200)]);
    expect(s.phase).toBe("requested");
    expect(s.requests).toBe(1);
    expect(s.notice).toBe("Bekleyen istek var.");
    expect(controlReducer(s, granted).notice).toBeNull();
  });

  it("K8: env.state.selfElevated rozeti için tutulur; yeni bağlantıda sıfırlanır", () => {
    const m: ServerOutbound = { t: "env.state", elevatedForeground: false, secureDesktop: false, selfElevated: true };
    const s = run([msg(m)]);
    expect(s.env.self).toBe(true);
    expect(controlReducer(s, msg({ t: "peer.joined", role: "guest", guestKind: "AGENT" })).env.self).toBe(false);
  });

  it("TEST-P7-3: yenileme sonrası sayaçlar geri yüklenir (büyük olan kazanır), izin asla geri yüklenmez", () => {
    const s = controlReducer(initialControl, { type: "restore", saved: { requests: 3, deniedAt: 10_000, monitorRequests: 2, monitorBlockedUntil: 50_000 }, now: 20_000 });
    expect(s.requests).toBe(3);
    expect(requestsLeft(s)).toBe(2);
    expect(s.phase).toBe("denied"); // ret beklemesi sürüyor
    expect(cooldownLeft(s, 20_000)).toBe(20_000);
    expect(s.monitorRequests).toBe(2);
    expect(canRequestMonitor(s, 49_999)).toBe(false);
    expect(isCapturing(s)).toBe(false);
    // StrictMode çift efektinde sıfırlı ikinci geri yükleme geri götürmez
    expect(controlReducer(s, { type: "restore", saved: { requests: 0 }, now: 20_000 }).requests).toBe(3);
    // Bozuk / sınır dışı değerler
    const b = controlReducer(initialControl, { type: "restore", saved: { requests: 99, deniedAt: -5, monitorRequests: Number.NaN }, now: 1 });
    expect(b.requests).toBe(5);
    expect(b.deniedAt).toBeNull();
    expect(b.monitorRequests).toBe(0);
    expect(b.phase).toBe("idle");
    // Bekleme bitmişse faz idle kalır
    expect(controlReducer(initialControl, { type: "restore", saved: { requests: 1, deniedAt: 1000 }, now: 40_000 }).phase).toBe("idle");
  });
});
