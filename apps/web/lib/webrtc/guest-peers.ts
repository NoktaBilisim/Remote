/*
 * P28c tarayıcı misafiri eş haritası (mimari-p28c r2 §4.4, §4.5, §6.1; ADR-0035; AC-366, 367, 371):
 *  - Her teknisyen ayrı RTCPeerConnection (`from` tid → eş); yanıt/ICE `to: tid` ile gider (multi1 soketinde zorunlu).
 *  - Kabul listesi (Y-PC-4, gizli izleyici yok): yalnız SON roster'da bulunan VE ekranda adıyla çizilmiş (`markDrawn`) tid'in
 *    teklifi yanıtlanır; çizimden önce gelen teklif bekletilir, roster'da olmayan / `from`'suz teklif (roster görüldükten sonra)
 *    düşer. Roster'dan düşen ya da bağlantısı kopan tid'in eşi hemen kapanır.
 *  - Ana/düşük akış: aynı iz her eşe; kontrol sahibi dışındaki göndericilerde `maxFramerate = LOW_FPS`, `maxBitrate = LOW_BPS`.
 *  - Sohbet yayma (§4.5): teknisyen mesajı (izleyici değilse) gösterilir ve diğer eşlere `by = gönderenin tid'i` ile iletilir;
 *    teknisyenden gelen `by`'lı mesaj düşer (yalnız misafir damgalar). Dosya/işaretleme yalnız kontrol sahibinin eşinden (`main`).
 * Roster hiç gelmediyse (eski sunucu) tek eş, `from`'suz eski yol (anahtar `LEGACY`).
 */
import type { GuestInboundFull, IceServer } from "@remote/contracts/ws";
import type { RosterRole, TechRosterEntry } from "@remote/contracts/ws-multi";
import { parseCtl } from "../dc/ctl";
import { inboundLimiter } from "../dc/rate";
import { PeerLink, type Channels } from "./peer";

export const LEGACY = "";

export { senderEncodings } from "./sender-caps";

/** Teklif kararı (saf): yanıtla / çizim bekle / düş. */
export function offerDecision(
  roster: readonly TechRosterEntry[] | null,
  drawn: ReadonlySet<string>,
  from: string | undefined,
): "answer" | "wait" | "drop" {
  if (roster === null) return from === undefined ? "answer" : "wait";
  if (from === undefined) return "drop";
  const e = roster.find((x) => x.tid === from);
  if (!e || !e.connected) return "drop";
  return drawn.has(from) ? "answer" : "wait";
}

/**
 * `ice.restart` hedef eşi (saf; Go `iceRestartPeer` ile aynı kural): roster hiç gelmediyse yalnız `from`'suz eski tek eş;
 * roster görüldükten sonra yalnız son roster'da bağlı ve adı çizilmiş tid. Diğerleri null → yok sayılır (eş kurulmaz/kapanmaz).
 */
export function iceRestartTarget(
  roster: readonly TechRosterEntry[] | null,
  drawn: ReadonlySet<string>,
  from: string | undefined,
): string | null {
  if (roster === null) return from === undefined ? LEGACY : null;
  if (from === undefined) return null;
  return offerDecision(roster, drawn, from) === "answer" ? from : null;
}

interface Entry {
  link: PeerLink;
  channels: Channels | null;
  off?: () => void;
}

export interface GuestChatIn {
  id: string;
  text: string;
  ts: number;
  by: string;
}

interface Opts {
  ice: () => IceServer[];
  send: (m: GuestInboundFull) => void;
  /** Ana eş kanalları / açık kanal kümesi değişti (React durumunu yeniler). */
  onChange: () => void;
  onChat: (m: GuestChatIn) => void;
}

export class GuestPeers {
  private peers = new Map<string, Entry>();
  private roster: TechRosterEntry[] | null = null;
  private drawn = new Set<string>();
  private queued = new Map<string, string>();
  private track: MediaStreamTrack | null = null;

  constructor(private o: Opts) {}

  get multi(): boolean {
    return this.roster !== null;
  }

  private roleOf(tid: string): RosterRole | null {
    return this.roster?.find((e) => e.tid === tid)?.role ?? null;
  }

  /** `techs.roster`: listeden düşen / kopan eş kapanır; kalanların akış tavanı rolüne göre güncellenir. */
  onRoster(techs: readonly TechRosterEntry[]): void {
    this.roster = [...techs];
    const live = new Set(techs.filter((e) => e.connected).map((e) => e.tid));
    for (const tid of [...this.peers.keys()]) if (!live.has(tid)) this.close(tid);
    for (const tid of [...this.queued.keys()]) if (!live.has(tid)) this.queued.delete(tid);
    for (const [tid, e] of this.peers) void e.link.setSendCaps(this.roleOf(tid) !== "controller");
    this.o.onChange();
  }

