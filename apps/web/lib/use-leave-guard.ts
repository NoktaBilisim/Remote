"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const BACK = "__back__";

/**
 * Kaydedilmemiş değişiklikte ayrılma uyarısı: sekme kapatma/yenileme (beforeunload), uygulama içi bağlantılar
 * (yakalama aşaması) ve tarayıcı geri tuşu. Geri için: form kirlenince aynı URL'ye bir "nöbetçi" geçmiş kaydı
 * eklenir (Next'in desteklediği yerel `history.pushState`); geri basılınca sayfa yerinde kalır (aynı URL) ve
 * diyalog açılır. "Kaydetmeden ayrıl" bir adım daha geri gider; temiz formda nöbetçiden geri basılırsa
 * kullanıcı ikinci kez basmak zorunda kalmasın diye otomatik bir adım daha geri gidilir.
 */
export function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const onSentinel = useRef(false);
  const dirtyRef = useRef(dirty);
  const here = useRef("");

  useEffect(() => {
    dirtyRef.current = dirty;
    if (dirty && !onSentinel.current) {
      here.current = location.pathname + location.search;
      window.history.pushState(window.history.state, "", location.href);
      onSentinel.current = true;
    }
  }, [dirty]);

  useEffect(() => {
    const pop = () => {
      if (!onSentinel.current) return;
      onSentinel.current = false;
      if (location.pathname + location.search !== here.current) return; // birden çok adım geri: engellenemez
      if (dirtyRef.current) setTarget(BACK);
      else window.history.back();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      if (a.pathname === location.pathname && a.search === location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(a.pathname + a.search + a.hash);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);

  const stay = () => {
    if (target === BACK) {
      // Geri tuşu nöbetçiyi tüketti; bir sonraki geri de yakalansın.
      window.history.pushState(window.history.state, "", location.href);
      onSentinel.current = true;
    }
    setTarget(null);
  };
  const leave = () => {
    if (!target) return;
    if (target === BACK) {
      dirtyRef.current = false;
      setTarget(null);
      window.history.back();
    } else if (onSentinel.current) {
      onSentinel.current = false;
      router.replace(target); // nöbetçinin yerine geçer; hedeften geri → bu sayfa (çift kayıt yok)
    } else router.push(target);
  };
  return { target, stay, leave };
}
