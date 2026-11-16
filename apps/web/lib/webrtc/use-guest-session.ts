"use client";

/*
 * Misafir oturumu yan etkileri: WS (ticket → lobi → hello), yeniden bağlanma (reconnectToken, 120 sn),
 * RTCPeerConnection (teknisyenin teklifine yanıt), getDisplayMedia (yalnız kullanıcı tıklamasıyla).
 * Ticket yalnız bellekte; reconnect token'ı URL'e/loga yazılmaz — F5 dönüşü için yalnız sekme deposuna (guest-resume.ts,
 * TEST-P4-1) GuestSession yazar. Dönüşte paylaşım otomatik başlamaz (getDisplayMedia yalnız kullanıcı tıklamasıyla).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { TechRosterEntry } from "@remote/contracts/ws-multi";
import type { ChatHub } from "../dc/use-collab";
import type { Channels } from "./peer";
import { GuestPeers, type GuestChatIn } from "./guest-peers";
import { backoff, guestProtocols, RECONNECT_WINDOW_MS, Signal, wsUrl } from "./signal";
import { guestReducer, initialGuest, resumingGuest, type GuestState } from "./guest-machine";
import type { PublicSessionStatusResponse } from "@remote/contracts/api/sessions";
import { WS_CLOSE, type Cap, type ServerOutbound } from "@remote/contracts/ws";
import type { FileMode } from "@remote/contracts/ws-fsrv";
import { api, ApiError } from "../api";

/**
 * F5 dönüşü reddedilirse (eski soket sunucuda henüz kapanmamış → 403 = tarayıcıda 1006) aralıklı yeniden dene;
 * kesin sonlarda (4401/1008, session.ended, oturum ACTIVE değil/404) dur. S-P4-T3-2: pencere sunucunun ölü soket
 * süresini (ping 30 sn × 3 ≈ 90 sn) + pay kapsar: 35 × 3 sn = 105 sn ≥ 100 sn, 120 sn yeniden bağlanma penceresi içinde.
 */
const RESUME_RETRY_MS = 3_000;
const RESUME_MAX_ATTEMPTS = 35;

/** Oturum hâlâ aktif mi? Ağ hatasında belirsiz → true (yeniden denemeye devam). */
async function stillActive(sessionRef: string): Promise<boolean> {
  try {
    const r = await api<PublicSessionStatusResponse>("GET", `/public/sessions/status?ref=${encodeURIComponent(sessionRef)}`);
    return r.status === "ACTIVE";
  } catch (e) {
    return !(e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429);
  }
}

export type ShareResult = "ok" | "denied" | "unsupported";

export type GuestCred = { ticket: string } | { reconnect: string };

