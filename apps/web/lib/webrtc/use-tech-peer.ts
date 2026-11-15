"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import type { GuestKind, IceServer, ServerOutbound } from "@remote/contracts/ws";
import { PeerLink, type Channels } from "./peer";
import type { Signal } from "./signal";

/**
 * Teknisyen tarafı PeerConnection: teklif (recvonly video), AGENT misafire `input` DC, ICE listesi/yenileme ve
 * peer'e ait sunucu mesajları (`onPeerMsg`; `start` = tech-machine `iceGate` ertelenen ilk teklifi başlat dedi).
 */
export function useTechPeer(peerRef: RefObject<PeerLink | null>, send: (m: Parameters<Signal["send"]>[0]) => void) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const [maxFileMb, setMaxFileMb] = useState<number | undefined>(undefined);
  const [input, setInput] = useState<RTCDataChannel | null>(null);
  const inputRef = useRef<RTCDataChannel | null>(null);
  const kind = useRef<GuestKind | null>(null);
  const ice = useRef<IceServer[]>([]);

  const resetPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    setStream(null);
    setChannels(null);
    setPc(null);
    setInput(null);
    inputRef.current = null;
  }, [peerRef]);

  const startPeer = useCallback(() => {
    resetPeer();
    // P7: input kanalı yalnız Hızlı Destek istemcisine (tarayıcı misafir kabul etmez, AC-34)
    const p = new PeerLink(ice.current, send, kind.current === "AGENT");
    peerRef.current = p;
    setPc(p.pc);
    wirePeer(p, peerRef, inputRef, { setChannels, setInput, setStream });
  }, [peerRef, resetPeer, send]);

  const onIceServers = useCallback(
    (servers: IceServer[], start: boolean) => {
      ice.current = servers;
      if (start) startPeer(); // peer.joined bu listeden önce geldiyse ertelenen ilk teklif şimdi
      peerRef.current?.setIceServers(servers);
      // G-13: credential yenilemesinden sonra ICE restart — yalnız kurulmuş bağlantıda (admit anındaki
      // ilk ice.servers, ilk teklif yanıtlanmadan ikinci teklif üretip yarış yaratmasın)
      const p = peerRef.current;
      if (p && p.pc.signalingState === "stable" && p.pc.remoteDescription) void p.offer(true).catch(() => undefined);
    },
    [peerRef, startPeer],
  );

  const onPeerMsg = useCallback(
    (m: ServerOutbound, start: boolean) => {
      if (m.t === "hello" || (m.t === "peer.joined" && m.role === "guest")) {
        // Misafir türü (input kanalı yalnız AGENT'a) ve dosya sınırı; hello ICE listesini de taşır
        kind.current = m.guestKind ?? kind.current;
        if (m.t === "hello") ice.current = m.iceServers;
        if (m.maxFileMb) setMaxFileMb(m.maxFileMb);
        if (start) startPeer();
      } else if (m.t === "ice.servers") onIceServers(m.iceServers, start);
      else linkMsg(m, peerRef, resetPeer);
    },
    [onIceServers, peerRef, resetPeer, startPeer],
  );

  return { stream, channels, pc, maxFileMb, input, inputRef, resetPeer, onPeerMsg };
}

/** Yeni PeerLink'in olayları: yalnız güncel peer'e aitse durum güncellenir; ICE "failed" → ICE restart teklifi. */
function wirePeer(
  p: PeerLink,
  peerRef: RefObject<PeerLink | null>,
  inputRef: RefObject<RTCDataChannel | null>,
  set: {
    setChannels: (c: Channels | null) => void;
    setInput: (c: RTCDataChannel | null) => void;
    setStream: (s: MediaStream | null) => void;
  },
) {
  p.onChannels = (c) => peerRef.current === p && set.setChannels(c);
  p.onInput = (c) => {
    if (peerRef.current !== p) return;
    inputRef.current = c;
    set.setInput(c);
  };
  p.pc.oniceconnectionstatechange = () => {
    if (p.pc.iceConnectionState === "failed" && peerRef.current === p) void p.offer(true).catch(() => undefined);
  };
  void p.offer().then(
    (s) => peerRef.current === p && set.setStream(s),
    () => undefined,
  );
}

/** Kurulu bağlantıya ait mesajlar: müşteri ayrıldı → peer sıfırlanır; SDP yanıtı ve ICE adayı peer'e iletilir. */
function linkMsg(m: ServerOutbound, peerRef: RefObject<PeerLink | null>, resetPeer: () => void) {
  if (m.t === "peer.left" && m.role === "guest") {
    resetPeer();
  } else if (m.t === "sdp.answer") {
    void peerRef.current?.acceptAnswer(m.sdp).catch(() => undefined);
  } else if (m.t === "ice") {
    const { candidate, sdpMid, sdpMLineIndex } = m;
    void peerRef.current?.addIce({ candidate, sdpMid, sdpMLineIndex });
  }
}
