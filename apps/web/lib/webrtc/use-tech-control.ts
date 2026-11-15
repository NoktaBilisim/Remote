"use client";

/*
 * Konsol uzaktan kontrol kancaları (P7; makine lib/control/machine.ts): eşzamanlı makine kopyası, sekme sayaçları
 * (TEST-P7-3) ve kontrol/monitör istekleri (§3.3 K1/K2). İstek yalnız makine kabul ederse gönderilir; sunucu otoritedir.
 */
import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";
import {
  canCancel,
  canRelease,
  canRequest,
  canRequestMonitor,
  controlReducer,
  initialControl,
  MONITOR_TIMEOUT_MS,
  type ControlCounters,
  type ControlEvent,
  type ControlState,
} from "../control/machine";
import { sendInput } from "../control/use-remote-input";
import type { Signal } from "./signal";

type Send = (m: Parameters<Signal["send"]>[0]) => void;

/** Makine + eşzamanlı kopyası: gönderim kararları (istek/bırak/vazgeç/beklenmeyen izin) render beklemeden verilir. */
export function useControlMachine() {
  const [control, dispatchReducer] = useReducer(controlReducer, initialControl);
  const ctl = useRef<ControlState>(control);
  const dispatchCtl = useCallback((e: ControlEvent) => {
    ctl.current = controlReducer(ctl.current, e);
    dispatchReducer(e);
  }, []);
  return { control, ctl, dispatchCtl };
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

/** Sayaçları açılışta geri yükler, değiştikçe yazar, oturum bitince siler. */
export function useControlCounters(sessionId: string, control: ControlState, phase: string, dispatchCtl: (e: ControlEvent) => void) {
  useEffect(() => {
    const saved = readCounters(sessionId);
    if (saved) dispatchCtl({ type: "restore", saved, now: Date.now() });
  }, [dispatchCtl, sessionId]);
  const { requests, deniedAt, monitorRequests, monitorBlockedUntil } = control;
  useEffect(() => {
    if (phase === "ended") return writeCounters(sessionId, null);
    if (requests || monitorRequests || deniedAt || monitorBlockedUntil)
      writeCounters(sessionId, { requests, deniedAt, monitorRequests, monitorBlockedUntil });
  }, [deniedAt, monitorBlockedUntil, monitorRequests, requests, sessionId, phase]);
}

/** Kontrol/monitör istekleri + monitör yanıt zaman aşımı. */
export function useControlActions(
  ctl: RefObject<ControlState>,
  dispatchCtl: (e: ControlEvent) => void,
  send: Send,
  inputRef: RefObject<RTCDataChannel | null>,
  pendingAt: number | undefined,
) {
  // P7: istek yalnız makine kabul ederse gönderilir (≤5, ret sonrası 30 sn; sunucu yine otorite)
  const requestControl = useCallback(() => {
    const now = Date.now();
    if (!canRequest(ctl.current, now)) return;
    dispatchCtl({ type: "request", now });
    send({ t: "control.request" });
  }, [ctl, dispatchCtl, send]);
  const requestMonitor = useCallback(
    (monitorId: number) => {
      const c = ctl.current;
      const now = Date.now();
      if (!canRequestMonitor(c, now) || monitorId === c.activeMonitor || !c.monitors.some((x) => x.id === monitorId)) return;
      dispatchCtl({ type: "monitor", id: monitorId, now });
      send({ t: "monitor.request", monitorId });
    },
    [ctl, dispatchCtl, send],
  );
  // K1: bırakma = müşteri kapısını kapat. Takılı tuş kalmasın diye `k.release_all` kapı kapanmadan önce gider;
  // yakalama makine `granted`'dan çıkınca söker (use-remote-input temizliği). Devam = yeni `control.request`.
  const releaseControl = useCallback(() => {
    if (!canRelease(ctl.current)) return;
    sendInput(inputRef.current, { t: "k.release_all" });
    dispatchCtl({ type: "release", now: Date.now() });
    send({ t: "control.release" });
  }, [ctl, dispatchCtl, inputRef, send]);
  // K2: bekleyen isteği geri çek (müşteri sonradan onaylayıp kapıyı açamasın)
  const cancelControl = useCallback(() => {
    if (!canCancel(ctl.current)) return;
    dispatchCtl({ type: "cancel", now: Date.now() });
    send({ t: "control.cancel" });
  }, [ctl, dispatchCtl, send]);

  useEffect(() => {
    if (pendingAt === undefined) return;
    const id = setTimeout(
      () => dispatchCtl({ type: "monitorTimeout", now: Date.now() }),
      Math.max(0, pendingAt + MONITOR_TIMEOUT_MS - Date.now()),
    );
    return () => clearTimeout(id);
  }, [dispatchCtl, pendingAt]);

  return { requestControl, requestMonitor, releaseControl, cancelControl };
}
