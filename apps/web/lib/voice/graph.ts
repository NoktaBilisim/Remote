/*
 * P28d tarayıcı WebAudio grafı (mimari-p28d r2 §4.3, D-PD-3). `AudioContext` yalnız "Kabul et" tıklamasında kurulur
 * (autoplay kuralı + K-PD-2). Her uzak ses izi `muted` bir `<audio>` öğesine bağlanır (Chrome: uzak WebRTC izi bir medya
 * öğesine bağlı değilse WebAudio'ya ses vermez); hoparlöre yalnız WebAudio grafından (Σ talkers) çıkar.
 */
import { MIC, SPEAKER } from "./mix";
import type { VoiceGraph } from "./guest";

export function createWebAudioGraph(): VoiceGraph {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  void ctx.resume().catch(() => undefined);
  let mic: MediaStreamAudioSourceNode | null = null;
  const src = new Map<string, { node: MediaStreamAudioSourceNode; el: HTMLAudioElement }>();
  const out = new Map<string, MediaStreamAudioDestinationNode>();

  const node = (name: string, from: boolean): AudioNode | null => {
    if (from) return name === MIC ? mic : (src.get(name)?.node ?? null);
    return name === SPEAKER ? ctx.destination : (out.get(name) ?? null);
  };
  const pair = (edge: string): [AudioNode | null, AudioNode | null] => {
    const [a = "", b = ""] = edge.split(">");
    return [node(a, true), node(b, false)];
  };

  return {
    setMic(track) {
      mic?.disconnect();
      mic = ctx.createMediaStreamSource(new MediaStream([track]));
    },
    addSource(tid, track) {
      const stream = new MediaStream([track]);
      const el = new Audio();
      el.muted = true;
      el.srcObject = stream;
      void el.play().catch(() => undefined);
      src.set(tid, { node: ctx.createMediaStreamSource(stream), el });
    },
    removeSource(tid) {
      const s = src.get(tid);
      if (!s) return;
      s.node.disconnect();
      s.el.srcObject = null;
      src.delete(tid);
    },
    output(tid) {
      let d = out.get(tid);
      if (!d) {
        d = ctx.createMediaStreamDestination();
        out.set(tid, d);
      }
      return d.stream.getAudioTracks()[0] as MediaStreamTrack;
    },
    dropOutput(tid) {
      const d = out.get(tid);
      if (!d) return;
      for (const tr of d.stream.getTracks()) tr.stop();
      out.delete(tid);
    },
    link(edge) {
      const [a, b] = pair(edge);
      if (a && b) a.connect(b);
    },
    unlink(edge) {
      const [a, b] = pair(edge);
      if (!a || !b) return;
      try {
        a.disconnect(b);
      } catch {
        /* bağlı değildi */
      }
    },
    close() {
      for (const tid of [...src.keys()]) this.removeSource(tid);
      for (const tid of [...out.keys()]) this.dropOutput(tid);
      mic?.disconnect();
      mic = null;
      void ctx.close().catch(() => undefined);
    },
  };
}
