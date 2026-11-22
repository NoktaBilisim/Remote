import { describe, expect, it } from "vitest";
import type { ServerOutbound } from "@remote/contracts/ws";
import { controlReducer, initialControl, type ControlState } from "@/lib/control/machine";
import { initialTech, sharingMethodOf, techReducer, type TechState } from "@/lib/webrtc/tech-machine";

// P17 konsol (AC-248 "teknisyen konsolunda mod görünür", AC-234 pencere nedenleri).
const live = (): TechState => ({ ...initialTech, phase: "live", guest: { name: "M", kind: "AGENT" } });
const tm = (s: TechState, ...ms: ServerOutbound[]) => ms.reduce((a, m) => techReducer(a, { type: "msg", m, now: 1 }), s);
const cm = (s: ControlState, ...ms: ServerOutbound[]) => ms.reduce((a, m) => controlReducer(a, { type: "msg", m, now: 1 }), s);

describe("AC-248: konsolda paylaşım modu", () => {
  it("AC-248: share.state{sharing, WGC} → shareMethod WGC; DXGI/GDI/yöntemsiz mevcut davranış", () => {
    expect(tm(live(), { t: "share.state", state: "sharing", method: "WGC" })).toMatchObject({
      share: "sharing",
      shareMethod: "WGC",
      shareFail: null,
    });
    expect(tm(live(), { t: "share.state", state: "sharing", method: "DXGI" }).shareMethod).toBe("DXGI");
    expect(tm(live(), { t: "share.state", state: "sharing" }).shareMethod).toBeNull(); // 0.10.x
  });

  it("AC-248: pencere kapanınca (stopped, WINDOW_CLOSED, WGC) mod temizlenir, Türkçe neden gösterilir", () => {
    const s = tm(
      live(),
      { t: "share.state", state: "sharing", method: "WGC" },
      { t: "share.state", state: "stopped", reason: "WINDOW_CLOSED", method: "WGC" },
    );
    expect(s.shareMethod).toBeNull();
    expect(s.shareFail).toBe("Paylaşılan pencere kapatıldı — Pencere yakalama");
    expect(tm(live(), { t: "share.state", state: "stopped", reason: "WGC_UNSUPPORTED" }).shareFail).toBe(
      "Bu Windows sürümü pencere paylaşımını desteklemiyor",
    );
  });

  it("AC-248: müşteri ayrılınca / yeniden katılınca mod sıfırlanır", () => {
    const s = tm(live(), { t: "share.state", state: "sharing", method: "WGC" });
    expect(tm(s, { t: "peer.left", role: "guest" }).shareMethod).toBeNull();
    expect(tm(s, { t: "peer.joined", role: "guest", guestKind: "AGENT" }).shareMethod).toBeNull();
  });

  it("AC-248: konsol yenilenince hello{share{sharing, WGC}} modu geri getirir", () => {
    const h = {
      t: "hello",
      role: "tech",
      sessionId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
      peerPresent: true,
      iceServers: [],
      maxEndsAt: "2026-11-15T12:00:00.000Z",
      share: { state: "sharing", method: "WGC" },
    } as ServerOutbound;
    expect(tm(initialTech, h)).toMatchObject({ phase: "live", share: "sharing", shareMethod: "WGC" });
  });

  it("AC-248: bilinmeyen / dize olmayan yöntem yok sayılır", () => {
    expect(sharingMethodOf("sharing", "XYZ")).toBeNull();
    expect(sharingMethodOf("sharing", 3)).toBeNull();
    expect(sharingMethodOf("stopped", "WGC")).toBeNull();
    expect(sharingMethodOf("sharing", "GDI")).toBe("GDI");
  });

  it("AC-248: pencere modunda önceki monitör listesi ve bekleyen monitör isteği kapanır", () => {
    let c = cm(initialControl, {
      t: "share.state",
      state: "sharing",
      monitors: [
        { id: 0, name: "Ekran 1", w: 1280, h: 720, primary: true },
        { id: 1, name: "Ekran 2", w: 1280, h: 720, primary: false },
      ],
      activeMonitor: 0,
    });
    expect(c.monitors).toHaveLength(2);
    c = controlReducer(c, { type: "monitor", id: 1, now: 2 });
    c = cm(c, { t: "share.state", state: "sharing", method: "WGC" });
    expect(c).toMatchObject({ monitors: [], activeMonitor: null, monitorPending: null });
    // DXGI'da liste korunur (mevcut davranış)
    const d = cm(initialControl, {
      t: "share.state",
      state: "sharing",
      method: "DXGI",
      monitors: [{ id: 0, name: "E", w: 1, h: 1, primary: true }],
    });
    expect(d.monitors).toHaveLength(1);
  });
});
