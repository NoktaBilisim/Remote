"use client";

/*
 * Teknisyen konsolu yan etkileri: /ws/tech (çerez), lobi yönetimi, offer (recvonly video), ICE yenileme.
 * Kendi WS kopması: üstel geri çekilmeyle yeniden bağlanır (sunucu 429/upgrade reddi tarayıcıda yalnız
 * kapanış olarak görünür); 120 sn içinde dönemezse "lost".
 * P7: uzaktan kontrol durumu (`control`, lib/control/machine.ts), AGENT misafire `input` DC, kontrol/monitör istekleri.
 * P7 düzeltme 1 (§3.3 K1/K2, S7-1/S7-2): "Kontrolü bırak" → `k.release_all` + `control.release`; "Vazgeç" →
 * `control.cancel`; beklenmeyen `control.state{GRANTED}` → yakalama yok + `control.release`.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { GuestKind, ServerOutbound } from "@remote/contracts/ws";
import { canCancel, canRelease, canRequest, canRequestMonitor, controlReducer, initialControl, isUnexpectedGrant, MONITOR_TIMEOUT_MS, type ControlCounters, type ControlEvent, type ControlState } from "../control/machine";
import { sendInput } from "../control/use-remote-input";
import { PeerLink, type Channels } from "./peer";
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

// TEST-P7-3: kontrol/monitör sayaçları sekmede (sessionStorage) — yenilemede sunucunun oturum sayacıyla uyumlu kalır
const ctlKey = (sessionId: string) => `rs.ctl.${sessionId}`;
function readCounters(sessionId: string): Partial<ControlCounters> | null {
  try {
    const raw = sessionStorage.getItem(ctlKey(sessionId));
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Partial<ControlCounters>) : null;
  } catch {
    return null; // depolama kapalı veya bozuk değer: sayaç sunucudan RATE_LIMITED ile düzelir
  }
}
function writeCounters(sessionId: string, c: ControlCounters | null) {
  try {
    if (c) sessionStorage.setItem(ctlKey(sessionId), JSON.stringify(c));
    else sessionStorage.removeItem(ctlKey(sessionId));
  } catch {
    /* depolama kapalı */
  }
}

