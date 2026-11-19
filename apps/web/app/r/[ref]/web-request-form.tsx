"use client";

import { useId, useState } from "react";
import { RecordingConsent } from "@/components/consent/recording-consent";
import { FormError } from "@/components/form-error";
import { t } from "@/lib/i18n";
import { setRecConsent } from "@/lib/rec/consent-choice";
import { ChatRetentionNotice } from "@/components/kvkk/chat-retention-notice";
import { useWebRequestForm, type WebRequestFormProps } from "./use-web-request-form";
import { AfterHoursNote, ConsentFields, ContactFields, NotifyChoices, SubmitButton } from "./web-request-fields";

/**
 * Web talep formu (AC-259): ad, telefon, e-posta (ops.), açıklama, aydınlatma metni + onay, bildirim kutucukları (yalnız
 * firmanın açtığı kanallar, varsayılan işaretsiz), gizli `website` alanı, düğmenin hemen üstünde AC-292 satırı.
 * Gönderim token alındıktan 2 sn önce yapılmaz (düğmede geri sayım); 4xx/429/503 sonrası yeni token alınır.
 */
export function WebRequestForm(props: WebRequestFormProps) {
  const { info } = props;
  // P28e (AC-381, K-P28e-3): ayrı, işaretsiz kayıt rızası — bellekte; gönderimde depoya yazılır, kabulde oturum tüketir
  const [recConsent, setRecChoice] = useState(false);
  const f = useWebRequestForm({
    ...props,
    onCreated: (r, name) => {
      setRecConsent(recConsent);
      props.onCreated(r, name);
    },
  });
  const hintId = useId();
  const closed = !info.businessHours.openNow && info.businessHours.afterHoursMode === "REJECT";
  const ready = !f.busy && f.retentionShown && f.wait === 0;
  return (
    <form onSubmit={f.submit} noValidate className="flex flex-col gap-4" data-testid="wr-form" data-wait={f.wait > 0 || undefined}>
      <section aria-labelledby="wr-h" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
        <div>
          <h1 id="wr-h" className="text-xl font-semibold text-fg">
            {t("wr.heading", { name: info.tenant.name })}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t("wr.intro")}</p>
        </div>
        {!info.businessHours.openNow && <AfterHoursNote hours={info.businessHours} closed={closed} />}
        {f.formErr && <FormError error={f.formErr} />}
        <fieldset disabled={f.busy || closed} className="flex flex-col gap-4">
          <ContactFields d={f.d} errors={f.errors} set={f.set} />
          <NotifyChoices enabled={info.channels} notify={f.d.notify} onChange={(notify) => f.set({ notify })} />
          <ConsentFields
            checked={f.d.consent}
            error={f.errors.consent}
            hintId={hintId}
            text={info.consentText}
            onChange={(consent) => f.set({ consent })}
          />
          <RecordingConsent consentText={info.consentText} checked={recConsent} onChange={setRecChoice} />
        </fieldset>
        {f.retentionShown && <ChatRetentionNotice days={info.chatRetentionDays} id={hintId} />}
        <SubmitButton busy={f.busy} wait={f.wait} disabled={!ready || closed} describedBy={f.retentionShown ? hintId : undefined} />
      </section>
    </form>
  );
}
