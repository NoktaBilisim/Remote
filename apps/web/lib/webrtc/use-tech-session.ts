"use client";

/*
 * Teknisyen konsolu yan etkileri: /ws/tech (çerez), lobi yönetimi, offer (recvonly video), ICE yenileme.
 * Kendi WS kopması: üstel geri çekilmeyle yeniden bağlanır (sunucu 429/upgrade reddi tarayıcıda yalnız
 * kapanış olarak görünür); 120 sn içinde dönemezse "lost".
 * P7: uzaktan kontrol durumu (`control`, lib/control/machine.ts), AGENT misafire `input` DC, kontrol/monitör istekleri.
 * P7 düzeltme 1 (§3.3 K1/K2, S7-1/S7-2): "Kontrolü bırak" → `k.release_all` + `control.release`; "Vazgeç" →
 * `control.cancel`; beklenmeyen `control.state{GRANTED}` → yakalama yok + `control.release`.
 * Parçalar: PeerConnection `use-tech-peer.ts`, kontrol `use-tech-control.ts`, ortak WS başı `use-signal-base.ts`.
 */
import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";
import { WS_SUBPROTOCOL, type ServerOutbound } from "@remote/contracts/ws";
import { techProtocols } from "../rec/support";
import { isUnexpectedGrant, type ControlEvent, type ControlState } from "../control/machine";
import { backoff, RECONNECT_WINDOW_MS, Signal, wsUrl } from "./signal";
import { iceGate, initialIceGate, initialTech, techReducer, type IceGate, type TechEvent, type TechState } from "./tech-machine";
import type { PeerLink } from "./peer";
import { useControlActions, useControlCounters, useControlMachine } from "./use-tech-control";
import { useTechPeer } from "./use-tech-peer";

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

/** Kabul edilen müşterinin adı yalnız bu sekmede (sessionStorage) tutulur; konsol yenilenince geri yüklenir, bitişte silinir. */
function useGuestNameStore(sessionId: string, guestName: string | null, phase: TechState["phase"]) {
  useEffect(() => {
    if (phase === "ended") writeName(sessionId, null);
    else if (guestName) writeName(sessionId, guestName);
  }, [guestName, sessionId, phase]);
}