export function useTechSession(sessionId: string) {
  const [state, dispatch] = useReducer(techReducer, initialTech);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const [maxFileMb, setMaxFileMb] = useState<number | undefined>(undefined);
  const [control, dispatchReducer] = useReducer(controlReducer, initialControl);
  const [input, setInput] = useState<RTCDataChannel | null>(null);
  const inputRef = useRef<RTCDataChannel | null>(null);
  /** Makinenin eşzamanlı kopyası: gönderim kararları (istek/bırak/vazgeç/beklenmeyen izin) render beklemeden verilir. */
  const ctl = useRef<ControlState>(control);
  const dispatchCtl = useCallback((e: ControlEvent) => {
    ctl.current = controlReducer(ctl.current, e);
    dispatchReducer(e);
  }, []);
  const kind = useRef<GuestKind | null>(null);
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
    setChannels(null);
    setPc(null);
    setInput(null);
    inputRef.current = null;
  }, []);

  const startPeer = useCallback(() => {
    resetPeer();
    // P7: input kanalı yalnız Hızlı Destek istemcisine (tarayıcı misafir kabul etmez, AC-34)
    const p = new PeerLink(ice.current, send, kind.current === "AGENT");
    peer.current = p;
    setPc(p.pc);
    p.onChannels = (c) => peer.current === p && setChannels(c);
    p.onInput = (c) => {
      if (peer.current !== p) return;
      inputRef.current = c;
      setInput(c);
    };
    p.pc.oniceconnectionstatechange = () => {
      if (p.pc.iceConnectionState === "failed" && peer.current === p) void p.offer(true).catch(() => undefined);
    };
    void p.offer().then((s) => peer.current === p && setStream(s), () => undefined);
  }, [resetPeer, send]);

  const onMessage = useCallback(
    (m: ServerOutbound) => {
      if (m.t === "hello") {
        retry.current.attempt = 0;
        kind.current = m.guestKind ?? kind.current;
        ice.current = m.iceServers;
        if (m.maxFileMb) setMaxFileMb(m.maxFileMb);
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
        kind.current = m.guestKind ?? kind.current;
        if (m.maxFileMb) setMaxFileMb(m.maxFileMb);
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
      // S7-2 / K2: istemediğimiz izinle yakalama başlamaz; sunucu ve müşteri kapısı da kapansın diye bırakılır
      if (isUnexpectedGrant(ctl.current, m)) sig.current?.send({ t: "control.release" });
      dispatchCtl({ type: "msg", m, now: Date.now() });
    },
    [dispatchCtl, resetPeer, sessionId, startPeer],
  );

  const connect = useCallback(() => {
    sig.current = new Signal(wsUrl(`/ws/tech?sessionId=${encodeURIComponent(sessionId)}`), undefined, {
      onMessage,
      onClose: (code) => {
        sig.current = null;
        resetPeer();
        dispatchCtl({ type: "closed", now: Date.now() });
        const now = Date.now();
        dispatch({ type: "closed", code, now });
        const s = techReducer(st.current, { type: "closed", code, now });
        st.current = s;
        if (s.phase === "ended" || s.reconnectSince === null) return;
        if (now - s.reconnectSince > RECONNECT_WINDOW_MS) return dispatch({ type: "giveUp" });
        retry.current.timer = setTimeout(() => reconnect.current(), backoff(retry.current.attempt++));
      },
    });
  }, [dispatchCtl, onMessage, resetPeer, sessionId]);

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

  useEffect(() => {
    const saved = readCounters(sessionId);
    if (saved) dispatchCtl({ type: "restore", saved, now: Date.now() });
  }, [dispatchCtl, sessionId]);
  const { requests, deniedAt, monitorRequests, monitorBlockedUntil } = control;
  useEffect(() => {
    if (state.phase === "ended") return writeCounters(sessionId, null);
    if (requests || monitorRequests || deniedAt || monitorBlockedUntil) writeCounters(sessionId, { requests, deniedAt, monitorRequests, monitorBlockedUntil });
  }, [deniedAt, monitorBlockedUntil, monitorRequests, requests, sessionId, state.phase]);

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

  // P7: istek yalnız makine kabul ederse gönderilir (≤5, ret sonrası 30 sn; sunucu yine otorite)
  const requestControl = useCallback(() => {
    const now = Date.now();
    if (!canRequest(ctl.current, now)) return;
    dispatchCtl({ type: "request", now });
    send({ t: "control.request" });
  }, [dispatchCtl, send]);
  const requestMonitor = useCallback((monitorId: number) => {
    const c = ctl.current;
    const now = Date.now();
    if (!canRequestMonitor(c, now) || monitorId === c.activeMonitor || !c.monitors.some((x) => x.id === monitorId)) return;
    dispatchCtl({ type: "monitor", id: monitorId, now });
    send({ t: "monitor.request", monitorId });
  }, [dispatchCtl, send]);
  // K1: bırakma = müşteri kapısını kapat. Takılı tuş kalmasın diye `k.release_all` kapı kapanmadan önce gider;
  // yakalama makine `granted`'dan çıkınca söker (use-remote-input temizliği). Devam = yeni `control.request`.
  const releaseControl = useCallback(() => {
    if (!canRelease(ctl.current)) return;
    sendInput(inputRef.current, { t: "k.release_all" });
    dispatchCtl({ type: "release", now: Date.now() });
    send({ t: "control.release" });
  }, [dispatchCtl, send]);
  // K2: bekleyen isteği geri çek (müşteri sonradan onaylayıp kapıyı açamasın)
  const cancelControl = useCallback(() => {
    if (!canCancel(ctl.current)) return;
    dispatchCtl({ type: "cancel", now: Date.now() });
    send({ t: "control.cancel" });
  }, [dispatchCtl, send]);

  const pendingAt = control.monitorPending?.at;
  useEffect(() => {
    if (pendingAt === undefined) return;
    const id = setTimeout(() => dispatchCtl({ type: "monitorTimeout", now: Date.now() }), Math.max(0, pendingAt + MONITOR_TIMEOUT_MS - Date.now()));
    return () => clearTimeout(id);
  }, [dispatchCtl, pendingAt]);

  return { state, stream, channels, pc, send, maxFileMb, admit, reject, end, control, input, requestControl, requestMonitor, releaseControl, cancelControl };
}
