"use client";

import type { CancelSessionResponse, SessionView } from "@remote/contracts/api/sessions";
import { CircleX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatSessionCode } from "@/lib/format";
import { t } from "@/lib/i18n";

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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const confirm = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api<CancelSessionResponse>("POST", `/sessions/${encodeURIComponent(session.id)}/cancel`);
      toast(t("toast.cancelled"));
      onDone();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(toUiError(e, { 409: t("c.conflict"), 404: t("c.conflict") }));
    } finally {
      setBusy(false);
    }
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
