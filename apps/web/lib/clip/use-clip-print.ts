"use client";

/*
 * P28a konsol bağlayıcısı (mimari-p28 §6): pano işi (`ClipJobs`) + uzaktan yazdırma (`PrintJobs`) ↔ WS (`useTechSession`
 * abonesi: `clip.status`, `print.status`, `error`) ↔ DC `ctl` (`clip.ready`, `clip.data`, `print.ready`) ↔ `file` kanalı
 * (ortak `idx` sayacı `useCollab.nextIdx`). Düğme kararları saf `featureState`. Sonuç bildirimleri toast; pano içeriği
 * hiçbir yerde (state, DOM, console) tutulmaz.
 */
import { useCallback, useEffect, useState } from "react";
import { CLIP_RESULT_LABELS } from "@remote/contracts/labels";
import type { useToast } from "@/components/ui/toast";
import { t } from "../i18n";
import { parseCtl } from "../dc/ctl";
import { sha256Hex } from "../dc/files";
import type { Collab } from "../dc/use-collab";
import { PrintJobs, type PrintState } from "../print/print-send";
import type { useTechSession } from "../webrtc/use-tech-session";
import { newCpId } from "./chunks";
import { ClipJobs, type ClipNotice, type ClipView } from "./clipboard";
import { featureState, type FeatureState } from "./feature-state";

type TechSession = ReturnType<typeof useTechSession>;
type Toast = ReturnType<typeof useToast>;

/** D-P28a-4: "Al" başarı bildirimi hatırlatma taşıdığı için daha uzun kalır. */
const PULL_OK_TOAST_MS = 8_000;
const SOFT = new Set(["EMPTY", "SENSITIVE"]);

/** Pano bildirimi → toast (metin + ton). İçerik değil yalnız sonuç. */
export function clipNoticeText(n: ClipNotice): { text: string; tone: "success" | "danger" | "info" } {
  if (n.kind === "server") return { text: n.message, tone: "danger" };
  if (n.kind === "local") return { text: t(`cp.clip.err.${n.code}`), tone: n.code === "empty" ? "info" : "danger" };
  if (n.result === "OK") return { text: t(n.dir === "TO_TECH" ? "cp.clip.ok.pull" : "cp.clip.ok.push"), tone: "success" };
  return { text: CLIP_RESULT_LABELS[n.result], tone: SOFT.has(n.result) ? "info" : "danger" };
}

/** Son değer kutusu (olay işleyicileri için; render'da okunmaz). */
class Latest<T> {
  constructor(public current: T) {}
  set(v: T) {
    this.current = v;
  }
}

