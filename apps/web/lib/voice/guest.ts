/*
 * P28d tarayıcı misafir sesli görüşme (mimari-p28d r2 §4.2, §4.3, §5; K-PD-2, V-PD-7, D-PD-3, Y-PD-3; AC-373, 374, 378).
 * K-PD-2 (bağlayıcı): mikrofon YALNIZ `accept()` içinde — kullanıcının o `callId` için yerel "Kabul et" tıklamasında — açılır.
 * Rıza kaydı (`consent = callId`) yalnız bu nesnenin belleğindedir (sessionStorage/localStorage yok); WS kapanışında, görüşme
 * bitişinde ve `callId` değişiminde silinir. `voice.state`, `voice.request`, DC ya da SDP mikrofon açmaz, yalnız kapatır:
 * rıza kaydı olmadan `voice.state{active}` gelirse mikrofon açılmaz ve `voice.end{callId, customer}` gider.
 * Yan etkiler enjekte edilir (graf, getUserMedia, eşler) → node'da birim testli.
 */
import type { GuestInboundFull } from "@remote/contracts/ws";
import type { TechRosterEntry } from "@remote/contracts/ws-multi";
import type { VoiceStateMessage } from "@remote/contracts/ws-voice";
import { diffEdges, mixPlan } from "./mix";

/** WebAudio grafı (tarayıcı uygulaması `graph.ts`). Kenar `kaynak>hedef` (mix.ts). */
export interface VoiceGraph {
  setMic(track: MediaStreamTrack): void;
  /** Uzak teknisyen izi kaynak olarak (muted `<audio>` + kaynak düğümü); yalnız talkers için çağrılır. */
  addSource(tid: string, track: MediaStreamTrack): void;
  removeSource(tid: string): void;
  /** Eş başına karışım çıkışı (MediaStreamAudioDestinationNode izi). */
  output(tid: string): MediaStreamTrack;
  dropOutput(tid: string): void;
  link(edge: string): void;
  unlink(edge: string): void;
  close(): void;
}

/** Eş haritasının ses yüzü (`GuestPeers`). */
export interface VoicePeers {
  tids(): string[];
  remoteAudio(tid: string): MediaStreamTrack | null;
  setAudioOut(tid: string, track: MediaStreamTrack | null): void;
}

export interface GuestVoiceDeps {
  send: (m: GuestInboundFull) => void;
  peers: VoicePeers;
  getMic: () => Promise<MediaStreamTrack>;
  createGraph: () => VoiceGraph;
  onChange: () => void;
}

export type GuestVoiceNote = "ended" | "device" | null;

export interface GuestVoiceView {
  request: { callId: string; by: string; name: string; listeners: string[] } | null;
  /** Etkin ve rızalı görüşme (çubuk görünür). */
  active: { callId: string; talkers: string[]; listeners: string[] } | null;
  mic: "off" | "opening" | "on";
  muted: boolean;
  /** Yeni dinleyici duyurusu (`aria-live=assertive`); `seq` her duyuruda artar. */
  announce: { seq: number; tids: string[] } | null;
  note: GuestVoiceNote;
}

export class GuestVoice {
  private roster: TechRosterEntry[] = [];
  private request: { callId: string; by: string } | null = null;
  private call: VoiceStateMessage | null = null;
  private consent: string | null = null;
  private mic: MediaStreamTrack | null = null;
  private opening = false;
  private muted = false;
  private graph: VoiceGraph | null = null;
  private edges: string[] = [];
  private sources = new Map<string, MediaStreamTrack>();
  private outs = new Set<string>();
  private refused = new Set<string>();
  private announce: GuestVoiceView["announce"] = null;
  private note: GuestVoiceNote = null;

  constructor(private d: GuestVoiceDeps) {}

  private named(tids: readonly string[]): string[] {
    return tids.filter((t) => this.roster.some((e) => e.tid === t));
  }
  private nameOf(tid: string): string | null {
    return this.roster.find((e) => e.tid === tid)?.name ?? null;
  }

  view(): GuestVoiceView {
    const r = this.request;
    const c = this.call;
    const on = c?.phase === "active" && this.consent === c.callId ? c : null;
    return {
      request: r && { ...r, name: this.nameOf(r.by) ?? "", listeners: this.named(this.call?.listeners ?? []).filter((t) => t !== r.by) },
      active: on && on.callId ? { callId: on.callId, talkers: this.named(on.talkers), listeners: this.named(on.listeners) } : null,
      mic: this.mic ? "on" : this.opening ? "opening" : "off",
      muted: this.muted,
      announce: this.announce,
      note: this.note,
    };
  }

  onRoster(techs: readonly TechRosterEntry[]): void {
    this.roster = [...techs];
    if (this.request && !this.nameOf(this.request.by)) this.request = null;
    this.apply();
    this.d.onChange();
  }

  /** S→misafir `voice.request`: diyalog açar, mikrofon AÇMAZ. Roster'da olmayan `by` yok sayılır (Y-PC-4). */
  onRequest(m: { callId: string; by: string }): void {
    if (!this.nameOf(m.by)) return;
    if (this.consent && this.consent !== m.callId) this.release();
    this.request = { callId: m.callId, by: m.by };
    this.note = null;
    this.d.onChange();
  }

