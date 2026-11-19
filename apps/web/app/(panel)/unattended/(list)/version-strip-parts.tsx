"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { t } from "@/lib/i18n";
import { devicesHref, type DeviceListParams } from "@/lib/unattended/query";

/** Super Admin "Bu firma / Tüm firmalar" seçimi (`scope=all` URL'de; liste etkilenmez, yalnız şerit). */
export function VersionScope({ params }: { params: DeviceListParams }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Segmented<"tenant" | "all">
      label={t("upd.scope")}
      value={params.scope === "all" ? "all" : "tenant"}
      disabled={pending}
      onChange={(v) => start(() => router.replace(devicesHref({ ...params, scope: v === "all" ? "all" : undefined })))}
      options={[
        { value: "tenant", label: t("upd.scope.tenant") },
        { value: "all", label: t("upd.scope.all") },
      ]}
    />
  );
}

/** Şerit hatasında yeniden dene (sayfa sunucuda yeniden çizilir; liste etkilenmez). */
export function StripRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" loading={pending} onClick={() => start(() => router.refresh())} data-testid="upd-strip-retry">
      {!pending && <RotateCw aria-hidden className="size-4" />}
      {t("err.retry")}
    </Button>
  );
}
