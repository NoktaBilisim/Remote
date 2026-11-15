"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { actualViewSize } from "@/lib/control/input";

/**
 * TEST-P7-2: sahne bu genişliğin altındaysa monitör / görünüm / tam ekran tek "Görünüm" menüsüne toplanır — şerit
 * kontrol sırasında tek satır kalır (1280 px pencerede sahne ~580 px). Üstünde hepsi şeritte satır içi.
 */
const COMPACT_BELOW_PX = 960;

/**
 * Uzak video: akış bağlanır; "%100" görünümde boyut müşteri monitörünün pikselleriyle (yoksa akış çözünürlüğüyle)
 * CSSOM üzerinden verilir (CSP: style özniteliği nonce'suz kabul edilmez; element.style serbest).
 */
export function useStageVideo(
  ref: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  nativeSize: { w: number; h: number } | null,
  actualMode: boolean,
) {
  const [vid, setVid] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [ref, stream]);
  // Akış çözünürlüğü değişince (WebRTC uyarlaması) "%100" boyutu yeniden hesaplanır
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const on = () => setVid({ w: v.videoWidth, h: v.videoHeight });
    v.addEventListener("resize", on);
    v.addEventListener("loadedmetadata", on);
    return () => {
      v.removeEventListener("resize", on);
      v.removeEventListener("loadedmetadata", on);
    };
  }, [ref]);
  const size = actualMode ? actualViewSize(nativeSize, vid.w, vid.h) : null;
  const sw = size?.w;
  const sh = size?.h;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.style.width = sw ? `${sw}px` : "";
    v.style.height = sh ? `${sh}px` : "";
  }, [ref, sw, sh]);
}

/**
 * Şerit yerleşimi: dar sahnede `compact` (Görünüm menüsü). TEST-P7-2 (CI kök nedeni): sabit eşik font metriğinden
 * bağımsız değil — Linux'ta (DejaVu) kontrol sırasında şerit 580 px'e sığmayıp iki satıra kırılıyordu. Şerit gerçekten
 * kırılınca `tight` (etiket görsel olarak gizlenir; ikon + ok kalır; ad `aria-label`/`title`). Genişlik değişince yeniden ölçülür.
 */
export function useStripFit(box: RefObject<HTMLElement | null>) {
  const [compact, setCompact] = useState(true);
  const [tight, setTight] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Tam ekranda düzen donar: genişleyen sahne düğmeyi menüden şeride taşıyıp odağı kaybettirmesin
    const ro = new ResizeObserver(([e]) => {
      if (!e || document.fullscreenElement === el) return;
      setCompact(e.contentRect.width < COMPACT_BELOW_PX);
      setTight(false); // yeni genişlikte yeniden ölç (aşağıdaki layout effect)
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  // Her çizimden sonra (boyamadan önce): şerit öğeleri tek satırda mı? `display:contents` sarmalayıcıların çocukları, mutlak
  // konumlu (sr-only) öğeler hariç. Kırılıyorsa etiketi daralt — yalnız false→true (döngü yok).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bilinçli: şerit içeriği (controlBar/monitors düğümleri) her çizimde değişebilir; `tight` korur, döngü yok
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el || tight) return;
    const items = [...el.children].flatMap((c) => (getComputedStyle(c).display === "contents" ? [...c.children] : [c]));
    const rects = items.filter((c) => getComputedStyle(c).position !== "absolute").map((c) => c.getBoundingClientRect());
    const first = rects[0];
    if (first && rects.some((r) => r.top >= first.bottom - 1)) setTight(true);
  });
  return { compact, tight, stripRef };
}

/** Sahne tam ekranı (yalnız sahne kutusu). */
export function useFullscreen(box: RefObject<HTMLElement | null>) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current && box.current !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, [box]);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void box.current?.requestFullscreen().catch(() => undefined);
  };
  return { full, toggleFull };
}
