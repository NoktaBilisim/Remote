"use client";

/*
 * P28d konsol sesli görüşme yan etkileri (mimari-p28d r2 §4.2, §4.3, §8; AC-373, 374, 378; D-PD-5).
 * Durum saf reducer'dan (`console.ts`); sunucu mesajları konsol açılır açılmaz `subscribe` ile dinlenir (yeni katılan teknisyene
 * `voice.state` roster'dan hemen sonra gelir — koşullu çizilen bir bileşen bunu kaçırırdı).
 * Mikrofon: düğmede `getUserMedia` (izin yoksa istek GİTMEZ, AC-373) → `voice.request` / `voice.join`; iz eşe YALNIZ
 * `talkers ∋ ben` iken bağlanır (`micLive`). Tek `releaseMic()` (`track.stop()` + `replaceTrack(null)`): `micWanted` düştüğünde
 * (bitiş, ret, zaman aşımı, hata, rol/üyelik kaybı), `pagehide`, kendi WS kopması, oda bitişi ve söküm.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ServerOutbound } from "@remote/contracts/ws";
import type { Signal } from "../webrtc/signal";
import { consoleVoiceReducer, initialConsoleVoice, micLive, micWanted, type ConsoleVoice, type VoiceEnded } from "./console";

export interface ConsoleVoiceDeps {
  subscribe: (fn: (m: ServerOutbound) => void) => () => void;
  send: (m: Parameters<Signal["send"]>[0]) => void;
  setVoiceTrack: (track: MediaStreamTrack | null) => void;
  /** Kendi oda kimliğim (`hello.tid`); eski sunucuda null → ses arayüzü gizli. */
  me: string | null;
  /** Kendi WS'imiz bağlı ve oturum canlı (kopukluk / bitiş → mikrofon bırakılır). */
  connected: boolean;
  /** `getUserMedia` (test enjekte eder). */
  getMic?: () => Promise<MediaStreamTrack>;
}

async function browserMic(): Promise<MediaStreamTrack> {
  const s = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const tr = s.getAudioTracks()[0];
  if (!tr) throw new Error("ses izi yok");
  return tr;
}

export interface ConsoleVoiceApi {
  s: ConsoleVoice;
  request: () => void;
  join: () => void;
  end: () => void;
  mute: (on: boolean) => void;
}

export function useConsoleVoice(d: ConsoleVoiceDeps): ConsoleVoiceApi & { ended: VoiceEnded | null } {
  const [s, dispatch] = useReducer(consoleVoiceReducer, initialConsoleVoice);
  const sRef = useRef(s);
  const meRef = useRef(d.me);
  const mic = useRef<MediaStreamTrack | null>(null);
  const deps = useRef(d);
  useEffect(() => {
    sRef.current = s;
    meRef.current = d.me;
    deps.current = d;
  });

  /** Tek bırakma yolu (D-PD-5). */
  const releaseMic = useCallback(() => {
    const tr = mic.current;
    mic.current = null;
    deps.current.setVoiceTrack(null);
    tr?.stop();
  }, []);

  useEffect(
    () =>
      d.subscribe((m) => {
        if (m.t === "voice.state") dispatch({ type: "state", m, me: meRef.current, now: Date.now() });
        else if (m.t === "error") dispatch({ type: "error", code: m.code, now: Date.now() });
      }),
    [d.subscribe], // eslint-disable-line react-hooks/exhaustive-deps -- abonelik konsol ömrü boyunca bir kez
  );

  // Kendi WS kopması / oda bitişi: sunucu durumu bilinmez → yerel durum sıfır, mikrofon bırakılır
  useEffect(() => {
    if (!d.connected) {
      dispatch({ type: "closed" });
      releaseMic();
    }
  }, [d.connected, releaseMic]);

  // Mikrofon kararı: tutulmalı mı (yoksa bırak) ve eşe bağlanmalı mı (yalnız talkers ∋ ben)
  const wanted = micWanted(s, d.me);
  const live = micLive(s, d.me);
  useEffect(() => {
    if (!wanted && mic.current) releaseMic();
  }, [wanted, releaseMic]);
  useEffect(() => {
    const tr = mic.current;
    if (live && tr) {
      tr.enabled = !s.muted;
      d.setVoiceTrack(tr);
    } else d.setVoiceTrack(null);
  }, [live, s.muted, d.setVoiceTrack]); // eslint-disable-line react-hooks/exhaustive-deps -- yalnız karar değişiminde

  // Sekme kapanışı ve söküm: mikrofon hemen bırakılır
  useEffect(() => {
    window.addEventListener("pagehide", releaseMic);
    return () => {
      window.removeEventListener("pagehide", releaseMic);
      releaseMic();
    };
  }, [releaseMic]);

  /** İzin al → (bayat değilse) mesaj gönder. İzin yoksa mesaj gitmez (AC-373). */
  const withMic = useCallback((phase: "mic" | "joinMic", next: "sent" | "joining", msg: () => Parameters<Signal["send"]>[0] | null) => {
    if (sRef.current.local !== "idle") return;
    dispatch({ type: "local", local: phase });
    sRef.current = { ...sRef.current, local: phase };
    void (deps.current.getMic ?? browserMic)().then(
      (tr) => {
        const m = sRef.current.local === phase && deps.current.connected ? msg() : null;
        if (!m) {
          tr.stop(); // bu arada bitti / koptu / görüşme değişti
          if (sRef.current.local === phase) dispatch({ type: "local", local: "idle" });
          return;
        }
        mic.current?.stop();
        mic.current = tr;
        deps.current.send(m);
        dispatch({ type: "local", local: next });
      },
      () => dispatch({ type: "micDenied" }),
    );
  }, []);

  const request = useCallback(() => withMic("mic", "sent", () => ({ t: "voice.request" })), [withMic]);
  const join = useCallback(
    () =>
      withMic("joinMic", "joining", () => {
        const c = sRef.current.call;
        return c?.phase === "active" && c.callId ? { t: "voice.join", callId: c.callId } : null;
      }),
    [withMic],
  );
  const end = useCallback(() => {
    const c = sRef.current.call;
    if (c && c.phase !== "idle" && c.callId) deps.current.send({ t: "voice.end", callId: c.callId });
    releaseMic(); // ≤ 1 sn: sunucu yanıtını beklemeden
  }, [releaseMic]);
  const mute = useCallback((on: boolean) => {
    if (mic.current) mic.current.enabled = !on;
    dispatch({ type: "mute", on });
  }, []);

  return { s, request, join, end, mute, ended: s.ended };
}
