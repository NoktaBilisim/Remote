"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import type { DeviceListItem, UnattendedConnectResponse } from "@/lib/unattended/contract";
import { unattendedUiError } from "@/lib/unattended/errors";

export type ConnectTarget = Pick<DeviceListItem, "id" | "name" | "userState">;

/**
 * Bağlan akışı (AC-273, P28u r3 AC-430): "Bağlan" tek diyaloğu açar (`open`); gönderimde `POST /unattended/devices/:id/connect`
 * gövdesi boş nesne (tek yol onaysız). 401 `MFA_STEP_UP_REQUIRED` → `lib/api` panel kabuğundaki `StepUpDialog` + bir kez
 * yineleme. Başarıda konsola gidilir; diyalog ve düğme yönlenene dek meşgul kalır (çift tıklama ikinci bağlantı açmaz).
 * Hata diyalogda form üstünde kalır (`DEVICE_OUTDATED`, `DEVICE_BUSY`, 429 …); `onFailed` liste/ayrıntının güncel durumu
 * yeniden okumasını sağlar.
 */
export function useConnect(onFailed?: () => void) {
  const router = useRouter();
  const [target, setTarget] = useState<ConnectTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const open = useCallback((d: ConnectTarget) => {
    setError(null);
    setTarget(d);
  }, []);
  const close = useCallback(() => {
    if (!busy) setTarget(null);
  }, [busy]);

  const submit = useCallback(async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<UnattendedConnectResponse>("POST", `/unattended/devices/${target.id}/connect`, {});
      router.push(`/sessions/${r.sessionId}/console`);
    } catch (e) {
      setBusy(false);
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(unattendedUiError(e));
      onFailed?.();
    }
  }, [target, busy, router, onFailed]);
  return { target, busy, busyId: busy ? (target?.id ?? null) : null, error, open, close, submit };
}

export type ConnectFlow = ReturnType<typeof useConnect>;
