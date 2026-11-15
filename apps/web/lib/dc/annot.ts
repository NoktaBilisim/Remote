/*
 * İşaretleme (AC-56..58): kalem/ok/dikdörtgen/lazer, geri al, temizle, 4 renk. Koordinatlar videonun GÖRÜNEN
 * içerik alanına (object-contain boşlukları hariç) göre 0..1 normalize gönderilir. İşaretleme yalnız çizimdir;
 * müşteri bilgisayarında girdi olayı üretmez (input kanalı kullanılmaz, AC-58).
 */
import type { AnnotColor, AnnotTool, CtlMessage } from "./ctl";

export type Pt = [number, number];
export interface Stroke {
  id: string;
  tool: AnnotTool;
  color: AnnotColor;
  pts: Pt[];
}
export interface Laser {
  x: number;
  y: number;
  at: number;
}
export interface AnnotState {
  strokes: Stroke[];
  laser: Laser | null;
}
export const initialAnnot: AnnotState = { strokes: [], laser: null };

export const MAX_PTS = 500;
export const MAX_STROKES = 200;
export const LASER_FADE_MS = 1000;
export const LASER_INTERVAL_MS = 1000 / 30;

/** Video kutusunda object-contain ile görünen içerik dikdörtgeni. */
export function contentRect(boxW: number, boxH: number, vidW: number, vidH: number) {
  if (!vidW || !vidH || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / vidW, boxH / vidH);
  const w = vidW * s;
  const h = vidH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
export function normalize(px: number, py: number, r: { x: number; y: number; w: number; h: number }): Pt {
  return [clamp((px - r.x) / (r.w || 1)), clamp((py - r.y) / (r.h || 1))];
}

/** ≤ MAX_PTS noktaya eşit aralıklı örnekleme (ilk/son korunur); 4 ondalığa yuvarlama (boyut). */
export function simplify(pts: Pt[], max = MAX_PTS): Pt[] {
  const r = (p: Pt): Pt => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
  if (pts.length <= max) return pts.map(r);
  const out: Pt[] = [];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(r(pts[Math.round(i * step)] as Pt));
  return out;
}

export function annotReducer(s: AnnotState, m: CtlMessage, now = Date.now()): AnnotState {
  switch (m.t) {
    case "annot.stroke":
      return {
        ...s,
        strokes: [...s.strokes.filter((x) => x.id !== m.id), { id: m.id, tool: m.tool, color: m.color, pts: m.pts }].slice(-MAX_STROKES),
      };
    case "annot.undo":
      return { ...s, strokes: m.id ? s.strokes.filter((x) => x.id !== m.id) : s.strokes.slice(0, -1) };
    case "annot.clear":
      return { strokes: [], laser: null };
    case "annot.laser":
      return { ...s, laser: { x: m.x, y: m.y, at: now } };
    default:
      return s;
  }
}

/** Lazer görünürlüğü: 1 sn içinde doğrusal söner (AC-57). */
export const laserAlpha = (l: Laser | null, now: number): number => (l ? Math.max(0, 1 - (now - l.at) / LASER_FADE_MS) : 0);

/** Basit zaman kısıtlayıcı (lazer 30/sn). */
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number, clock: () => number = () => performance.now()) {
  let last = -Infinity;
  return (...a: A) => {
    const t = clock();
    if (t - last < ms) return;
    last = t;
    fn(...a);
  };
}

/** CSS token'larından renk (ham renk yok; DESIGN §2 `annot-*`). */
export function annotPalette(el: Element): Record<AnnotColor | "laser", string> {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    red: v("--rs-annot-red"),
    yellow: v("--rs-annot-yellow"),
    green: v("--rs-annot-green"),
    blue: v("--rs-annot-blue"),
    laser: v("--rs-annotate"),
  };
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  st: AnnotState,
  palette: Record<AnnotColor | "laser", string>,
  now: number,
  draft?: Stroke | null,
) {
  const X = (p: Pt) => r.x + p[0] * r.w;
  const Y = (p: Pt) => r.y + p[1] * r.h;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  for (const s of draft ? [...st.strokes, draft] : st.strokes) {
    const a = s.pts[0];
    const b = s.pts[s.pts.length - 1];
    if (!a || !b) continue;
    ctx.strokeStyle = palette[s.color];
    ctx.beginPath();
    if (s.tool === "rect") ctx.rect(X(a), Y(a), X(b) - X(a), Y(b) - Y(a));
    else if (s.tool === "arrow") {
      ctx.moveTo(X(a), Y(a));
      ctx.lineTo(X(b), Y(b));
      const ang = Math.atan2(Y(b) - Y(a), X(b) - X(a));
      for (const d of [-0.5, 0.5]) {
        ctx.moveTo(X(b), Y(b));
        ctx.lineTo(X(b) - 14 * Math.cos(ang + d), Y(b) - 14 * Math.sin(ang + d));
      }
    } else {
      ctx.moveTo(X(a), Y(a));
      for (const p of s.pts.slice(1)) ctx.lineTo(X(p), Y(p));
    }
    ctx.stroke();
  }
  const al = laserAlpha(st.laser, now);
  if (st.laser && al > 0) {
    ctx.globalAlpha = al;
    ctx.fillStyle = palette.laser;
    ctx.beginPath();
    ctx.arc(r.x + st.laser.x * r.w, r.y + st.laser.y * r.h, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
