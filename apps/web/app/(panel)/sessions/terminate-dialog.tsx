"use client";

import type { SessionView, TerminateSessionResponse } from "@remote/contracts/api/sessions";
import { Power } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useSessionAction } from "./use-session-action";

/** Admin "Zorla sonlandır" (AC-114, G-04): yıkıcı onay, odak "Vazgeç"te; 409 = oturum artık aktif değil. */
export function TerminateDialog({
  session,
  onClose,
  onDone,
}: {
  session: Pick<SessionView, "id" | "technician"> | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { busy, error, close, run } = useSessionAction(onClose, onDone, () => t("st.notActive"));
  const confirm = async () => {
    if (!session) return;
    await run(async () => {
      await api<TerminateSessionResponse>("POST", `/sessions/${session.id}/terminate`, {});
      toast(t("st.done"), "success");
    });
  };

  return (
    <Dialog
      open={session !== null}
      onClose={close}
      title={t("st.title")}
      description={session ? t("st.body", { name: session.technician.name }) : undefined}
      size="sm"
      role="alertdialog"
      testId="terminate-dialog"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={close} disabled={busy} className="sm:ml-auto">
            {t("c.keep")}
          </Button>
          <Button variant="danger" loading={busy} onClick={confirm} data-testid="terminate-confirm">
            {!busy && <Power aria-hidden className="size-4" />}
            {t("st.action")}
          </Button>
        </>
      }
    >
      {error && <FormError error={error} />}
    </Dialog>
  );
}
