"use client";

import type { PortalMe } from "@remote/contracts/api/portal";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { portalGateTarget } from "@/lib/portal/api";
import { portalRequestSource } from "@/lib/portal/request-source";
import { WebRequestFlowWith } from "../../../r/[ref]/web-request-flow";

/** P19 akışı portal kaynağıyla (oturum düşerse portal girişine, şifre değişimi gerekirse zorunlu ekrana). */
export function PortalNewRequest({ me }: { me: PortalMe }) {
  const router = useRouter();
  const source = useMemo(
    () =>
      portalRequestSource(me, (e) => {
        const to = portalGateTarget(e);
        if (to) router.replace(to);
        return to !== null;
      }),
    [me, router],
  );
  return <WebRequestFlowWith source={source} />;
}
