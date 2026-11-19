"use client";

import { Info, Plug } from "lucide-react";
import type { FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import type { ConnectFlow } from "./use-connect";
import { UserState } from "./user-state";

const FORM_ID = "un-connect-form";

/** Diyalog gövdesi: cihaz kullanıcı durumu (yalnız bilgi, AC-429) + onaysız bağlantı bilgi satırı (AC-430 r3). */
function ConnectForm({ flow }: { flow: ConnectFlow }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void flow.submit();
  };
  return (
    <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="un-connect-form">
      <FormError error={flow.error} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-fg-muted">{t("un.consent.userState")}</dt>
        <dd>
          <UserState state={flow.target?.userState} />
        </dd>
      </dl>
      <p className="flex items-start gap-2 text-sm text-fg-muted" data-testid="un-connect-info">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("un.consent.info")}
      </p>
      <p className="text-xs text-fg-muted">{t("un.consent.stepUp")}</p>
    </form>
  );
}

/**
 * Tek "Bağlan" diyaloğu (mimari-p28u §r3 r3.6, AC-430): cihaz kullanıcı durumu ve "sorulmadan açılır" bilgisi; kutu, gerekçe
 * veya kip seçimi yok. Gönder → step-up (401'de) → konsol.
 */
export function ConnectDialog({ flow }: { flow: ConnectFlow }) {
  const d = flow.target;
  return (
    <Dialog
      open={d !== null}
      onClose={flow.close}
      title={t("un.consent.title", { name: d?.name ?? "" })}
      description={t("un.consent.desc")}
      testId="un-connect-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={flow.close} disabled={flow.busy} data-testid="un-connect-cancel">
            {t("c.dismiss")}
          </Button>
          <Button type="submit" form={FORM_ID} loading={flow.busy} data-testid="un-connect-submit">
            {!flow.busy && <Plug aria-hidden className="size-4" />}
            {t("un.connect")}
          </Button>
        </>
      }
    >
      {d && <ConnectForm key={d.id} flow={flow} />}
    </Dialog>
  );
}
