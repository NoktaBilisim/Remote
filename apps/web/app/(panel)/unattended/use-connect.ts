"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UnattendedConnectResponse } from "@/lib/unattended/contract";
import { unattendedUiError } from "@/lib/unattended/errors";

/**
 * Bağlan akışı (AC-273, mimari-p27 §6): `POST /unattended/devices/:id/connect` → 401 `MFA_STEP_UP_REQUIRED` gelirse
 * `lib/api` panel kabuğundaki `StepUpDialog`'u açar ve isteği bir kez yineler (step-up sunucuda bu bağlantıda tüketilir).
 * Başarıda mevcut teknisyen konsoluna gidilir; düğme yönlenene dek meşgul kalır (çift tıklama ikinci bağlantı açmaz).
 * Hata → Türkçe toast + `onFailed` (liste/ayrıntı güncel durumu yeniden okusun).
 */
export function useConnect(onFailed?: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const connect = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const r = await api<UnattendedConnectResponse>("POST", `/unattended/devices/${id}/connect`, {});
        router.push(`/sessions/${r.sessionId}/console`);
      } catch (e) {
        setBusyId(null);
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        toast(unattendedUiError(e).message, "danger");
        onFailed?.();
      }
    },
    [router, toast, onFailed],
  );
  return { connect, busyId };
}
