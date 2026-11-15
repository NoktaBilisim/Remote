"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";

/** 401 → oturum süresi doldu sayfasına `replace`; yönlendirdiyse `true` (çağıran işlemi bırakır). */
export function useUnauthRedirect(): (e: unknown) => boolean {
  const router = useRouter();
  return useCallback(
    (e: unknown) => {
      if (!isUnauthenticated(e)) return false;
      router.replace(EXPIRED_LOGIN_PATH);
      return true;
    },
    [router],
  );
}
