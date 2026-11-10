"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/** Sayfayı sunucuda yeniden çizer (resolve yeniden denenir). */
export function RetryButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" loading={pending} onClick={() => start(() => router.refresh())}>
      {!pending && <RotateCw aria-hidden className="size-4" />}
      {t("err.retry")}
    </Button>
  );
}