export function useClipPrint(
  ts: TechSession,
  collab: Collab,
  perms: { clip: boolean; print: boolean; notController?: boolean },
  toast: Toast,
  now: number | null,
) {
  const [clipView, setClipView] = useState<ClipView | null>(null);
  const [print, setPrint] = useState<PrintState>({ job: null, fieldError: null, cooldownUntil: 0 });
  // Sınıflar render dışında (olay/akış) son ts/collab/toast'a erişir; kutu render'da okunmaz
  const [io] = useState(() => new Latest({ ts, collab, toast }));
  useEffect(() => io.set({ ts, collab, toast }));

  const [clip] = useState(
    () =>
      new ClipJobs({
        sendWs: (m) => io.current.ts.send(m),
        sendCtl: (m) => {
          const ch = io.current.ts.channels?.ctl;
          if (ch?.readyState !== "open") return false;
          ch.send(JSON.stringify(m));
          return true;
        },
        newId: newCpId,
        clipboard: () => (typeof navigator === "undefined" ? undefined : navigator.clipboard),
        onChange: setClipView,
        notify: (n) => {
          const x = clipNoticeText(n);
          const pullOk = n.kind === "result" && n.result === "OK" && n.dir === "TO_TECH";
          io.current.toast(x.text, x.tone, pullOk ? { durationMs: PULL_OK_TOAST_MS } : {});
        },
      }),
  );
  const [printer] = useState(
    () =>
      new PrintJobs({
        sendWs: (m) => io.current.ts.send(m),
        sendCtl: (m) => {
          const ch = io.current.ts.channels?.ctl;
          if (ch?.readyState !== "open") return false;
          ch.send(JSON.stringify(m));
          return true;
        },
        file: () => io.current.ts.channels?.file ?? null,
        nextIdx: () => io.current.collab.nextIdx(),
        fileBusy: () => io.current.collab.fileOutBusy(),
        sha256: sha256Hex,
        newId: newCpId,
        onChange: setPrint,
        viaServer: (pid, file, sha, cb) => io.current.collab.printViaServer(pid, file, sha, cb),
        dropServer: () => io.current.collab.dropServerPrint(),
      }),
  );

  // WS: sonuçlar ve sunucu kapısı hataları
  const { subscribe } = ts;
  useEffect(
    () =>
      subscribe((m) => {
        // Y-P28a-1: sunucu VIEW'dan hemen sonra print.status{CANCELLED} yollar → iptal nedeni önce (eşzamanlı) işlenir
        if (m.t === "control.state" && m.state === "VIEW") printer.controlClosed();
        if (m.t === "clip.status") clip.onStatus(m);
        else if (m.t === "print.status") printer.onStatus(m);
        else if (m.t === "error" && !clip.onError(m.message)) printer.onError(m.message);
      }),
    [subscribe, clip, printer],
  );

  // DC ctl: yalnız P28a tipleri (diğerleri useCollab'da)
  const ch = ts.channels;
  useEffect(() => {
    if (!ch) return;
    const onCtl = (e: MessageEvent) => {
      const m = parseCtl(e.data);
      if (m?.t === "clip.ready" || m?.t === "clip.data") clip.onCtl(m);
      else if (m?.t === "print.ready") void printer.onReady(m.pid);
    };
    ch.ctl.addEventListener("message", onCtl);
    return () => ch.ctl.removeEventListener("message", onCtl);
  }, [ch, clip, printer]);

  // Müşteri ayrıldı / kanal kapandı → bekleyen işler kapanır; kontrol VIEW'a döndü → yazdırma iptal (r2 Y-P28a-1)
  const s = ts.state;
  const guestPresent = s.phase === "live" && s.peerLostSince === null;
  const linked = guestPresent && collab.ready;
  useEffect(() => {
    if (linked) return;
    clip.abort("DISCONNECTED");
    printer.peerGone();
  }, [linked, clip, printer]);
  const granted = ts.control.phase === "granted";
  useEffect(() => {
    if (granted) return;
    clip.abort("DENIED");
    printer.controlClosed();
  }, [granted, clip, printer]);
  useEffect(() => () => (clip.dispose(), printer.dispose()), [clip, printer]);

  const base = {
    ready: collab.ready,
    guestPresent,
    guestKind: s.guest?.kind ?? null,
    unattended: s.unattended !== null,
    guestFeatures: s.guestFeatures,
    controlGranted: granted,
    clipConsent: s.clipConsent,
    notController: perms.notController ?? false,
  };
  const clipState: FeatureState = featureState({ ...base, feature: "clipboard", permitted: perms.clip, busy: clipView !== null });
  const cooldown = now !== null && print.cooldownUntil > now;
  const printState: FeatureState = featureState({
    ...base,
    feature: "print",
    permitted: perms.print,
    busy: printer.active,
    cooldown,
    serverFiles: s.fileMode === "SERVER",
  });

  return {
    clipState,
    printState,
    clipView,
    print,
    cooldownSec: cooldown && now !== null ? Math.ceil((print.cooldownUntil - now) / 1000) : 0,
    push: useCallback(() => void clip.push(), [clip]),
    pull: useCallback(() => clip.pull(), [clip]),
    startPrint: useCallback((f: File) => void printer.start(f), [printer]),
    cancelPrint: useCallback(() => printer.cancel(), [printer]),
    clearPrintError: useCallback(() => printer.clearFieldError(), [printer]),
    /** Yazdırma `file` kanalını kullanıyor (dosya teklifi "busy"). */
    transferring: useCallback(() => printer.transferring, [printer]),
  };
}
export type ClipPrint = ReturnType<typeof useClipPrint>;
