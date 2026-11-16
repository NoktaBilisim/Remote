"use client";

/*
 * P28e konsol kayıt kancası (mimari-p28e r2 §6.2–6.5, §7, §9). Sunucu otoritedir (K-P28e-2): gösterge yalnız `rec.state` /
 * `hello.rec`'ten çizilir; kaydedici YALNIZ `upload` alan sokette (recorderOf) ve kaynak görüntü varken çalışır.
 * Olaylar: `upload` → yeni belirteç + bölüm; `rec.state{off}` → beklemeden `stop()`; `peer.left{guest}` → bölüm kapanır
 * (S-P28e-2); `peer.joined{guest}` / yeni iz → `series+1`; 60. parça → geçiş (recorder.ts); oturum sonu → `flush`.
 * Teknisyen düğmesi yoktur (AC-382); kaydedici durumu UI'ya yansımaz.
 */
import type { ServerOutbound, TechInbound } from "@remote/contracts/ws";
import type { RecBasis, RecStateReason } from "@remote/contracts/ws-rec";
import { useEffect, useRef, useState } from "react";
import { browserRecorder, SeriesRecorder, type RecorderLike } from "./recorder";
import { canRecord } from "./support";
import { Uploader, type UploadFatal } from "./upload";

export interface ConsoleRecView {
  on: boolean;
  basis: RecBasis | null;
  /** Son durma nedeni (gösterge yerine uyarı). */
  reason: RecStateReason | null;
  /** Firma kaydı açık ama bu tarayıcı kaydedemiyor (K-P28e-9). */
  unsupported: boolean;
  /** Gözetimsiz: politika açık ama cihaz `record1` bildirmedi. */
  deviceOutdated: boolean;
}

type RecMsg = {
  on: boolean;
  reason?: RecStateReason;
  rid?: string;
  basis?: RecBasis;
  upload?: { token: string; series: number; nextPart: number };
};

interface Inputs {
  subscribe: (fn: (m: ServerOutbound) => void) => () => void;
  send: (m: TechInbound) => void;
  stream: MediaStream | null;
  ended: boolean;
  /** Test kancası: kaydedici fabrikası. */
  create?: (s: MediaStream) => RecorderLike;
}

const INITIAL: ConsoleRecView = { on: false, basis: null, reason: null, unsupported: false, deviceOutdated: false };

/** İlk kare: uzak iz `muted` ise `unmute`'u bekler (WebRTC'de ilk kare = unmute). */
function whenFrame(track: MediaStreamTrack, fn: () => void): () => void {
  if (!track.muted) {
    fn();
    return () => undefined;
  }
  const h = () => fn();
  track.addEventListener("unmute", h, { once: true });
  return () => track.removeEventListener("unmute", h);
}

class Controller {
  rid: string | null = null;
  nextSeries = 0;
  sourcePresent = true;
  active = false;
  stream: MediaStream | null = null;
  private cancelFrame: () => void = () => undefined;
  readonly uploader: Uploader;
  readonly recorder: SeriesRecorder;

  constructor(
    private send: (m: TechInbound) => void,
    create: (s: MediaStream) => RecorderLike,
  ) {
    this.uploader = new Uploader({
      onBroken: (s) => this.rotate(s),
      onFatal: (k: UploadFatal) => this.fatal(k),
    });
    this.recorder = new SeriesRecorder({
      create,
      onPart: (p) => this.uploader.enqueue(p),
      onError: () => {
        this.send({ t: "rec.error", code: "recorder_failed" });
        this.active = false;
      },
    });
  }

  /** `upload` alındı: yeni belirteç + bölüm (`nextPart ≠ 0` ise devam edilemez → sonraki bölüm). */
  upload(rid: string, u: { token: string; series: number; nextPart: number }) {
    void this.recorder.close("now");
    this.rid = rid;
    this.uploader.setTarget({ rid, token: u.token });
    this.nextSeries = u.nextPart === 0 ? u.series : u.series + 1;
    this.active = true;
    this.maybeStart();
  }

  off(flush = false) {
    this.active = false;
    this.cancelFrame();
    void this.recorder.close(flush ? "flush" : "now");
  }

  setStream(s: MediaStream | null) {
    if (s === this.stream) return;
    this.stream = s;
    if (this.recorder.series !== null) {
      this.nextSeries = this.recorder.series + 1;
      void this.recorder.close("now");
    }
    this.maybeStart();
  }

  source(present: boolean) {
    this.sourcePresent = present;
    if (!present && this.recorder.series !== null) {
      this.nextSeries = this.recorder.series + 1;
      void this.recorder.close("now");
    }
    if (present) this.maybeStart();
  }

  private rotate(series: number) {
    if (this.recorder.series !== series) return;
    this.nextSeries = series + 1;
    void this.recorder.close("now").then(() => this.maybeStart());
  }

  private fatal(k: UploadFatal) {
    if (this.recorder.series !== null) this.nextSeries = this.recorder.series + 1;
    void this.recorder.close("now");
    if (k !== "gone") this.active = false; // quota/invalid: sunucu kaydı durdurur; `gone`: yeni upload/peer.joined beklenir
  }

  maybeStart() {
    this.cancelFrame();
    const track = this.stream?.getVideoTracks()[0];
    if (!this.active || !this.sourcePresent || !track || this.recorder.series !== null || !this.stream) return;
    const stream = this.stream;
    this.cancelFrame = whenFrame(track, () => {
      if (!this.active || this.recorder.series !== null || this.stream !== stream) return;
      if (this.recorder.start(stream, this.nextSeries)) this.nextSeries++;
    });
  }
}

/** Gelen sunucu mesajı → görünüm + kaydedici olayı. */
function onMsg(m: ServerOutbound, c: Controller, set: (f: (v: ConsoleRecView) => ConsoleRecView) => void, recordable: boolean) {
  let rec: RecMsg | undefined;
  if (m.t === "hello") {
    if (m.unattended?.recordOutdated) set((v) => ({ ...v, deviceOutdated: true }));
    rec = m.rec as RecMsg | undefined;
    c.source(m.peerPresent);
  } else if (m.t === "rec.state") rec = m as RecMsg;
  else if (m.t === "peer.left" && m.role === "guest") c.source(false);
  else if (m.t === "peer.joined" && m.role === "guest") c.source(true);
  else if (m.t === "session.ended") c.off(true);
  if (!rec) return;
  const r = rec;
  set((v) => ({
    ...v,
    on: r.on,
    basis: r.basis ?? v.basis,
    reason: r.on ? null : (r.reason ?? v.reason),
    unsupported: !recordable,
  }));
  if (!r.on) return c.off();
  if (r.upload && r.rid && recordable) c.upload(r.rid, r.upload);
}

export function useConsoleRec({ subscribe, send, stream, ended, create }: Inputs): ConsoleRecView {
  const [view, setView] = useState<ConsoleRecView>(INITIAL);
  const ctl = useRef<Controller | null>(null);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    const c = new Controller((m) => sendRef.current(m), create ?? browserRecorder);
    ctl.current = c;
    const recordable = canRecord();
    const off = subscribe((m) => onMsg(m, c, setView, recordable));
    return () => {
      off();
      c.off(true);
      ctl.current = null;
    };
  }, [subscribe, create]);

  useEffect(() => {
    ctl.current?.setStream(stream);
  }, [stream]);

  useEffect(() => {
    if (ended) ctl.current?.off(true);
  }, [ended]);

  return view;
}