  /** Arayüz bu tid'leri adıyla çizdi (Y-PC-4); bekleyen teklifler şimdi yanıtlanır. */
  markDrawn(tids: readonly string[]): void {
    this.drawn = new Set(tids);
    for (const [tid, sdp] of [...this.queued]) {
      if (offerDecision(this.roster, this.drawn, tid) !== "answer") continue;
      this.queued.delete(tid);
      this.answer(tid, sdp);
    }
  }

  offer(from: string | undefined, sdp: string): void {
    const d = offerDecision(this.roster, this.drawn, from);
    if (d === "drop") return;
    if (d === "wait") return void this.queued.set(from ?? LEGACY, sdp);
    this.answer(from ?? LEGACY, sdp);
  }

  ice(from: string | undefined, c: RTCIceCandidateInit): void {
    void this.peers.get(from ?? LEGACY)?.link.addIce(c);
  }

  /**
   * `ice.restart{from?}`: yanıtlayan taraf olarak hedef eşte ek iş yok — teknisyen ardından `iceRestart`'lı yeni teklif gönderir,
   * yeni ICE kimliği o teklifin yanıtında (aynı kabul listesiyle) uygulanır. Döner: hedef eş kurulu mu (roster dışı → false).
   */
  iceRestart(from: string | undefined): boolean {
    const tid = iceRestartTarget(this.roster, this.drawn, from);
    return tid !== null && this.peers.has(tid);
  }

  private answer(tid: string, sdp: string): void {
    let e = this.peers.get(tid);
    if (!e) e = this.open(tid);
    const link = e.link;
    void link
      .answer(sdp, this.track)
      .then(() => link.setSendCaps(this.multi && this.roleOf(tid) !== "controller"))
      .catch(() => this.close(tid));
  }

  private open(tid: string): Entry {
    const send = (m: Parameters<ConstructorParameters<typeof PeerLink>[1]>[0]) =>
      this.o.send((tid === LEGACY ? m : { ...m, to: tid }) as GuestInboundFull);
    const link = new PeerLink(this.o.ice(), send);
    const e: Entry = { link, channels: null };
    link.onChannels = (c) => {
      if (this.peers.get(tid) !== e) return;
      e.channels = c;
      e.off = this.listen(tid, c.ctl);
      this.o.onChange();
    };
    this.peers.set(tid, e);
    return e;
  }

  /** Sohbet yayma (§4.5): izleyiciden ve `by`'lı gelen düşer; diğerleri gösterilir + öteki eşlere `by` ile iletilir. */
  private listen(tid: string, ctl: RTCDataChannel): () => void {
    const allow = inboundLimiter();
    const h = (ev: MessageEvent) => {
      const m = parseCtl(ev.data);
      if (!m || m.t !== "chat" || m.by !== undefined || !allow("chat")) return;
      if (this.roleOf(tid) === "observer") return;
      this.o.onChat({ id: m.id, text: m.text, ts: m.ts, by: tid });
      if (tid === LEGACY) return;
      const fwd = JSON.stringify({ t: "chat", id: m.id, text: m.text, ts: m.ts, by: tid });
      for (const [other, e] of this.peers) if (other !== tid && e.channels?.ctl.readyState === "open") e.channels.ctl.send(fwd);
    };
    ctl.addEventListener("message", h);
    return () => ctl.removeEventListener("message", h);
  }

  /** Müşterinin kendi mesajı: tüm açık eşlere `by`'sız. En az birine gittiyse true. */
  sendChat(m: { t: "chat"; id: string; text: string; ts: number }): boolean {
    let sent = false;
    const raw = JSON.stringify(m);
    for (const e of this.peers.values())
      if (e.channels?.ctl.readyState === "open") {
        e.channels.ctl.send(raw);
        sent = true;
      }
    return sent;
  }

  get chatReady(): boolean {
    return [...this.peers.values()].some((e) => e.channels !== null);
  }

  /** Dosya/işaretleme kanalı: kontrol sahibinin eşi (eski yolda tek eş). */
  main(): Channels | null {
    const tid = this.roster ? (this.roster.find((e) => e.role === "controller")?.tid ?? null) : LEGACY;
    return tid === null ? null : (this.peers.get(tid)?.channels ?? null);
  }

  async setTrack(track: MediaStreamTrack | null): Promise<void> {
    this.track = track;
    await Promise.all([...this.peers.values()].map((e) => e.link.setTrack(track)));
  }

  setIceServers(s: IceServer[]): void {
    for (const e of this.peers.values()) e.link.setIceServers(s);
  }

  close(tid: string): void {
    const e = this.peers.get(tid);
    if (!e) return;
    e.off?.();
    e.link.close();
    this.peers.delete(tid);
    this.o.onChange();
  }

  /** Yeni WS bağlantısı (hello) / oturum sonu: tüm eşler kapanır; roster bir sonraki `techs.roster` ile yeniden kurulur. */
  closeAll(): void {
    for (const tid of [...this.peers.keys()]) this.close(tid);
    this.queued.clear();
  }
}
