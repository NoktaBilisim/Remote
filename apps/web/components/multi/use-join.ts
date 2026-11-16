"use client";

import type { JoinSessionAsMemberResponse, JoinWithReasonInput } from "@remote/contracts/api/multi";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { multiUiError, reasonFieldError } from "@/lib/multi/errors";

/** Katılım hedefi: gelen davet (kabul) ya da etkin oturum (İzle). `silent` → önce gerekçe diyaloğu (Y-PC-1). */
export interface JoinTarget {
  kind: "invite" | "supervise";
  /** Davet kimliği ya da oturum kimliği. */
  id: string;
  silent: boolean;
  /** Diyalog başlığındaki müşteri adı. */
  label: string;
}

const pathOf = (j: JoinTarget) => (j.kind === "invite" ? `/sessions/invites/${j.id}/accept` : `/sessions/${j.id}/supervise`);

/**
 * Kabul / İzle akışı (mimari-p28c §4.1): silent odada gerekçe diyaloğu, sonra POST; 401 `MFA_STEP_UP_REQUIRED` panel kabuğundaki
 * step-up diyaloğu + bir kez yineleme (`lib/api`). Başarıda konsola gidilir (sunucunun `sessionId`'si; yol istemcide kurulur).
 * Gerekçe hatası alana, diğerleri diyalog / çağıranın satırına.
 */
export function useJoin(onFailed?: (j: JoinTarget, e: UiError) => void) {
  const router = useRouter();
  const [reasonFor, setReasonFor] = useState<JoinTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();

  const submit = useCallback(
    async (j: JoinTarget, body: JoinWithReasonInput) => {
      setBusyId(j.id);
      setError(null);
      setReasonError(undefined);
      try {
        const r = await api<JoinSessionAsMemberResponse>("POST", pathOf(j), body);
        router.push(`/sessions/${r.sessionId}/console`);
      } catch (e) {
        setBusyId(null);
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        const field = reasonFieldError(e);
        if (field && j.silent) return setReasonError(field);
        const ui = multiUiError(e);
        if (j.silent) setError(ui);
        onFailed?.(j, ui);
      }
    },
    [router, onFailed],
  );

  /** Düğme: silent → gerekçe diyaloğu; diğerleri doğrudan `{}`. */
  const start = useCallback(
    (j: JoinTarget) => {
      if (busyId) return;
      if (!j.silent) return void submit(j, {});
      setError(null);
      setReasonError(undefined);
      setReasonFor(j);
    },
    [busyId, submit],
  );
  const close = useCallback(() => {
    if (!busyId) setReasonFor(null);
  }, [busyId]);

  return { start, submit, close, reasonFor, busyId, error, reasonError };
}
export type JoinFlow = ReturnType<typeof useJoin>;
