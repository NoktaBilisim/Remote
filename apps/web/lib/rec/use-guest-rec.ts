"use client";

/*
 * P28e misafir (tarayıcı) kayıt kancası (mimari-p28e r2 §2.1, §6.2–6.3, §9; AC-381, 382; S-P28e-2, S-P28e-12).
 *  - Rıza: onay ekranındaki seçim (bellek, `consent-choice.ts`) admit sonrası İLK `hello`'da bir kez `rec.consent` olarak gider.
 *  - Gösterge + "Kaydı durdur" yalnız sunucunun `rec.state` / `hello.rec`'ine göre çizilir.
 *  - "Kaydı durdur": onaysız `rec.revoke`; 2 sn'de `off` gelmezse paylaşım izi yerelde duraklar (`enabled=false`) ve bekleyen
 *    revoke yeniden bağlanınca `hello` sonrası yeniden gönderilir; `off` gelince paylaşım kendiliğinden sürer.
 *  - Kayıt açıkken sekme başlığı "● Kayıt — " önekini taşır (favicon değişmez).
 */
import type { GuestInboundFull, ServerOutbound } from "@remote/contracts/ws";
import { REC_CONSENT_LINE_SHA256, REC_REVOKE_ACK_MS, REC_TITLE_PREFIX, type RecStateReason } from "@remote/contracts/ws-rec";
import { useCallback, useEffect, useRef, useState } from "react";
import { takeRecConsent } from "./consent-choice";

export interface GuestRecView {
  on: boolean;
  /** Son durma nedeni (bilgi satırı). */
  reason: RecStateReason | null;
  /** "Kaydı durdur"a basıldı, `off` bekleniyor. */
  revoking: boolean;
  /** 2 sn'de `off` gelmedi → paylaşım yerelde duraklatıldı. */
  paused: boolean;
}

/** Başlığa öneki ekler/kaldırır (idempotent). */
export function recTitle(title: string, on: boolean): string {
  const base = title.startsWith(REC_TITLE_PREFIX) ? title.slice(REC_TITLE_PREFIX.length) : title;
  return on ? REC_TITLE_PREFIX + base : base;
}

interface Inputs {
  subscribe: (fn: (m: ServerOutbound) => void) => () => void;
  send: (m: GuestInboundFull) => void;
  preview: MediaStream | null;
}

export function useGuestRec({ subscribe, send, preview }: Inputs) {
  const [view, setView] = useState<GuestRecView>({ on: false, reason: null, revoking: false, paused: false });
  const helloSeen = useRef(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sendRef = useRef(send);
  const previewRef = useRef(preview);
  useEffect(() => {
    sendRef.current = send;
    previewRef.current = preview;
  }, [send, preview]);

  const apply = useCallback((on: boolean, reason: RecStateReason | undefined) => {
    if (!on) {
      pending.current = false;
      clearTimeout(timer.current);
      for (const tr of previewRef.current?.getVideoTracks() ?? []) tr.enabled = true;
    }
    setView((v) => ({
      on,
      reason: on ? null : (reason ?? v.reason),
      revoking: on ? v.revoking : false,
      paused: on ? v.paused : false,
    }));
  }, []);

  useEffect(
    () =>
      subscribe((m) => {
        if (m.t === "hello") {
          // Rıza seçimi admit sonrası İLK hello'da bir kez tüketilir (yeniden bağlanma / F5 dönüşünde gitmez)
          if (!helloSeen.current) {
            helloSeen.current = true;
            if (takeRecConsent()) sendRef.current({ t: "rec.consent", lineSha256: REC_CONSENT_LINE_SHA256 });
          }
          if (pending.current) sendRef.current({ t: "rec.revoke" });
          if (m.rec) apply(m.rec.on, m.rec.reason);
        } else if (m.t === "rec.state") apply(m.on, m.reason);
      }),
    [subscribe, apply],
  );

  const revoke = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    sendRef.current({ t: "rec.revoke" });
    setView((v) => ({ ...v, revoking: true }));
    timer.current = setTimeout(() => {
      if (!pending.current) return;
      for (const tr of previewRef.current?.getVideoTracks() ?? []) tr.enabled = false;
      setView((v) => ({ ...v, paused: true }));
    }, REC_REVOKE_ACK_MS);
  }, []);

  // Duraklatma yeni paylaşım izine de uygulanır (paylaşım yeniden başlatılırsa)
  useEffect(() => {
    if (view.paused) for (const tr of preview?.getVideoTracks() ?? []) tr.enabled = false;
  }, [preview, view.paused]);

  useEffect(() => {
    document.title = recTitle(document.title, view.on);
  }, [view.on]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      document.title = recTitle(document.title, false);
    },
    [],
  );

  return { ...view, revoke };
}
