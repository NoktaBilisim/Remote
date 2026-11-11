"use client";

/*
 * Kontrol izni varken sahnede fare/klavye yakalama → `input` DataChannel (AC-48, 49). `active` false olduğu anda
 * (müşteri kapattı, revoke, caps.update, kopma, teknisyen bıraktı) dinleyiciler sökülür ve `k.release_all`
 * gönderilir — sonraki olay gönderilmez (AC-50: ≤ 1 sn). Kapının asıl sahibi müşteri istemcisidir (AC-101).
 */
import { useEffect, useRef, type RefObject } from "react";
import { keyMsg, mouseButton, pointFromClient, releaseComboTracker, wheelMsg } from "./input";
import type { InputMsg } from "./protocol";

/** Hareket en çok ~60/sn (DC'yi boğmamak için); düğme olayları konumu ayrıca taşır. */
const MOVE_INTERVAL_MS = 16;

interface KeyboardLock {
  lock?: (codes?: string[]) => Promise<void>;
  unlock?: () => void;
}

export function sendInput(ch: RTCDataChannel | null, m: InputMsg): boolean {
  if (!ch || ch.readyState !== "open") return false;
  ch.send(JSON.stringify(m));
  return true;
}

export function useRemoteInput({
  active,
  channel,
  target,
  video,
  fullscreen,
  onKeyboardRelease,
}: {
  active: boolean;
  channel: RTCDataChannel | null;
  target: RefObject<HTMLElement | null>;
  video: RefObject<HTMLVideoElement | null>;
  fullscreen: boolean;
  /** Ctrl+Alt+Shift: odak sahneden çıkar (ör. "Kontrolü bırak" düğmesine). */
  onKeyboardRelease: () => void;
}) {
  const release = useRef(onKeyboardRelease);
  useEffect(() => {
    release.current = onKeyboardRelease;
  });

  useEffect(() => {
    const el = target.current;
    if (!active || !channel || !el) return;
    const send = (m: InputMsg) => sendInput(channel, m);
    const combo = releaseComboTracker();
    const pressed = new Set<number>();
    let lastMove = -Infinity;
    let lastPt = "";
    let last: [number, number] | null = null;

    const point = (e: { clientX: number; clientY: number }, clamp: boolean) => {
      const v = video.current;
      if (!v || !v.videoWidth) return null;
      return pointFromClient(e.clientX, e.clientY, v.getBoundingClientRect(), v.videoWidth, v.videoHeight, clamp);
    };
    // %100 kipinde kaydırma çubuğu üstündeki tık uzak ekrana gitmez
    const onScrollbar = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      return e.clientX - b.left >= el.clientWidth || e.clientY - b.top >= el.clientHeight;
    };

    const move = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastMove < MOVE_INTERVAL_MS) return;
      const p = point(e, pressed.size > 0);
      if (!p) return;
      const k = `${p[0]},${p[1]}`;
      if (k === lastPt) return;
      lastMove = now;
      lastPt = k;
      last = p;
      send({ t: "m.move", x: p[0], y: p[1] });
    };
    const down = (e: PointerEvent) => {
      const b = mouseButton(e.button);
      if (!b || onScrollbar(e)) return;
      const p = point(e, false);
      if (!p) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture?.(e.pointerId);
      pressed.add(e.button);
      last = p;
      send({ t: "m.btn", b, down: true, x: p[0], y: p[1] });
    };
    const up = (e: PointerEvent) => {
      const b = mouseButton(e.button);
      if (!b || !pressed.delete(e.button)) return;
      const p = point(e, true);
      if (p) send({ t: "m.btn", b, down: false, x: p[0], y: p[1] });
    };
    const wheel = (e: WheelEvent) => {
      const m = wheelMsg(e.deltaX, e.deltaY, e.deltaMode);
      e.preventDefault();
      if (m) send(m);
    };
    const key = (e: KeyboardEvent) => {
      if (combo.feed(e)) {
        send({ t: "k", code: e.code, down: false });
        send({ t: "k.release_all" });
        release.current();
        return;
      }
      const m = keyMsg(e);
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      send(m);
    };
    const context = (e: Event) => e.preventDefault();
    const blur = () => {
      combo.reset();
      send({ t: "k.release_all" });
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("keydown", key);
    el.addEventListener("keyup", key);
    el.addEventListener("contextmenu", context);
    el.addEventListener("blur", blur);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("keydown", key);
      el.removeEventListener("keyup", key);
      el.removeEventListener("contextmenu", context);
      el.removeEventListener("blur", blur);
      // Takılı düğme/tuş kalmasın; kapalı kanalda sessizce düşer
      for (const b of pressed) {
        const mb = mouseButton(b);
        if (mb && last) send({ t: "m.btn", b: mb, down: false, x: last[0], y: last[1] });
      }
      send({ t: "k.release_all" });
    };
  }, [active, channel, target, video]);

  // Tam ekranda Alt+Tab / Win / Esc gibi sistem tuşlarını yakala (Chromium Keyboard Lock; yoksa "Özel tuşlar")
  useEffect(() => {
    const kb = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    if (!active || !fullscreen || !kb?.lock) return;
    void kb.lock().catch(() => undefined);
    return () => kb.unlock?.();
  }, [active, fullscreen]);
}
