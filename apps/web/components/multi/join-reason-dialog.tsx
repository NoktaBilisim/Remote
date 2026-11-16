"use client";

import { silentReasonSchema } from "@remote/contracts/api/unattended";
import { Info, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ReasonField } from "@/app/(panel)/unattended/connect-dialog";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import type { JoinFlow, JoinTarget } from "./use-join";

const FORM_ID = "mt-reason-form";

function ReasonForm({ flow, target }: { flow: JoinFlow; target: JoinTarget }) {
  const [reason, setReason] = useState("");
  const [local, setLocal] = useState<string | undefined>();
  const busy = flow.busyId === target.id;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = silentReasonSchema.safeParse(reason);
    if (!r.success) return setLocal(r.error.issues[0]?.message ?? "Gerekçe geçersiz");
    setLocal(undefined);
    void flow.submit(target, { reason: r.data });
  };
  return (
    <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="mt-reason-form">
      <FormError error={flow.error} />
      <ReasonField
        value={reason}
        onChange={(v) => {
          setReason(v);
          setLocal(undefined);
        }}
        error={local ?? flow.reasonError}
        busy={busy}
      />
      <p className="flex items-start gap-2 rounded-md bg-warning-surface p-2 text-sm text-warning" data-testid="mt-reason-notify">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("mt.reasonNotify")}
      </p>
      <p className="text-xs text-fg-muted">{t("un.consent.stepUp")}</p>
    </form>
  );
}

/** İzinsiz (silent) odaya katılım gerekçesi (20–500, sayaç; AC-437 şeması) — davet kabulü ve İzle aynı diyalog. */
export function JoinReasonDialog({ flow }: { flow: JoinFlow }) {
  const target = flow.reasonFor;
  const busy = target !== null && flow.busyId === target.id;
  return (
    <Dialog
      open={target !== null}
      onClose={flow.close}
      title={t("mt.reasonTitle")}
      description={t("mt.reasonDesc")}
      testId="mt-reason-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={flow.close} disabled={busy}>
            {t("mt.keep")}
          </Button>
          <Button type="submit" form={FORM_ID} loading={busy} data-testid="mt-reason-submit">
            {!busy && <LogIn aria-hidden className="size-4" />}
            {t("mt.reasonSubmit")}
          </Button>
        </>
      }
    >
      {target && <ReasonForm key={target.id} flow={flow} target={target} />}
    </Dialog>
  );
}
