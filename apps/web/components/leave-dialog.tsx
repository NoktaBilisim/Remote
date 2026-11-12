"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import type { useLeaveGuard } from "@/lib/use-leave-guard";

/** `useLeaveGuard` onay diyaloğu: "Sayfada kal" varsayılan odak (yıkıcı olmayan seçim), "Kaydetmeden ayrıl" ikincil. */
export function LeaveDialog({ guard, body }: { guard: ReturnType<typeof useLeaveGuard>; body: string }) {
  return (
    <Dialog
      open={guard.target !== null}
      onClose={guard.stay}
      role="alertdialog"
      size="sm"
      testId="leave-dialog"
      title={t("h.n.leaveTitle")}
      description={body}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={guard.stay} className="sm:ml-auto">{t("h.n.stay")}</Button>
          <Button variant="danger-ghost" onClick={guard.leave}>{t("h.n.discard")}</Button>
        </>
      }
    />
  );
}
