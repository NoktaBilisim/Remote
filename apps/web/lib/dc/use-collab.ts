"use client";

/*
 * İşbirliği kanalı bağlayıcısı (P5): ctl + file DataChannel'larını sohbet, dosya ve işaretleme modellerine bağlar.
 * Konsol ve müşteri sayfası aynı hook'u kullanır. Kanal yokken (bağlantı kuruluyor/koptu) gönderimler pasif.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DEFAULT_MAX_FILE_MB, maxFileBytes } from "@remote/contracts/dc";
import type { Channels } from "../webrtc/peer";
import { annotReducer, initialAnnot, type AnnotState } from "./annot";
import { chatReducer, initialChat, prepareChat } from "./chat";
import { parseCtl, type CtlMessage, type FileDirection, type FileMetaMsg } from "./ctl";
import { FileTransfers, type Transfer } from "./files";
import { inboundLimiter } from "./rate";

export interface CollabOptions {
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
}

const e2eCorrupt = () => process.env.NEXT_PUBLIC_RS_E2E === "1" && Boolean((globalThis as { __rsCorruptSha?: boolean }).__rsCorruptSha);

const e2eChunkDelay = () =>
  process.env.NEXT_PUBLIC_RS_E2E === "1" ? Number((globalThis as { __rsSlowFileMs?: number }).__rsSlowFileMs) || 0 : 0;

const e2eOfferTimeout = () =>
  process.env.NEXT_PUBLIC_RS_E2E === "1" ? Number((globalThis as { __rsOfferTimeoutMs?: number }).__rsOfferTimeoutMs) || 0 : 0;

const e2eSelfThrottle = () =>
  !(process.env.NEXT_PUBLIC_RS_E2E === "1" && (globalThis as { __rsNoSelfThrottle?: boolean }).__rsNoSelfThrottle);

export function useCollab(ch: Channels | null, o: CollabOptions) {
  const [chat, chatDispatch] = useReducer(chatReducer, initialChat);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [annot, setAnnot] = useState<AnnotState>(initialAnnot);
  const ft = useRef<FileTransfers | null>(null);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });

  useEffect(() => {
    if (!ch) return;
    const t = new FileTransfers({
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
    });
    ft.current = t;
    // S-P5-6: karşı tarafın chat/annot seli bu sekmeyi kilitlemesin — aşan mesaj düşer
    const allow = inboundLimiter();
    const onCtl = (e: MessageEvent) => {
      const m = parseCtl(e.data);
      if (!m || !allow(m.t)) return;
      if (m.t === "chat") chatDispatch({ type: "in", id: m.id, text: m.text, ts: m.ts, visible: opts.current.chatVisible });
      else if (m.t.startsWith("file.")) {
        // G-09/AC-119: yetki yoksa yalnız teklif işlenir (otomatik ret); diğer file.* düşer
        if (opts.current.filesAllowed || m.t === "file.offer") void t.onCtl(m);
      } else if (m.t.startsWith("annot.") && opts.current.receiveAnnot) setAnnot((s) => annotReducer(s, m));
    };
    const onFile = (e: MessageEvent) => e.data instanceof ArrayBuffer && t.onFrame(e.data);
    ch.ctl.addEventListener("message", onCtl);
    ch.file.addEventListener("message", onFile);
    return () => {
      ch.ctl.removeEventListener("message", onCtl);
      ch.file.removeEventListener("message", onFile);
      t.dispose();
      ft.current = null;
    };
  }, [ch, o.inbound, o.maxFileMb]);

  useEffect(() => {
    if (o.chatVisible) chatDispatch({ type: "read" });
  }, [o.chatVisible]);

  const sendCtl = useCallback(
    (m: CtlMessage) => {
      if (ch?.ctl.readyState !== "open") return false;
      ch.ctl.send(JSON.stringify(m));
      return true;
    },
    [ch],
  );

  const sendChat = useCallback(
    (text: string): boolean => {
      const item = prepareChat(text);
      if (!item || !sendCtl({ t: "chat", id: item.id, text: item.text, ts: item.ts })) return false;
      chatDispatch({ type: "out", item });
      return true;
    },
    [sendCtl],
  );

  /** Çizim gönder + yerelde uygula (geri al/temizle kendi listemizde de geçerli). */
  const sendAnnot = useCallback(
    (m: Extract<CtlMessage, { t: `annot.${string}` }>) => {
      if (sendCtl(m) && m.t !== "annot.laser") setAnnot((s) => annotReducer(s, m));
    },
    [sendCtl],
  );

  return {
    ready: ch !== null,
    /** Etkin dosya sınırı (MB) — arayüz metinleri için. */
    maxMb: o.maxFileMb ?? DEFAULT_MAX_FILE_MB,
    chat,
    sendChat,
    transfers,
    sendFile: (f: File) => ft.current?.send(f) ?? Promise.resolve("denied" as const),
    accept: (fid: string) => void ft.current?.accept(fid),
    reject: (fid: string) => ft.current?.reject(fid),
    cancel: (fid: string, dir: "in" | "out") => ft.current?.cancel(fid, dir),
    annot,
    sendAnnot,
  };
}
export type Collab = ReturnType<typeof useCollab>;
