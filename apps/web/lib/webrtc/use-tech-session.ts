"use client";

/*
 * Teknisyen konsolu yan etkileri: /ws/tech (çerez), lobi yönetimi, offer (recvonly video), ICE yenileme.
 * Kendi WS kopması: üstel geri çekilmeyle yeniden bağlanır (sunucu 429/upgrade reddi tarayıcıda yalnız
 * kapanış olarak görünür); 120 sn içinde dönemezse "lost".
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ServerOutbound } from "@remote/contracts/ws";
import { PeerLink } from "./peer";
import { backoff, RECONNECT_WINDOW_MS, Signal, wsUrl } from "./signal";
import { initialTech, techReducer, type TechState } from "./tech-machine";

const nameKey = (sessionId: string) => `rs.guestName.${sessionId}`;
function readName(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(nameKey(sessionId));
  } catch {
    return null; // depolama kapalı (gizli mod vb.): ad "Müşteri" kalır
  }
}
function writeName(sessionId: string, name: string | null) {
  try {
    if (name) sessionStorage.setItem(nameKey(sessionId), name);
    else sessionStorage.removeItem(nameKey(sessionId));
  } catch {
    /* depolama kapalı */
  }
}

export function useTechSession(sessionId: string) {
  const [state, dispatch] = useReducer(techReducer, initialTech);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const st = useRef<TechState>(state);
  const sig = useRef<Signal | null>(null);
  const peer = useRef<PeerLink | null>(null);
  const ice = useRef<Parameters<PeerLink["setIceServers"]>[0]>([]);
  const retry = useRef<{ timer?: ReturnType<typeof setTimeout>; attempt: number }>({ attempt: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnect = useRef<() => void>(() => undefined);

  useEffect(() => {
    st.current = state;
  }, [state]);

  const send = useCallback((m: Parameters<Signal["send"]>[0]) => sig.current?.send(m), []);

  const resetPeer = useCallback(() => {
    peer.current?.close();
    peer.current = null;
    setStream(null);
  }, []);

  const startPeer = useCallback(() => {
    resetPeer();
    const p = new PeerLink(ice.current, send);
    peer.current = p;
    p.pc.oniceconnectionstatechange = () => {
      if (p.pc.iceConnectionState === "failed" && peer.current === p) void p.offer(true).catch(() => undefined);
    };
    void p.offer().then((s) => peer.current === p && setStream(s), () => undefined);
  }, [resetPeer, send]);

  const onMessage = useCallback(
    (m: ServerOutbound) => {
      if (m.t === "hello") {
        retry.current.attempt = 0;
        ice.current = m.iceServers;
        if (m.maxEndsAt !== null && m.peerPresent) startPeer();
        if (m.maxEndsAt !== null) {
          dispatch({ type: "msg", m, now: Date.now() });
          return dispatch({ type: "restoreName", name: readName(sessionId) });
        }
      } else if (m.t === "ice.servers") {
        ice.current = m.iceServers;
        peer.current?.setIceServers(m.iceServers);
        // G-13: credential yenilemesinden sonra ICE restart — yalnız kurulmuş bağlantıda (admit anındaki
        // ilk ice.servers, ilk teklif yanıtlanmadan ikinci teklif üretip yarış yaratmasın)
        const p = peer.current;
        if (p && p.pc.signalingState === "stable" && p.pc.remoteDescription) void p.offer(true).catch(() => undefined);
      } else if (m.t === "peer.joined" && m.role === "guest") {
        startPeer();
      } else if (m.t === "peer.left" && m.role === "guest") {
        resetPeer();
      } else if (m.t === "sdp.answer") {
        void peer.current?.acceptAnswer(m.sdp).catch(() => undefined);
      } else if (m.t === "ice") {
        const { candidate, sdpMid, sdpMLineIndex } = m;
        void peer.current?.addIce({ candidate, sdpMid, sdpMLineIndex });
      }
      dispatch({ type: "msg", m, now: Date.now() });
    },
    [resetPeer, sessionId, startPeer],
  );

  const connect = useCallback(() => {
    sig.current = new Signal(wsUrl(`/ws/tech?sessionId=${encodeURIComponent(sessionId)}`), undefined, {
      onMessage,
      onClose: (code) => {
        sig.current = null;
        resetPeer();
        const now = Date.now();
        dispatch({ type: "closed", code, now });
        const s = techReducer(st.current, { type: "closed", code, now });
        st.current = s;
        if (s.phase === "ended" || s.reconnectSince === null) return;
        if (now - s.reconnectSince > RECONNECT_WINDOW_MS) return dispatch({ type: "giveUp" });
        retry.current.timer = setTimeout(() => reconnect.current(), backoff(retry.current.attempt++));
      },
    });
  }, [onMessage, resetPeer, sessionId]);

  useEffect(() => {
    reconnect.current = connect;
    const r = retry.current;
    clearTimeout(closeTimer.current);
    if (!sig.current && st.current.phase !== "ended") connect();
    return () => {
      closeTimer.current = setTimeout(() => {
        clearTimeout(r.timer);
        sig.current?.close();
        sig.current = null;
        resetPeer();
      }, 0);
    };
  }, [connect, resetPeer]);

  // Kabul edilen müşterinin adı yalnız bu sekmede (sessionStorage) tutulur; konsol yenilenince geri yüklenir, bitişte silinir
  const guestName = state.guest?.name ?? null;
  useEffect(() => {
    if (state.phase === "ended") writeName(sessionId, null);
    else if (guestName) writeName(sessionId, guestName);
  }, [guestName, sessionId, state.phase]);

  useEffect(() => {
    if (state.phase !== "ended") return;
    clearTimeout(retry.current.timer);
    const s = sig.current;
    sig.current = null;
    s?.close();
    peer.current?.close();
    peer.current = null;
  }, [state.phase]);

  const admit = useCallback((admitCode: string) => {
    dispatch({ type: "admit" });
    send({ t: "guest.admit", admitCode });
  }, [send]);
  const reject = useCallback((guestId: string) => {
    dispatch({ type: "reject" });
    send({ t: "guest.reject", guestId });
  }, [send]);
  const end = useCallback(() => send({ t: "session.end" }), [send]);

  return { state, stream, admit, reject, end };
}
