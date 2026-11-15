"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";

/**
 * Oturum onay diyaloklarının (iptal / zorla sonlandır) ortak durumu: meşgulken kapanmaz; 401 → giriş sayfası;
 * 409/404 → `conflict()` metni. `call` başarıyla biterse `onDone`.
 */
export function useSessionAction(onClose: () => void, onDone: () => void, conflict: () => string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const run = async (call: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      onDone();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(toUiError(e, { 409: conflict(), 404: conflict() }));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, close, run };
}
