"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAgentAvailability } from "@/lib/agent-download";
import type { AgentOs } from "@/lib/device-support";
import { t } from "@/lib/i18n";

/** İndirme seçeneği: `none` = yalnız tarayıcı, `loading` = macOS availability bekleniyor, `ready` = birincil indirme gösterilir. */
export type AgentOffer = { state: "none" } | { state: "loading" } | { state: "ready"; os: AgentOs; testBuild: boolean };

/**
 * P28f AC-390 / S-P28f-15: macOS'ta indirme yalnız `GET /public/agent/availability` `macos: true` dönerse gösterilir;
 * hata/429/geçersiz yanıt → yalnız tarayıcı (fail-closed). Windows yolu değişmez (kapı tıklamadaki 503 NOT_READY ön kontrolü).
 */
export function useAgentOffer(os: AgentOs | null): AgentOffer {
  const [mac, setMac] = useState<{ ok: boolean; testBuild: boolean } | null>(null);
  useEffect(() => {
    if (os !== "macos") return;
    let live = true;
    void fetchAgentAvailability().then((r) => {
      if (live) setMac({ ok: r?.macos === true, testBuild: r?.macosTestBuild === true });
    });
    return () => {
      live = false;
    };
  }, [os]);
  if (os === "windows") return { state: "ready", os, testBuild: false };
  if (os !== "macos" || mac?.ok === false) return { state: "none" };
  return mac === null ? { state: "loading" } : { state: "ready", os, testBuild: mac.testBuild };
}

/** macOS indirme seçeneği denetlenirken (DESIGN §7 iskelet); tarayıcı yolu bu sırada kullanılabilir kalır. */
export function AgentSkeleton() {
  return (
    <div
      aria-busy="true"
      data-testid="agent-download-loading"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
    >
      <span className="sr-only">{t("gm.checking")}</span>
      <Skeleton className="h-5 w-56 max-w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-3 w-40 max-w-full" />
    </div>
  );
}
