"use client";

/*
 * İşbirliği kanalı bağlayıcısı (P5): ctl + file DataChannel'larını sohbet, dosya ve işaretleme modellerine bağlar.
 * Konsol ve müşteri sayfası aynı hook'u kullanır. Kanal yokken (bağlantı kuruluyor/koptu) gönderimler pasif.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DEFAULT_MAX_FILE_MB, maxFileBytes } from "@remote/contracts/dc";
import { FSRV_MAX_BYTES, type FileMode } from "@remote/contracts/ws-fsrv";
import type { ServerOutbound } from "@remote/contracts/ws";
import { newCpId } from "../clip/chunks";
import { FsrvTransfers, type FsrvIn, type FsrvOut, type PrintUploadCallbacks } from "../fsrv/transfers";
import type { Channels } from "../webrtc/peer";
import { annotReducer, initialAnnot, type AnnotState } from "./annot";
import { chatReducer, initialChat, prepareChat } from "./chat";
import { parseCtl, type CtlMessage, type FileDirection, type FileMetaMsg } from "./ctl";
import { FileTransfers, type Transfer } from "./files";
import { chatSendLimiter, inboundLimiter } from "./rate";

interface CollabOptions {
  inbound: FileDirection;
  /** `file_transfer` yeteneği (müşteri: hello.caps; konsol: kullanıcının yetkisi). */
  filesAllowed: boolean;
  /** Sohbet şu an görünür mü (okunmamış sayaç). */
  chatVisible: boolean;
  /** Bu taraf çizim alabilir mi (müşteri: evet, konsol: yalnız kendi çizimi). */
  receiveAnnot: boolean;
  sendMeta: (m: FileMetaMsg) => void;
  /** Tenant sınırı (hello/peer.joined `maxFileMb`); yoksa 100 MB. */
  maxFileMb?: number;
  /** P28a (§4.4): uzaktan yazdırma aktarımı sürüyor → giden dosya teklifi "busy" (yön başına tek aktarım). */
  printBusy?: () => boolean;
  /**
   * P28b (mimari-p28b §5, §9): oturumun dosya modu ve WS bağlantısı. `mode === "SERVER"` → dosyalar yalnız sunucu yolundan
   * (`lib/fsrv`), DC `file.offer` otomatik reddedilir, `file` kanalı kullanılmaz. Yoksa / P2P → mevcut DC yolu aynen.
   */
  fsrv?: FsrvLink;
  /**
   * P28c (§4.5): müşteri sayfasında sohbet tüm eşlere yayılır (`lib/webrtc/guest-chat-hub.ts`). Verilirse sohbet yalnız bu
   * yoldan gider/gelir; `ch.ctl` üzerindeki sohbet yok sayılır (dosya/işaretleme ana eşin kanalında kalır).
   */
  chatHub?: ChatHub;
}

/** Çok eşli sohbet yolu (müşteri sayfası). `send` → en az bir eşe gitti mi; `subscribe` → gelen (kaynak eşin tid'iyle). */
export interface ChatHub {
  ready: boolean;
  send: (m: { t: "chat"; id: string; text: string; ts: number }) => boolean;
  subscribe: (fn: (m: { id: string; text: string; ts: number; by: string }) => void) => () => void;
}

export interface FsrvLink {
  mode: FileMode | null;
  sendWs: (m: FsrvOut) => void;
  subscribe: (fn: (m: ServerOutbound) => void) => () => void;
  /** Sunucu yolu kullanılabilir (WS bağlı + karşı taraf odada). */
  ready: boolean;
}

const FSRV_TYPES = new Set(["fsrv.upload", "fsrv.status", "fsrv.offer", "fsrv.download"]);

/** P28b: sunucu modu aktarımları — WS oturumuna bağlı (DC yeniden kurulsa da sürer). */
function useFsrvTransfers(o: CollabOptions, opts: { current: CollabOptions }) {
  const [list, setList] = useState<Transfer[]>([]);
  const ref = useRef<FsrvTransfers | null>(null);
  const server = o.fsrv?.mode === "SERVER";
  const subscribe = o.fsrv?.subscribe;
  const maxMb = o.maxFileMb ?? DEFAULT_MAX_FILE_MB;
  useEffect(() => {
    if (!server || !subscribe) return;
    const x = new FsrvTransfers({
      inbound: o.inbound,
      sendWs: (m) => opts.current.fsrv?.sendWs(m),
      onChange: setList,
      maxBytes: Math.min(maxFileBytes(maxMb), FSRV_MAX_BYTES),
      allowed: () => opts.current.filesAllowed,
      extBusy: () => opts.current.printBusy?.() ?? false,
      newXid: newCpId,
    });
    ref.current = x;
    const off = subscribe((m) => FSRV_TYPES.has(m.t) && x.onWs(m as FsrvIn));
    return () => {
      off();
      x.dispose();
      ref.current = null;
      setList([]);
    };
  }, [server, subscribe, o.inbound, maxMb, opts]);
  return { server, list, ref };
}

