"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QualitySummaryMsg } from "../dc/ctl";
import { evaluate, QualityAgg, sampleFromStats, SUMMARY_INTERVAL_MS, type Prev, type Sample } from "./stats";

const KEEP = 10;

/** 1 sn'de bir getStats (AC-44), 60 sn'de bir `quality.summary` (AC-46). `flush` oturum sonunda son özeti yollar. */
export function useQuality(pc: RTCPeerConnection | null, send: (m: QualitySummaryMsg) => void) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const agg = useRef(new QualityAgg());
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  const flush = useCallback(() => {
    const s = agg.current.summary();
    if (s) sendRef.current(s);
    agg.current = new QualityAgg();
  }, []);

  useEffect(() => {
    if (!pc) return;
    const prev: Prev = { c: null, a: null };
    let alive = true;
    const tick = setInterval(() => {
      pc.getStats().then(
        (r) => {
          if (!alive) return;
          const s = sampleFromStats(r as unknown as Map<string, never>, prev, performance.now());
          if (s.fps === null && s.rttMs === null) return; // medya henüz yok
          agg.current.add(s);
          setSamples((xs) => [...xs, s].slice(-KEEP));
        },
        () => undefined,
      );
    }, 1000);
    const sum = setInterval(flush, SUMMARY_INTERVAL_MS);
    return () => {
      alive = false;
      setTimeout(() => setSamples([]), 0); // yeni bağlantıda eski ölçüm gösterilmez
      clearInterval(tick);
      clearInterval(sum);
    };
  }, [pc, flush]);

  return { last: samples[samples.length - 1] ?? null, verdict: evaluate(samples), flush };
}
