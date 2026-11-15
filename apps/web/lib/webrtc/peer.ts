/*
 * RTCPeerConnection sarmalayıcısı (mimari-protokol §3): offer'ı TEKNİSYEN oluşturur (recvonly video),
 * misafir answer verir ve ekran izini `replaceTrack` ile bağlar — paylaşım durdur/yeniden başlat yeniden
 * anlaşma gerektirmez. Uzak ICE adayları remoteDescription gelene dek kuyrukta bekler.
 * DataChannel'lar (P5): teknisyen ilk teklifte `ctl` + `file` açar; misafir `ondatachannel` ile alır, `input`'u
 * (tarayıcı modu, AC-34) kapatır. İki kanal da açılınca `onChannels` çağrılır.
 * P7: teknisyen AGENT misafire `input` kanalını da açar (`withInput`); açılınca `onInput` (§4.3).
 */
import { DC_LABELS } from "@remote/contracts/dc";
import type { IceServer } from "@remote/contracts/ws";

export interface Channels {
  ctl: RTCDataChannel;
  file: RTCDataChannel;
}

type SignalOut =
  | { t: "sdp.offer"; sdp: string }
  | { t: "sdp.answer"; sdp: string }
  | { t: "ice"; candidate: string; sdpMid?: string; sdpMLineIndex?: number };

export const toRtcIce = (s: IceServer[]): RTCIceServer[] =>
  s.map((x) => ({ urls: x.urls, ...(x.username ? { username: x.username } : {}), ...(x.credential ? { credential: x.credential } : {}) }));

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private queue: RTCIceCandidateInit[] = [];
  private dc: Partial<Channels> = {};
  /** ctl + file açıldığında (yeniden bağlanmada yeni PeerLink → yeni kanallar). */
  onChannels: ((c: Channels) => void) | null = null;
  /** P7: `input` kanalı açıldı / kapandı (null). */
  onInput: ((c: RTCDataChannel | null) => void) | null = null;
  private input: RTCDataChannel | null = null;

  constructor(
    iceServers: IceServer[],
    private send: (m: SignalOut) => void,
    private withInput = false,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: toRtcIce(iceServers) });
    this.pc.ondatachannel = (e) => this.adopt(e.channel);
    this.pc.onicecandidate = (e) => {
      const c = e.candidate;
      if (!c?.candidate) return;
      this.send({
        t: "ice",
        candidate: c.candidate,
        ...(c.sdpMid != null ? { sdpMid: c.sdpMid } : {}),
        ...(c.sdpMLineIndex != null ? { sdpMLineIndex: c.sdpMLineIndex } : {}),
      });
    };
  }

  private adopt(ch: RTCDataChannel) {
    if (ch.label === DC_LABELS.CTL) this.dc.ctl = ch;
    else if (ch.label === DC_LABELS.FILE) {
      ch.binaryType = "arraybuffer";
      this.dc.file = ch;
    } else return ch.close(); // input: tarayıcı modunda kabul edilmez (AC-34, G-09)
    const ready = () => {
      const { ctl, file } = this.dc;
      if (ctl?.readyState === "open" && file?.readyState === "open") this.onChannels?.({ ctl, file });
    };
    if (ch.readyState === "open") ready();
    else ch.addEventListener("open", ready, { once: true });
  }

  private videoTransceiver(): RTCRtpTransceiver | undefined {
    return this.pc.getTransceivers().find((tr) => tr.receiver.track.kind === "video");
  }

  /** Teknisyen: recvonly video teklifi. Dönen akış, karşı taraf izi bağladığında kare üretir. */
  async offer(iceRestart = false): Promise<MediaStream> {
    const tr = this.videoTransceiver() ?? this.pc.addTransceiver("video", { direction: "recvonly" });
    if (!this.dc.ctl) {
      this.adopt(this.pc.createDataChannel(DC_LABELS.CTL, { ordered: true }));
      this.adopt(this.pc.createDataChannel(DC_LABELS.FILE, { ordered: true }));
    }
    if (this.withInput && !this.input) {
      const ch = this.pc.createDataChannel(DC_LABELS.INPUT, { ordered: true });
      this.input = ch;
      ch.addEventListener("open", () => this.onInput?.(ch), { once: true });
      ch.addEventListener("close", () => this.onInput?.(null), { once: true });
    }
    const o = await this.pc.createOffer({ iceRestart });
    await this.pc.setLocalDescription(o);
    this.send({ t: "sdp.offer", sdp: o.sdp ?? "" });
    return new MediaStream([tr.receiver.track]);
  }

  async acceptAnswer(sdp: string): Promise<void> {
    if (this.pc.signalingState !== "have-local-offer") return;
    await this.pc.setRemoteDescription({ type: "answer", sdp });
    await this.flush();
  }

  /** Misafir: teklifi yanıtlar; video yönü sendonly, iz (varsa) bağlanır. */
  async answer(sdp: string, track: MediaStreamTrack | null): Promise<void> {
    await this.pc.setRemoteDescription({ type: "offer", sdp });
    await this.flush();
    const tr = this.videoTransceiver();
    if (tr) {
      tr.direction = "sendonly";
      await tr.sender.replaceTrack(track);
    }
    const a = await this.pc.createAnswer();
    await this.pc.setLocalDescription(a);
    this.send({ t: "sdp.answer", sdp: a.sdp ?? "" });
  }

  async setTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.videoTransceiver()?.sender.replaceTrack(track);
  }

  async addIce(c: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.queue.push(c);
      return;
    }
    await this.pc.addIceCandidate(c).catch(() => undefined);
  }

  private async flush(): Promise<void> {
    for (const c of this.queue.splice(0)) await this.pc.addIceCandidate(c).catch(() => undefined);
  }

  /** TURN credential yenilemesi (G-13). */
  setIceServers(s: IceServer[]): void {
    this.pc.setConfiguration({ ...this.pc.getConfiguration(), iceServers: toRtcIce(s) });
  }

  close(): void {
    this.pc.onicecandidate = null;
    this.pc.ondatachannel = null;
    this.onChannels = null;
    this.onInput = null;
    this.pc.close();
  }
}