export function useGuestSession(cred: GuestCred, sessionRef: string | null = null) {
  const [state, dispatch] = useReducer(guestReducer, "reconnect" in cred ? resumingGuest : initialGuest);
  const credKey = "ticket" in cred ? `t.${cred.ticket}` : `r.${cred.reconnect}`;
  const [preview, setPreview] = useState<MediaStream | null>(null);
  /** G-09: teknisyenin yetenekleri (hello.caps); yoksa ilgili DC istekleri reddedilir. */
  const [caps, setCaps] = useState<Cap[]>([]);
  const [maxFileMb, setMaxFileMb] = useState<number | undefined>(undefined);
  /** P28b (§5.1): `hello.fileMode` (yalnız yetenekli sokete gelir; tarayıcı misafiri yeteneklidir). Yoksa P2P. */
  const [fileMode, setFileMode] = useState<FileMode>("P2P");
  /** P28b: `fsrv.*` gibi ayrı kancaların sunucu mesajı aboneleri. */
  const subs = useRef(new Set<(m: ServerOutbound) => void>());
  const st = useRef<GuestState>(state);
  const sig = useRef<Signal | null>(null);
  /** P28c: bağlı teknisyenler (multi1 roster); eski sunucuda null. */
  const [roster, setRoster] = useState<TechRosterEntry[] | null>(null);
  const [peerTick, setPeerTick] = useState(0);
  const chatSubs = useRef(new Set<(m: GuestChatIn) => void>());
  const track = useRef<MediaStreamTrack | null>(null);
  const rosterRef = useRef<TechRosterEntry[] | null>(null);
  const retry = useRef<{ timer?: ReturnType<typeof setTimeout>; attempt: number }>({ attempt: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnect = useRef<(token: string) => void>(() => undefined);
  const resumeTries = useRef(0);
  const resumeToken = useRef("reconnect" in cred ? cred.reconnect : null);

  useEffect(() => {
    st.current = state;
  }, [state]);

  const send = useCallback((m: Parameters<Signal["send"]>[0]) => sig.current?.send(m), []);
  const peers = usePeers(st, send, setPeerTick, chatSubs);

  const resetPeer = useCallback(() => peers.closeAll(), [peers]);

  // Ana eş (kontrol sahibi) kanalları: dosya/işaretleme (P28c §4.5); eş değişimi `peerTick` ile yeniden okunur
  // eslint-disable-next-line react-hooks/exhaustive-deps -- peerTick: GuestPeers dış durumu
  const channels: Channels | null = useMemo(() => peers.main(), [peers, peerTick]);

  const onMessage = useCallback(
    (m: ServerOutbound) => {
      if (m.t === "hello") {
        retry.current.attempt = 0;
        resetPeer(); // yeni bağlantı = yeni PeerConnection (AC-24)
        setCaps(m.caps ?? []);
        setMaxFileMb(m.maxFileMb);
        setFileMode(m.fileMode ?? "P2P");
        if (track.current) send({ t: "share.state", state: "sharing" });
      } else if (m.t === "peer.joined" || m.t === "peer.left") {
        if (m.role === "tech") resetPeer();
        // Yeniden bağlanan teknisyen paylaşım durumunu bilmez (sunucu saklamaz) → tekrar bildir
        if (m.t === "peer.joined" && m.role === "tech" && track.current) send({ t: "share.state", state: "sharing" });
      } else if (m.t === "techs.roster") {
        // P28c: yeni bağlanan teknisyen de paylaşım durumunu bilmez → tekrar bildir
        const before = new Set((rosterRef.current ?? []).filter((e) => e.connected).map((e) => e.tid));
        rosterRef.current = m.techs;
        peers.onRoster(m.techs);
        setRoster(m.techs);
        if (track.current && m.techs.some((e) => e.connected && !before.has(e.tid))) send({ t: "share.state", state: "sharing" });
      } else if (m.t === "sdp.offer") {
        peers.offer(m.from, m.sdp);
      } else if (m.t === "ice") {
        const { candidate, sdpMid, sdpMLineIndex } = m;
        peers.ice(m.from, { candidate, sdpMid, sdpMLineIndex });
      } else if (m.t === "ice.servers") {
        peers.setIceServers(m.iceServers);
      }
      // onClose aynı tikte okuyabilsin (session.ended sonrası yeniden deneme olmasın)
      st.current = guestReducer(st.current, { type: "msg", m });
      dispatch({ type: "msg", m });
      for (const fn of subs.current) fn(m);
    },
    [peers, resetPeer, send],
  );

  const connect = useCallback(
    (cred: { ticket: string } | { reconnect: string }) => {
      sig.current = new Signal(wsUrl("/ws/guest"), guestProtocols(cred), {
        onMessage,
        onClose: (code) => {
          sig.current = null;
          resetPeer();
          const cur = st.current;
          const rt = resumeToken.current;
          if (rt && cur.resuming && cur.phase === "connecting") {
            const hard = code === WS_CLOSE.AUTH_REVOKED || code === WS_CLOSE.POLICY || code === WS_CLOSE.TOO_BIG;
            if (!hard && sessionRef && resumeTries.current < RESUME_MAX_ATTEMPTS) {
              resumeTries.current++;
              void stillActive(sessionRef).then((ok) => {
                if (st.current.phase !== "connecting") return;
                if (!ok) return dispatch({ type: "closed", code, now: Date.now() });
                retry.current.timer = setTimeout(() => reconnect.current(rt), RESUME_RETRY_MS);
              });
              return;
            }
          }
          dispatch({ type: "closed", code, now: Date.now() });
          const s = guestReducer(st.current, { type: "closed", code, now: Date.now() });
          st.current = s;
          if (s.phase !== "live" || !s.reconnectToken || s.reconnectSince === null) return;
          if (Date.now() - s.reconnectSince > RECONNECT_WINDOW_MS) return dispatch({ type: "giveUp" });
          const token = s.reconnectToken;
          retry.current.timer = setTimeout(() => reconnect.current(token), backoff(retry.current.attempt++));
        },
      });
    },
    [onMessage, resetPeer, sessionRef],
  );

  // StrictMode'un çift mount'unda tek kullanımlık ticket ikinci kez harcanmasın
  useEffect(() => {
    const c: GuestCred = credKey.startsWith("t.") ? { ticket: credKey.slice(2) } : { reconnect: credKey.slice(2) };
    reconnect.current = (token) => connect({ reconnect: token });
    const r = retry.current;
    clearTimeout(closeTimer.current);
    if (!sig.current && st.current.phase === "connecting") connect(c);
    return () => {
      closeTimer.current = setTimeout(() => {
        clearTimeout(r.timer);
        sig.current?.close();
        sig.current = null;
        resetPeer();
        track.current?.stop();
      }, 0);
    };
  }, [connect, resetPeer, credKey]);

  // Oturum bittiğinde paylaşım ve bağlantılar hemen kapanır (AC-107)
  useEffect(() => {
    if (state.phase !== "ended") return;
    clearTimeout(retry.current.timer);
    track.current?.stop();
    track.current = null;
    resetPeer();
    const s = sig.current;
    sig.current = null;
    s?.close();
  }, [state.phase, resetPeer]);

  const stopShare = useCallback(() => {
    track.current?.stop();
    track.current = null;
    setPreview(null);
    void peers.setTrack(null);
    send({ t: "share.state", state: "stopped" });
    dispatch({ type: "share", on: false });
  }, [peers, send]);

  const startShare = useCallback(async (): Promise<ShareResult> => {
    if (!navigator.mediaDevices?.getDisplayMedia) return "unsupported";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
    } catch {
      return "denied";
    }
    const tr = stream.getVideoTracks()[0];
    if (!tr) return "denied";
    track.current = tr;
    setPreview(stream);
    tr.contentHint = "detail";
    // Tarayıcının kendi "Paylaşımı durdur" çubuğu
    tr.addEventListener("ended", () => {
      if (track.current === tr) stopShare();
    });
    await peers.setTrack(tr);
    send({ t: "share.state", state: "sharing" });
    dispatch({ type: "share", on: true });
    return "ok";
  }, [peers, send, stopShare]);

  const end = useCallback(() => {
    send({ t: "session.end" });
    if (st.current.phase !== "live") dispatch({ type: "left" });
  }, [send]);

  const subscribe = useCallback((fn: (m: ServerOutbound) => void) => {
    subs.current.add(fn);
    return () => void subs.current.delete(fn);
  }, []);

  const chatHub = useChatHub(peers, peerTick, chatSubs);
  /** P28c (§5.3): müşterinin "Çıkar"ı (sahip olamaz — sunucu FORBIDDEN). */
  const removeTech = useCallback((tid: string) => send({ t: "tech.remove", tid }), [send]);
  const markDrawn = useCallback((tids: string[]) => peers.markDrawn(tids), [peers]);

  return {
    state,
    preview,
    channels,
    caps,
    maxFileMb,
    fileMode,
    send,
    subscribe,
    startShare,
    stopShare,
    end,
    roster,
    chatHub,
    removeTech,
    markDrawn,
  };
}

/** Eş haritası tek örnek (bileşen ömrü boyunca); yanıt/ICE WS'e, kanal değişimi React durumuna. */
function usePeers(
  st: { current: GuestState },
  send: (m: Parameters<Signal["send"]>[0]) => void,
  tick: (fn: (n: number) => number) => void,
  chatSubs: { current: Set<(m: GuestChatIn) => void> },
): GuestPeers {
  const [peers] = useState(
    () =>
      new GuestPeers({
        ice: () => st.current.iceServers,
        send,
        onChange: () => tick((n) => n + 1),
        onChat: (m) => {
          for (const fn of chatSubs.current) fn(m);
        },
      }),
  );
  return peers;
}

/** Çok eşli sohbet yolu (`useCollab` `chatHub`): hazır = herhangi bir eşin `ctl`'i açık. */
function useChatHub(peers: GuestPeers, peerTick: number, chatSubs: { current: Set<(m: GuestChatIn) => void> }): ChatHub {
  const ready = peers.chatReady;
  return useMemo(
    () => ({
      ready,
      send: (m) => peers.sendChat(m),
      subscribe: (fn) => {
        chatSubs.current.add(fn);
        return () => void chatSubs.current.delete(fn);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- peerTick: kanal kümesi değişince `ready` yeniden okunur
    [peers, ready, peerTick, chatSubs],
  );
}
