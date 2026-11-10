"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/** Sunucu verisi alınamadığında hata durumu + "Tekrar dene" (sayfayı sunucuda yeniden çizer). */
export function LoadError({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4" data-testid="load-error">
      <Alert tone="danger">
        <p className="font-medium">{t("err.pageTitle")}</p>
        <p className="mt-1">{t("err.pageBody")}</p>
      </Alert>
      <Button
        variant="secondary"
        loading={pending}
        onClick={() => start(() => (onRetry ? onRetry() : router.refresh()))}
        className="self-start"
      >
        {!pending && <RotateCw aria-hidden className="size-4" />}
        {t("err.retry")}
      </Button>
    </div>
  );
}
