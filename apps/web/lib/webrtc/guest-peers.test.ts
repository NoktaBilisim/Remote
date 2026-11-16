/*
 * P28c (mimari-p28c §4.4, Y-PC-4, AC-366/371): tarayıcı misafiri eş haritası — iki teknisyen iki ayrı eş, yanıt/ICE `to` damgalı,
 * roster dışı / bağlı olmayan tid'in teklifi eş kurmaz, roster'dan düşen eş kapanır, `ice.restart{from}` hedefi.
 * `PeerLink` sahte (RTCPeerConnection yok); yalnız eş haritası davranışı sınanır.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TechRosterEntry } from "@remote/contracts/ws-multi";

const links: FakeLink[] = [];
class FakeLink {
  closed = false;
  caps: boolean[] = [];
  ices: unknown[] = [];
  onChannels: unknown = null;
  constructor(
    _ice: unknown,
    readonly send: (m: Record<string, unknown>) => void,
  ) {
    links.push(this);
  }
  answer(sdp: string) {
    this.send({ t: "sdp.answer", sdp: `ans:${sdp}` });
    return Promise.resolve();
  }
  setSendCaps(low: boolean) {
    this.caps.push(low);
    return Promise.resolve();
  }
  addIce(c: unknown) {
    this.ices.push(c);
    return Promise.resolve();
  }
  setTrack() {
    return Promise.resolve();
  }
  setIceServers() {}
  close() {
    this.closed = true;
  }
}
vi.mock("./peer", () => ({ PeerLink: FakeLink }));

const { GuestPeers, iceRestartTarget, LEGACY } = await import("./guest-peers");

const A = "AAAAAAAAAAA";
const B = "BBBBBBBBBBB";
const X = "XXXXXXXXXXX";
const two: TechRosterEntry[] = [
  { tid: A, name: "Ayşe Sahip", role: "controller", owner: true, connected: true },
  { tid: B, name: "Burak Katılımcı", role: "participant", owner: false, connected: true },
];
const flush = () => new Promise((r) => setTimeout(r, 0));

function make() {
  const sent: Record<string, unknown>[] = [];
  const p = new GuestPeers({ ice: () => [], send: (m) => sent.push(m as Record<string, unknown>), onChange: () => {}, onChat: () => {} });
  return { p, sent };
}

describe("GuestPeers çok eşli harita (P28c)", () => {
  beforeEach(() => {
    links.length = 0;
  });

  it("iki teknisyen → iki ayrı eş; yanıtlar `to` ile, ikincil göndericide düşük akış", async () => {
    const { p, sent } = make();
    p.onRoster(two);
    p.markDrawn([A, B]);
    p.offer(A, "oA");
    p.offer(B, "oB");
    await flush();
    expect(links).toHaveLength(2);
    expect(sent).toEqual([
      { t: "sdp.answer", sdp: "ans:oA", to: A },
      { t: "sdp.answer", sdp: "ans:oB", to: B },
    ]);
    expect(links[0]!.caps.at(-1)).toBe(false); // kontrol sahibi: tavan yok
    expect(links[1]!.caps.at(-1)).toBe(true); // katılımcı: LOW_FPS/LOW_BPS
    p.ice(B, { candidate: "c" });
    expect(links[1]!.ices).toHaveLength(1);
    expect(links[0]!.ices).toHaveLength(0);
  });

  it("roster dışı / from'suz / bağlı olmayan tid'in teklifi eş kurmaz, ICE'si düşer", async () => {
    const { p, sent } = make();
    p.onRoster([...two.slice(0, 1), { ...two[1]!, connected: false }]);
    p.markDrawn([A, B]);
    p.offer(X, "oX");
    p.offer(undefined, "o?");
    p.offer(B, "oB");
    p.ice(X, { candidate: "c" });
    await flush();
    expect(links).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("çizilmeden gelen teklif bekler, çizimle yanıtlanır; roster'dan düşen eş kapanır", async () => {
    const { p, sent } = make();
    p.onRoster(two);
    p.offer(B, "oB");
    await flush();
    expect(links).toHaveLength(0);
    p.markDrawn([A, B]);
    await flush();
    expect(sent).toEqual([{ t: "sdp.answer", sdp: "ans:oB", to: B }]);
    p.onRoster(two.slice(0, 1));
    expect(links[0]!.closed).toBe(true);
  });

  it("roster hiç gelmezse eski tek eş yolu (`to` yok)", async () => {
    const { p, sent } = make();
    p.offer(undefined, "o");
    await flush();
    expect(sent).toEqual([{ t: "sdp.answer", sdp: "ans:o" }]);
  });

  it("ice.restart{from}: yalnız roster'daki kurulu eş hedeflenir; roster dışı tid yok sayılır (eş kurulmaz/kapanmaz)", async () => {
    expect(iceRestartTarget(null, new Set(), undefined)).toBe(LEGACY);
    expect(iceRestartTarget(null, new Set(), A)).toBeNull();
    expect(iceRestartTarget(two, new Set([A, B]), undefined)).toBeNull();
    expect(iceRestartTarget(two, new Set([A, B]), X)).toBeNull();
    expect(iceRestartTarget(two, new Set([A]), B)).toBeNull();
    expect(iceRestartTarget(two, new Set([A, B]), B)).toBe(B);
    const { p } = make();
    p.onRoster(two);
    p.markDrawn([A, B]);
    p.offer(A, "oA");
    await flush();
    expect(p.iceRestart(A)).toBe(true);
    expect(p.iceRestart(B)).toBe(false); // eş henüz kurulmadı
    expect(p.iceRestart(X)).toBe(false);
    expect(links).toHaveLength(1);
    expect(links[0]!.closed).toBe(false);
  });
});
