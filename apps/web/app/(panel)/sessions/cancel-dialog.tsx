"use client";

import type { CancelSessionResponse, SessionView } from "@remote/contracts/api/sessions";
import { CircleX } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatSessionCode } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useSessionAction } from "./use-session-action";

/** Yıkıcı onay (AC-8): odak "Vazgeç"te; başarıda toast + liste yenilenir. */
export function CancelDialog({
  session,
  onClose,
  onDone,
}: {
  session: Pick<SessionView, "id" | "code"> | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { busy, error, close, run } = useSessionAction(onClose, onDone, () => t("c.conflict"));
  const confirm = async () => {
    if (!session) return;
    await run(async () => {
      await api<CancelSessionResponse>("POST", `/sessions/${encodeURIComponent(session.id)}/cancel`);
      toast(t("toast.cancelled"));
    });
  };

  return (
    <Dialog
      open={session !== null}
      onClose={close}
      role="alertdialog"
      size="sm"
      testId="cancel-dialog"
      title={session?.code ? `${t("c.title")} (${formatSessionCode(session.code)})` : t("c.title")}
      description={t("c.body")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={close} disabled={busy} className="sm:ml-auto">
            {t("c.dismiss")}
          </Button>
          <Button variant="secondary" onClick={confirm} loading={busy} className="border-danger/40 text-danger hover:bg-danger-surface">
            {!busy && <CircleX aria-hidden className="size-4" />}
            {t("c.confirm")}
          </Button>
        </>
      }
    >
      {error && <FormError error={error} />}
    </Dialog>
  );
}
