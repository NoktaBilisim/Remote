/*
 * RTCPeerConnection sarmalayıcısı (mimari-protokol §3): offer'ı TEKNİSYEN oluşturur (recvonly video),
 * misafir answer verir ve ekran izini `replaceTrack` ile bağlar — paylaşım durdur/yeniden başlat yeniden
 * anlaşma gerektirmez. Uzak ICE adayları remoteDescription gelene dek kuyrukta bekler.
 * DataChannel'lar (ctl/file/input) P5/P7.
 */
import type { IceServer } from "@remote/contracts/ws";

type SignalOut =
  | { t: "sdp.offer"; sdp: string }
  | { t: "sdp.answer"; sdp: string }
  | { t: "ice"; candidate: string; sdpMid?: string; sdpMLineIndex?: number };

export const toRtcIce = (s: IceServer[]): RTCIceServer[] =>
  s.map((x) => ({ urls: x.urls, ...(x.username ? { username: x.username } : {}), ...(x.credential ? { credential: x.credential } : {}) }));

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private queue: RTCIceCandidateInit[] = [];

  constructor(iceServers: IceServer[], private send: (m: SignalOut) => void) {
    this.pc = new RTCPeerConnection({ iceServers: toRtcIce(iceServers) });
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

  private videoTransceiver(): RTCRtpTransceiver | undefined {
    return this.pc.getTransceivers().find((tr) => tr.receiver.track.kind === "video");
  }

  /** Teknisyen: recvonly video teklifi. Dönen akış, karşı taraf izi bağladığında kare üretir. */
  async offer(iceRestart = false): Promise<MediaStream> {
    const tr = this.videoTransceiver() ?? this.pc.addTransceiver("video", { direction: "recvonly" });
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
    this.pc.close();
  }
}
