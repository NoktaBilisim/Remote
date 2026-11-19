"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAgentAvailability, macVariant, type MacVariant } from "@/lib/agent-download";
import { isLinuxDesktop, readSupportEnv, readUaArch, type AgentOs } from "@/lib/device-support";
import { t } from "@/lib/i18n";

/**
 * İndirme seçeneği: `none` = yalnız tarayıcı, `loading` = macOS/Linux availability (Linux'ta + UA-CH mimarisi) bekleniyor,
 * `ready` = birincil indirme gösterilir.
 */
export type AgentOffer = { state: "none" } | { state: "loading" } | { state: "ready"; os: AgentOs; variant: MacVariant };

/** Ağ/okuma sonucu: `ok` = indirme sunulabilir; `variant` yalnız macOS rehberinde anlamlı (K-P28f-r4-3). */
type Gate = { os: AgentOs; ok: boolean; variant: MacVariant };

/** P28g: Linux'ta availability `linux:true` **ve** gerçek mimari x86_64 (Chromium UA-CH; okunamazsa fail-closed). */
async function checkGate(os: "macos" | "linux"): Promise<Gate> {
  if (os === "macos") {
    const r = await fetchAgentAvailability();
    return { os, ok: r?.macos === true, variant: macVariant(r) };
  }
  const [r, arch] = await Promise.all([fetchAgentAvailability(), readUaArch()]);
  return { os, ok: r?.linux === true && isLinuxDesktop(readSupportEnv(), arch), variant: "adhoc" };
}

/**
 * P28f AC-390 / S-P28f-15: macOS'ta indirme yalnız `GET /public/agent/availability` `macos: true` dönerse gösterilir;
 * P28g (AC-403, S-P28g-12): Linux'ta `linux: true` ve x86_64 iken. Hata/429/geçersiz yanıt → yalnız tarayıcı (fail-closed).
 * Windows yolu değişmez (kapı tıklamadaki 503 NOT_READY ön kontrolü).
 */
export function useAgentOffer(os: AgentOs | null): AgentOffer {
  const [gate, setGate] = useState<Gate | null>(null);
  useEffect(() => {
    if (os !== "macos" && os !== "linux") return;
    let live = true;
    void checkGate(os).then((g) => {
      if (live) setGate(g);
    });
    return () => {
      live = false;
    };
  }, [os]);
  if (os === "windows") return { state: "ready", os, variant: "adhoc" };
  if (os === null) return { state: "none" };
  if (gate?.os !== os) return { state: "loading" };
  return gate.ok ? { state: "ready", os, variant: gate.variant } : { state: "none" };
}

/** macOS/Linux indirme seçeneği denetlenirken (DESIGN §7 iskelet); tarayıcı yolu bu sırada kullanılabilir kalır. */
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
