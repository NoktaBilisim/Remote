"use client";

import { ShieldOff } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";

/** `POST …/revoke-binding`: 409 → "zaten geçersiz", 404 → "kapandı" (`onGone`); diğer hatalar diyalogda. */
function useRevoke(item: SupportRequestItem | null, onDone: (id: string) => void, onGone: (id: string, message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const run = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/support-requests/${item.id}/revoke-binding`, {});
      onDone(item.id);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 404))
        onGone(item.id, e.status === 409 ? t("rq.revoke.already") : t("rq.err.closed"));
      else setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

interface RevokeBindingDialogProps {
  item: SupportRequestItem | null;
  onClose: () => void;
  onDone: (id: string) => void;
  onGone: (id: string, message: string) => void;
}

/**
 * "Bu bilgisayarın kaydını iptal et" (mimari-e10 §15.2, AC-185): `POST /support-requests/:id/revoke-binding`.
 * Kayıt kimliği istemciden gönderilmez (talepten bulunur). `alertdialog`, varsayılan odak "Vazgeç".
 * 409 (zaten geçersiz) / 404 → çağırana `onGone` (liste tazelenir).
 */
export function RevokeBindingDialog({ item, onClose, onDone, onGone }: RevokeBindingDialogProps) {
  const { busy, error, setError, run } = useRevoke(item, onDone, onGone);
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={item !== null}
      onClose={close}
      role="alertdialog"
      size="sm"
      testId="revoke-binding-dialog"
      title={t("rq.revoke.title")}
      description={t("rq.revoke.body")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={close} disabled={busy} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void run()} data-testid="revoke-binding-confirm">
            {!busy && <ShieldOff aria-hidden className="size-4" />}
            {t("rq.revoke.confirm")}
          </Button>
        </>
      }
    >
      {error && <FormError error={error} />}
    </Dialog>
  );
}
