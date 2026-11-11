"use client";

import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import type { AnnotColor, AnnotTool } from "@/lib/dc/ctl";
import { annotPalette, contentRect, drawAnnotations, laserAlpha, normalize, simplify, throttle, LASER_INTERVAL_MS, type AnnotState, type Pt, type Stroke } from "@/lib/dc/annot";
import { newId } from "@/lib/dc/ctl";

export type DrawTool = AnnotTool | "laser";
export interface DrawInput {
  tool: DrawTool;
  color: AnnotColor;
  onStroke: (s: Stroke) => void;
  onLaser: (x: number, y: number) => void;
}

/**
 * İşaretleme katmanı (AC-37, 56, 57): video kutusunun üstünde canvas. `input` verilirse (teknisyen) işaretçiyle
 * çizer; verilmezse yalnız gösterir (müşteri). Lazer 1 sn'de söner. Girdi olayı üretmez (AC-58).
 */
export function AnnotLayer({ video, state, input, label }: { video: RefObject<HTMLVideoElement | null>; state: AnnotState; input?: DrawInput | null; label: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const draft = useRef<Stroke | null>(null);
  const st = useRef(state);
  const raf = useRef(0);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  const paint = useRef(() => {});
  useEffect(() => {
    paint.current = () => {
      const c = cv.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
      if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const v = video.current;
      const r = contentRect(w, h, v?.videoWidth ?? 0, v?.videoHeight ?? 0);
      const now = performance.now();
      drawAnnotations(ctx, r, st.current, annotPalette(c), now, draft.current);
      cancelAnimationFrame(raf.current);
      if (laserAlpha(st.current.laser, now) > 0) raf.current = requestAnimationFrame(() => paint.current());
    };
  });

  useEffect(() => {
    // Alıcıda lazer zamanı performance saatine çevrilir (reducer Date.now ile damgalar)
    st.current = state.laser ? { ...state, laser: { ...state.laser, at: performance.now() } } : state;
    paint.current();
  }, [state]);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const ro = new ResizeObserver(() => paint.current());
    ro.observe(c);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const pt = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const c = e.currentTarget;
    const b = c.getBoundingClientRect();
    const v = video.current;
    return normalize(e.clientX - b.left, e.clientY - b.top, contentRect(b.width, b.height, v?.videoWidth ?? 0, v?.videoHeight ?? 0));
  };
  const laser = useRef<((x: number, y: number) => void) | null>(null);
  useEffect(() => {
    laser.current = throttle((x: number, y: number) => inputRef.current?.onLaser(x, y), LASER_INTERVAL_MS);
  }, []);

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!input) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pt(e);
    if (input.tool === "laser") return laser.current?.(p[0], p[1]);
    draft.current = { id: newId(), tool: input.tool, color: input.color, pts: [p] };
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!input) return;
    const p = pt(e);
    if (input.tool === "laser") {
      if (e.buttons || e.pointerType === "mouse") laser.current?.(p[0], p[1]);
      return;
    }
    const d = draft.current;
    if (!d) return;
    d.pts = d.tool === "pen" ? [...d.pts, p] : [d.pts[0] as Pt, p];
    paint.current();
  };
  const up = () => {
    const d = draft.current;
    draft.current = null;
    if (d && input) input.onStroke({ ...d, pts: simplify(d.pts.length === 1 ? [d.pts[0] as Pt, d.pts[0] as Pt] : d.pts) });
  };

  return (
    <canvas
      ref={cv}
      role="img"
      aria-label={label}
      data-testid="annot-layer"
      data-strokes={state.strokes.length}
      data-laser={state.laser ? "on" : "off"}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className={`absolute inset-0 size-full ${input ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
    />
  );
}
