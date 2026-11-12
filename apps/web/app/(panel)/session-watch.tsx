"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { IDLE_PROBE_MS, shouldProbe, type ProbeReason } from "@/lib/account/idle";

/**
 * AC-68: boşta kalan/8 saati dolan oturumda yeniden giriş. Görünmez; kullanıcı etkinliğini izler, gerektiğinde
 * GET /auth/me yoklar (`lib/account/idle.ts`). 401 → `/login?reason=expired`. Ağ hatası sessizce yok sayılır.
 */
export function SessionWatch() {
  const router = useRouter();
  useEffect(() => {
    let lastActivity = Date.now();
    let lastProbe = Date.now();
    let busy = false;
    const probe = async (reason: ProbeReason) => {
      if (busy || !shouldProbe(reason, Date.now(), lastActivity, lastProbe)) return;
      busy = true;
      lastProbe = Date.now();
      try {
        await api<unknown>("GET", "/auth/me");
      } catch (e) {
        if (isUnauthenticated(e)) router.replace(EXPIRED_LOGIN_PATH);
      } finally {
        busy = false;
      }
    };
    const onActivity = () => {
      lastActivity = Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void probe("visible");
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    // Dakikada bir yerel kontrol (istek yok); yoklama yalnız IDLE_PROBE_MS etkinliksizlikten sonra
    const timer = window.setInterval(() => void probe("idle"), Math.min(60_000, IDLE_PROBE_MS));
    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [router]);
  return null;
}