  onState(m: VoiceStateMessage): void {
    const prev = this.call;
    const had = this.consent !== null;
    if (this.request && (m.phase !== "pending" || m.callId !== this.request.callId)) this.request = null;
    if (this.consent && m.callId !== this.consent) this.release();
    if (m.phase === "idle") {
      if (had) this.note = "ended";
      this.release();
      this.call = null;
      return this.d.onChange();
    }
    this.call = m;
    if (prev && prev.callId === m.callId && m.phase === "active") {
      const before = new Set(prev.listeners);
      const fresh = this.named(m.listeners).filter((t) => !before.has(t));
      if (fresh.length) this.announce = { seq: (this.announce?.seq ?? 0) + 1, tids: fresh };
    }
    if (m.phase === "active" && m.callId && this.consent !== m.callId && !this.refused.has(m.callId)) {
      // Rıza kaydı yok (yenileme, bayat/sahte durum): mikrofon açılmaz, görüşme müşteri adına biter (K-PD-2)
      this.refused.add(m.callId);
      this.d.send({ t: "voice.end", callId: m.callId, reason: "customer" });
    }
    this.apply();
    this.d.onChange();
  }

  /** "Kabul et" tıklaması: rıza yazılır, yanıt hemen gider, mikrofon BU olayın devamında açılır (K-PD-2). */
  accept(): void {
    const r = this.request;
    if (!r) return;
    const id = r.callId;
    this.request = null;
    this.consent = id;
    this.note = null;
    this.d.send({ t: "voice.answer", callId: id, accept: true });
    this.graph = this.d.createGraph();
    this.opening = true;
    this.d.onChange();
    this.d.getMic().then(
      (track) => {
        this.opening = false;
        if (this.consent !== id) return void track.stop(); // bu arada bitti / WS koptu
        this.mic = track;
        this.graph?.setMic(track);
        this.apply();
        this.d.onChange();
      },
      () => {
        this.opening = false;
        if (this.consent !== id) return;
        this.d.send({ t: "voice.end", callId: id, reason: "device" });
        this.release();
        this.note = "device";
        this.d.onChange();
      },
    );
  }

  reject(): void {
    const r = this.request;
    if (!r) return;
    this.request = null;
    this.d.send({ t: "voice.answer", callId: r.callId, accept: false });
    this.d.onChange();
  }

  /** Müşteri "Görüşmeyi bitir". */
  end(): void {
    const c = this.call;
    if (c?.phase === "active" && c.callId && this.consent === c.callId)
      this.d.send({ t: "voice.end", callId: c.callId, reason: "customer" });
    this.release();
    this.call = null;
    this.note = "ended";
    this.d.onChange();
  }

  setMuted(on: boolean): void {
    this.muted = on;
    if (this.mic) this.mic.enabled = !on;
    this.d.onChange();
  }

  /** Eş kuruldu/kapandı: graf ve gönderim kapısı yeniden uygulanır. */
  peersChanged(): void {
    this.apply();
  }

  /** Misafir WS kapandı (V-PD-7, O-PD-1): göndericiler hemen susar, mikrofon bırakılır, rıza silinir. */
  onWsClose(): void {
    if (this.mic) this.mic.enabled = false;
    this.request = null;
    if (this.consent) this.note = "ended";
    this.release();
    this.call = null;
    this.d.onChange();
  }

  /** Tek bırakma yolu: rıza silinir, mikrofon durur, graf kapanır, tüm ses göndericileri null. */
  private release(): void {
    this.consent = null;
    this.mic?.stop();
    this.mic = null;
    this.muted = false;
    this.graph?.close();
    this.graph = null;
    this.edges = [];
    this.sources.clear();
    this.outs.clear();
    for (const tid of this.d.peers.tids()) this.d.peers.setAudioOut(tid, null);
  }

  /** Plan → graf farkı (talkers'tan çıkan kaynak aynı tikte kopar) + gönderim kapısı. */
  private apply(): void {
    const c = this.call;
    const g = this.graph;
    const ok = c?.phase === "active" && this.consent === c.callId && this.mic !== null && g !== null;
    if (!ok || !g) {
      for (const tid of this.d.peers.tids()) this.d.peers.setAudioOut(tid, null);
      return;
    }
    const peers = this.d.peers.tids().filter((t) => this.d.peers.remoteAudio(t) !== null);
    const plan = mixPlan({ talkers: this.named(c.talkers), listeners: this.named(c.listeners), peers });
    this.syncSources(g, new Set(this.named(c.talkers).filter((t) => peers.includes(t))));
    const { drop, add } = diffEdges(this.edges, plan.edges);
    for (const e of drop) g.unlink(e);
    for (const tid of this.d.peers.tids()) {
      if (plan.send[tid]) {
        this.outs.add(tid);
        this.d.peers.setAudioOut(tid, g.output(tid));
      } else {
        this.d.peers.setAudioOut(tid, null);
        if (this.outs.delete(tid)) g.dropOutput(tid);
      }
    }
    for (const e of add) g.link(e);
    this.edges = plan.edges;
  }

  /** Kaynaklar yalnız talkers (D-PD-3); eş yeniden kurulup uzak iz değiştiyse eski düğüm ve kenarları önce sökülür. */
  private syncSources(g: VoiceGraph, want: ReadonlySet<string>): void {
    for (const [tid, tr] of [...this.sources]) {
      if (want.has(tid) && this.d.peers.remoteAudio(tid) === tr) continue;
      for (const e of this.edges.filter((x) => x.startsWith(`${tid}>`))) g.unlink(e);
      this.edges = this.edges.filter((x) => !x.startsWith(`${tid}>`));
      g.removeSource(tid);
      this.sources.delete(tid);
    }
    for (const tid of want) {
      const tr = this.d.peers.remoteAudio(tid);
      if (tr && !this.sources.has(tid)) {
        g.addSource(tid, tr);
        this.sources.set(tid, tr);
      }
    }
  }
}