export function useTechSession(sessionId: string) {
  const [state, dispatch] = useReducer(techReducer, initialTech);
  const { control, ctl, dispatchCtl } = useControlMachine();
  const st = useRef<TechState>(state);
  const sig = useRef<Signal | null>(null);
  const peer = useRef<PeerLink | null>(null);
  const retry = useRef<Retry>({ attempt: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** İlk teklif admit sonrası ICE listesi gelene kadar ertelenir (TURN'süz ilk teklif düzeltmesi, tech-machine `iceGate`). */
  const gate = useRef<IceGate>(initialIceGate);
  const reconnect = useRef<() => void>(() => undefined);
  /** P28a: pano/yazdırma gibi ayrı kancaların sunucu mesajı aboneleri (makine dışı yan etkiler). */
  const subs = useRef(new Set<(m: ServerOutbound) => void>());

  useEffect(() => {
    st.current = state;
  }, [state]);

  const send = useCallback((m: Parameters<Signal["send"]>[0]) => sig.current?.send(m), []);
  const link = useTechPeer(peer, send);
  const { resetPeer, onPeerMsg } = link;

  const onMessage = useCallback(
    (m: ServerOutbound) => {
      const refs = { gateRef: gate, retryRef: retry, sigRef: sig, ctlRef: ctl };
      handleMessage(m, refs, { onPeerMsg, dispatch, dispatchCtl, sessionId });
      for (const fn of subs.current) fn(m);
    },
    [ctl, dispatchCtl, onPeerMsg, sessionId],
  );

  const onClose = useCallback(
    (code: number) => {
      const refs = { sigRef: sig, gateRef: gate, stRef: st, retryRef: retry, reconnectRef: reconnect };
      handleClose(code, refs, () => resetPeer(), dispatchCtl, dispatch);
    },
    [dispatchCtl, resetPeer],
  );

  const connect = useCallback(() => {
    // P28e (§6.1): VP8 kaydedebilen konsol `rs.cap.rec1` bildirir (alt protokol `rs.v1` + belirteç); diğerleri alt protokolsüz
    const protocols = techProtocols(WS_SUBPROTOCOL);
    sig.current = new Signal(wsUrl(`/ws/tech?sessionId=${encodeURIComponent(sessionId)}`), protocols, { onMessage, onClose });
  }, [onClose, onMessage, sessionId]);

  useEffect(() => {
    reconnect.current = connect;
    const r = retry.current;
    clearTimeout(closeTimer.current);
    if (!sig.current && st.current.phase !== "ended") connect();
    return () => {
      closeTimer.current = setTimeout(() => {
        clearTimeout(r.timer);
        closeSignal(sig);
        resetPeer();
      }, 0);
    };
  }, [connect, resetPeer]);

  useControlCounters(sessionId, control, state.phase, dispatchCtl);
  useGuestNameStore(sessionId, state.guest?.name ?? null, state.phase);

  useEffect(() => {
    if (state.phase === "ended") closeOnEnd(retry, sig, peer);
  }, [state.phase]);

  const lobby = useLobbyActions(dispatch, send);
  const actions = useControlActions(ctl, dispatchCtl, send, link.inputRef, control.monitorPending?.at);

  const subscribe = useCallback((fn: (m: ServerOutbound) => void) => {
    subs.current.add(fn);
    return () => void subs.current.delete(fn);
  }, []);

  const { stream, channels, pc, maxFileMb, input } = link;
  return { state, stream, channels, pc, send, subscribe, maxFileMb, ...lobby, control, input, ...actions };
}

function useLobbyActions(dispatch: (e: { type: "admit" } | { type: "reject" }) => void, send: (m: Parameters<Signal["send"]>[0]) => void) {
  const admit = useCallback(
    (admitCode: string) => {
      dispatch({ type: "admit" });
      send({ t: "guest.admit", admitCode });
    },
    [dispatch, send],
  );
  const reject = useCallback(
    (guestId: string) => {
      dispatch({ type: "reject" });
      send({ t: "guest.reject", guestId });
    },
    [dispatch, send],
  );
  const end = useCallback(() => send({ t: "session.end" }), [send]);
  return { admit, reject, end };
}

type Retry = { timer?: ReturnType<typeof setTimeout>; attempt: number };

/**
 * WS'i kapatır. `detachFirst`: referans kapatmadan önce boşaltılır (oturum sonu — kapanış olayı yeni bağlantı
 * kurmasın); aksi halde önce kapatılır (StrictMode söküm sırası).
 */
function closeSignal(sigRef: RefObject<Signal | null>, detachFirst = false) {
  if (detachFirst) {
    const s = sigRef.current;
    sigRef.current = null;
    s?.close();
    return;
  }
  sigRef.current?.close();
  sigRef.current = null;
}

/** Kendi WS'imiz kapandı: makineler kapanışı işler; bitmediyse 120 sn pencerede üstel geri çekilmeyle yeniden bağlan. */
function handleClose(
  code: number,
  r: {
    sigRef: RefObject<Signal | null>;
    gateRef: RefObject<IceGate>;
    stRef: RefObject<TechState>;
    retryRef: RefObject<Retry>;
    reconnectRef: RefObject<() => void>;
  },
  resetPeer: () => void,
  dispatchCtl: (e: ControlEvent) => void,
  dispatch: (e: TechEvent) => void,
) {
  r.sigRef.current = null;
  r.gateRef.current = initialIceGate;
  resetPeer();
  dispatchCtl({ type: "closed", now: Date.now() });
  const now = Date.now();
  dispatch({ type: "closed", code, now });
  const s = techReducer(r.stRef.current, { type: "closed", code, now });
  r.stRef.current = s;
  if (s.phase === "ended" || s.reconnectSince === null) return;
  if (now - s.reconnectSince > RECONNECT_WINDOW_MS) return dispatch({ type: "giveUp" });
  r.retryRef.current.timer = setTimeout(() => r.reconnectRef.current(), backoff(r.retryRef.current.attempt++));
}

/** Oturum bitti: yeniden deneme durur, WS (önce referans boşaltılarak) ve PeerConnection kapanır. */
function closeOnEnd(retryRef: RefObject<Retry>, sigRef: RefObject<Signal | null>, peerRef: RefObject<PeerLink | null>) {
  clearTimeout(retryRef.current.timer);
  closeSignal(sigRef, true);
  peerRef.current?.close();
  peerRef.current = null;
}

/**
 * Sunucu mesajı: ICE kapısı → peer işleri → makineler. Etkin `hello` sonrası ad sekme belleğinden geri yüklenir ve kontrol
 * makinesine iletilmez. S7-2 / K2: istemediğimiz izinle yakalama başlamaz; sunucu ve müşteri kapısı da kapansın diye bırakılır.
 */
function handleMessage(
  m: ServerOutbound,
  r: { gateRef: RefObject<IceGate>; retryRef: RefObject<Retry>; sigRef: RefObject<Signal | null>; ctlRef: RefObject<ControlState> },
  h: {
    onPeerMsg: (m: ServerOutbound, start: boolean) => void;
    dispatch: (e: TechEvent) => void;
    dispatchCtl: (e: ControlEvent) => void;
    sessionId: string;
  },
) {
  const g = iceGate(r.gateRef.current, m);
  r.gateRef.current = g.gate;
  if (m.t === "hello") r.retryRef.current.attempt = 0;
  h.onPeerMsg(m, g.start);
  if (m.t === "hello" && m.maxEndsAt !== null) {
    h.dispatch({ type: "msg", m, now: Date.now() });
    return h.dispatch({ type: "restoreName", name: readName(h.sessionId) });
  }
  h.dispatch({ type: "msg", m, now: Date.now() });
  if (isUnexpectedGrant(r.ctlRef.current, m)) r.sigRef.current?.send({ t: "control.release" });
  h.dispatchCtl({ type: "msg", m, now: Date.now() });
}