const e2eCorrupt = () => process.env.NEXT_PUBLIC_RS_E2E === "1" && Boolean((globalThis as { __rsCorruptSha?: boolean }).__rsCorruptSha);

const e2eChunkDelay = () =>
  process.env.NEXT_PUBLIC_RS_E2E === "1" ? Number((globalThis as { __rsSlowFileMs?: number }).__rsSlowFileMs) || 0 : 0;

const e2eOfferTimeout = () =>
  process.env.NEXT_PUBLIC_RS_E2E === "1" ? Number((globalThis as { __rsOfferTimeoutMs?: number }).__rsOfferTimeoutMs) || 0 : 0;

const e2eSelfThrottle = () =>
  !(process.env.NEXT_PUBLIC_RS_E2E === "1" && (globalThis as { __rsNoSelfThrottle?: boolean }).__rsNoSelfThrottle);

/** `sendChat` sonucu: gönderildi / hız sınırı (AC-227) / kanal kapalı veya geçersiz metin. */
type ChatSendResult = "sent" | "rate" | "error";

export function useCollab(ch: Channels | null, o: CollabOptions) {
  const [chat, chatDispatch] = useReducer(chatReducer, initialChat);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [annot, setAnnot] = useState<AnnotState>(initialAnnot);
  const ft = useRef<FileTransfers | null>(null);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });
  const fs = useFsrvTransfers(o, opts);
  const server = fs.server;

  useEffect(() => {
    if (!ch) return;
    // P28b SERVER: DC dosya yolu kapalı — gelen `file.offer` meta'sız düz ret (§5.4), `file` kanalı dinlenmez
    const t = server
      ? null
      : new FileTransfers({
          inbound: o.inbound,
          file: ch.file,
          sendCtl: (m) => ch.ctl.readyState === "open" && ch.ctl.send(JSON.stringify(m)),
          sendMeta: (m) => opts.current.sendMeta(m),
          onChange: setTransfers,
          maxBytes: maxFileBytes(o.maxFileMb ?? DEFAULT_MAX_FILE_MB),
          allowed: () => opts.current.filesAllowed,
          corruptSha: e2eCorrupt,
          chunkDelayMs: e2eChunkDelay,
          offerTimeoutMs: e2eOfferTimeout,
          selfThrottle: e2eSelfThrottle,
          extBusy: () => opts.current.printBusy?.() ?? false,
        });
    ft.current = t;
    const dcReject = (fid: string) => ch.ctl.readyState === "open" && ch.ctl.send(JSON.stringify({ t: "file.reject", fid }));
    // S-P5-6: karşı tarafın chat/annot seli bu sekmeyi kilitlemesin — aşan mesaj düşer
    const allow = inboundLimiter();
    const onCtl = (e: MessageEvent) => {
      const m = parseCtl(e.data);
      if (!m || !allow(m.t)) return;
      if (m.t === "chat") {
        if (opts.current.chatHub) return; // P28c: sohbet çok eşli yoldan
        chatDispatch({ type: "in", id: m.id, text: m.text, ts: m.ts, visible: opts.current.chatVisible, by: m.by });
      } else if (m.t.startsWith("file.")) {
        if (!t) {
          if (m.t === "file.offer") dcReject(m.fid);
          return;
        }
        // G-09/AC-119: yetki yoksa yalnız teklif işlenir (otomatik ret); diğer file.* düşer
        if (opts.current.filesAllowed || m.t === "file.offer") void t.onCtl(m);
      } else if (m.t.startsWith("annot.") && opts.current.receiveAnnot) setAnnot((s) => annotReducer(s, m));
    };
    const onFile = (e: MessageEvent) => t !== null && e.data instanceof ArrayBuffer && t.onFrame(e.data);
    ch.ctl.addEventListener("message", onCtl);
    ch.file.addEventListener("message", onFile);
    return () => {
      ch.ctl.removeEventListener("message", onCtl);
      ch.file.removeEventListener("message", onFile);
      t?.dispose();
      ft.current = null;
    };
  }, [ch, o.inbound, o.maxFileMb, server]);

  useEffect(() => {
    if (o.chatVisible) chatDispatch({ type: "read" });
  }, [o.chatVisible]);

  const hub = o.chatHub;
  useEffect(() => {
    if (!hub) return;
    return hub.subscribe((m) => chatDispatch({ type: "in", ...m, visible: opts.current.chatVisible }));
  }, [hub]);

  const sendCtl = useCallback(
    (m: CtlMessage) => {
      if (ch?.ctl.readyState !== "open") return false;
      ch.ctl.send(JSON.stringify(m));
      return true;
    },
    [ch],
  );

  // AC-227: gönderen sınırı — aşımda mesaj gönderilmez ve kuyruğa alınmaz ("rate"); metin girişte kalır
  const chatLimit = useRef(chatSendLimiter());
  const sendChat = useCallback(
    (text: string): ChatSendResult => {
      const item = prepareChat(text);
      const ready = hub ? hub.ready : ch?.ctl.readyState === "open";
      if (!item || !ready) return "error";
      if (!chatLimit.current.take()) return "rate";
      const m = { t: "chat" as const, id: item.id, text: item.text, ts: item.ts };
      if (!(hub ? hub.send(m) : sendCtl(m))) return "error";
      chatDispatch({ type: "out", item });
      return "sent";
    },
    [ch, hub, sendCtl],
  );

  /** Çizim gönder + yerelde uygula (geri al/temizle kendi listemizde de geçerli). */
  const sendAnnot = useCallback(
    (m: Extract<CtlMessage, { t: `annot.${string}` }>) => {
      if (sendCtl(m) && m.t !== "annot.laser") setAnnot((s) => annotReducer(s, m));
    },
    [sendCtl],
  );

  const fx = fs.ref;
  const mb = o.maxFileMb ?? DEFAULT_MAX_FILE_MB;
  return {
    ready: ch !== null,
    /** Sohbet gönderilebilir (P28c: müşteri sayfasında herhangi bir eşin kanalı açık). */
    chatReady: hub ? hub.ready : ch !== null,
    /** P28b: dosyalar sunucu yolundan (SERVER modu) — arayüz bilgi satırı (AC-363) ve hazır olma buna göre. */
    fileMode: server ? ("SERVER" as const) : ("P2P" as const),
    /** Dosya yolu hazır: P2P'de DC açık, SERVER'da WS + karşı taraf. */
    filesReady: server ? (o.fsrv?.ready ?? false) : ch !== null,
    /** Etkin dosya sınırı (MB) — arayüz metinleri için (SERVER: en çok 256 MB). */
    maxMb: server ? Math.min(mb, FSRV_MAX_BYTES / 1_048_576) : mb,
    chat,
    sendChat,
    transfers: server ? fs.list : transfers,
    sendFile: (f: File) => (server ? fx.current?.send(f) : ft.current?.send(f)) ?? Promise.resolve("denied" as const),
    accept: (fid: string) => void (server ? fx.current?.accept(fid) : ft.current?.accept(fid)),
    reject: (fid: string) => (server ? fx.current?.reject(fid) : ft.current?.reject(fid)),
    cancel: (fid: string, dir: "in" | "out") => (server ? fx.current?.cancel(fid, dir) : ft.current?.cancel(fid, dir)),
    /** P28b §5.3: SERVER modunda yazdırma belgesi sunucu yolundan; P2P'de null (DC yolu). */
    printViaServer: (pid: string, file: Blob, sha: string, cb: PrintUploadCallbacks): boolean => {
      if (!server || !fx.current) return false;
      fx.current.sendPrint(pid, file, sha, cb);
      return true;
    },
    dropServerPrint: () => fx.current?.dropPrint(),
    annot,
    sendAnnot,
    /** P28a (O-P28a-2): dosya + yazdırma ortak `fidIndex` sayacı; kanal yoksa null. */
    nextIdx: () => ft.current?.nextIdx() ?? null,
    /** P28a (§4.4): giden dosya aktarımı sürüyor (yazdırma başlamaz). */
    fileOutBusy: () => (server ? (fx.current?.outBusy ?? false) : (ft.current?.outBusy ?? false)),
  };
}
export type Collab = ReturnType<typeof useCollab>;
