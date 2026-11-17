"use client";

import { Headphones, Phone, PhoneOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

/** AC-116 kalıbı (dosya kabul diyaloğu): "Kabul et" teklif başına 1,5 sn kilitli — yanlışlıkla Enter/çift tıklama kabul etmez. */
const ARM_MS = 1500;

/**
 * P28d müşteri sesli görüşme isteği (mimari-p28d r2 §5 m.2, §8; AC-373, K-PD-2). `alertdialog`, ilk odak "Reddet"; Esc / X =
 * Reddet. "Kabul et" tıklaması `onAccept`'i EŞZAMANLI çağırır (rıza kaydı + mikrofon yalnız bu tıklamada açılır).
 */
export function VoiceRequestDialog({
  request,
  listenerNames,
  onAccept,
  onReject,
}: {
  request: { callId: string; name: string } | null;
  /** İsteyen dışında görüşmeyi dinleyecek teknisyenler (Y-PD-3). */
  listenerNames: string[];
  onAccept: () => void;
  onReject: () => void;
}) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const armed = request !== null && armedId === request.callId;
  useEffect(() => {
    if (!request) return;
    const id = request.callId;
    const timer = setTimeout(() => setArmedId(id), ARM_MS);
    return () => clearTimeout(timer);
  }, [request?.callId]); // eslint-disable-line react-hooks/exhaustive-deps -- yalnız yeni istekte yeniden kur

  return (
    <Dialog
      open={request !== null}
      onClose={onReject}
      title={t("vg.requestTitle", { name: request?.name ?? "" })}
      description={t("vg.requestBody")}
      role="alertdialog"
      size="sm"
      testId="voice-request"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onReject} className="sm:ml-auto" data-testid="voice-reject">
            <PhoneOff aria-hidden className="size-4" />
            {t("vg.reject")}
          </Button>
          <Button onClick={onAccept} disabled={!armed} data-testid="voice-accept">
            <Phone aria-hidden className="size-4" />
            {t("vg.accept")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {listenerNames.length > 0 && (
          <p className="text-fg" data-testid="voice-request-listeners">
            {t("vg.requestListeners", { names: listenerNames.join(", ") })}
          </p>
        )}
        <p className="flex items-start gap-2 text-fg-muted" data-testid="voice-headset">
          <Headphones aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("vg.headset")}
        </p>
      </div>
    </Dialog>
  );
}
