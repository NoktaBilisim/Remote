"use client";

import type { JoinSessionAsMemberResponse } from "@remote/contracts/api/multi";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { multiUiError } from "@/lib/multi/errors";

/** Katılım hedefi: gelen davet (kabul) ya da etkin oturum (İzle). */
export interface JoinTarget {
  kind: "invite" | "supervise";
  /** Davet kimliği ya da oturum kimliği. */
  id: string;
}

const pathOf = (j: JoinTarget) => (j.kind === "invite" ? `/sessions/invites/${j.id}/accept` : `/sessions/${j.id}/supervise`);

/**
 * Kabul / İzle akışı (mimari-p28c §4.1; P28u r3 K-P28u-r3-9: gerekçe yok, gövde `{}`): POST; 401 `MFA_STEP_UP_REQUIRED` panel
 * kabuğundaki step-up diyaloğu + bir kez yineleme (`lib/api`). Başarıda konsola gidilir (sunucunun `sessionId`'si; yol
 * istemcide kurulur). Hata çağıranın `onFailed`'ına (toast / satır engeli).
 */
export function useJoin(onFailed?: (j: JoinTarget, e: UiError) => void) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const start = useCallback(
    async (j: JoinTarget) => {
      if (busyId) return;
      setBusyId(j.id);
      try {
        const r = await api<JoinSessionAsMemberResponse>("POST", pathOf(j), {});
        router.push(`/sessions/${r.sessionId}/console`);
      } catch (e) {
        setBusyId(null);
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        onFailed?.(j, multiUiError(e));
      }
    },
    [busyId, router, onFailed],
  );

  return { start, busyId };
}
export type JoinFlow = ReturnType<typeof useJoin>;
